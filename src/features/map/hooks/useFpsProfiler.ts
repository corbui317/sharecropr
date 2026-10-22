import { useCallback, useEffect, useRef, useState } from 'react';
// runOnJS is deprecated in Reanimated 4 in favour of scheduleOnRN from react-native-worklets, which
// is not yet a direct dependency of this app. Migrate when it is.
import { runOnJS, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import {
  DEFAULT_TARGET_FRAME_MS,
  R53_FRAME_BUDGET_MS,
  clearFrames,
  createFrameRing,
  frameSamples,
  pushFrame,
  summarizeFrames,
  type FrameRing,
  type FrameSummary,
} from '@/features/map/lib/fpsSummary';
import { readJsHeap, type JsHeapSample } from '@/features/map/lib/jsHeap';

const FLUSH_EVERY_FRAMES = 30;
const HEAP_SAMPLE_MS = 1000;
const MAX_HEAP_SAMPLES = 600;

const CHANNELS = {
  ui: {
    source: 'reanimated useFrameCallback (UI thread), batched via runOnJS',
    caveat: 'UI-thread vsync cadence. Not MapLibre GL render-thread frames.',
  },
  js: {
    source: 'requestAnimationFrame (JS thread)',
    caveat: 'JS-thread stalls (clustering, React renders). Not GL frames.',
  },
  map: {
    source: 'MapLibre onDidFinishRenderingFrame[Fully], JS receipt time',
    caveat:
      'Render-completion cadence jittered by JS-thread latency; renderer is on-demand, so only meaningful during continuous gesture. Not GL frame duration.',
  },
} as const;

export type ProfilerChannel = keyof typeof CHANNELS;
export type ProfilerChannelReport = {
  source: string;
  caveat: string;
  overwritten: number;
  summary: FrameSummary;
};
export type ProfilerReport = {
  schema: 'sharecropr.map-spike.profile/2';
  targetFrameMs: number;
  budgetMs: number;
  recordingStartedAtMs: number | null;
  channels: Record<ProfilerChannel, ProfilerChannelReport>;
  jsHeap: { available: boolean; caveat: string; samples: JsHeapSample[] };
  primaryEvidence: string;
};
export type LiveProfilerReading = {
  uiFps: number;
  uiFrameMs: number;
  samples: Record<ProfilerChannel, number>;
};

/**
 * Spike profiler for EPIC-01 SCR-0103. Supporting evidence only: none of these channels is a
 * MapLibre GL render-thread frame time (see docs/07-review/03-map-spike-go-no-go.md).
 * The only React state here is isRecording, so the live readout never re-renders the map tree.
 */
export function useFpsProfiler({ enabled }: { enabled: boolean }) {
  const recording = useSharedValue(false);
  const pending = useSharedValue<number[]>([]);
  const emaFrameMs = useSharedValue(DEFAULT_TARGET_FRAME_MS);

  const rings = useRef<Record<ProfilerChannel, FrameRing> | null>(null);
  if (rings.current === null) {
    rings.current = { ui: createFrameRing(), js: createFrameRing(), map: createFrameRing() };
  }
  const recordingRef = useRef(false);
  const lastMapFrameAt = useRef<number | null>(null);
  const heap = useRef<JsHeapSample[]>([]);
  const startedAt = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);

  const appendUiBatch = useCallback((batch: number[]) => {
    const ui = (rings.current as Record<ProfilerChannel, FrameRing>).ui;
    for (let i = 0; i + 1 < batch.length; i += 2) {
      const t = batch[i];
      const dt = batch[i + 1];
      if (t === undefined || dt === undefined) break;
      pushFrame(ui, t, dt);
    }
  }, []);

  useFrameCallback((info) => {
    'worklet';
    const dt = info.timeSincePreviousFrame;
    if (dt === null) return;
    emaFrameMs.value = emaFrameMs.value * 0.9 + dt * 0.1;
    if (recording.value) {
      pending.modify((buf) => {
        'worklet';
        buf.push(info.timestamp, dt);
        return buf;
      });
    }
    const buffered = pending.value.length;
    // Flush every FLUSH_EVERY_FRAMES frames, and drain the remainder on the first frame after stop.
    if (buffered > 0 && (buffered >= FLUSH_EVERY_FRAMES * 2 || !recording.value)) {
      const batch = pending.value;
      pending.value = [];
      runOnJS(appendUiBatch)(batch);
    }
  }, enabled);

  // JS-thread channel: rAF cadence only while recording.
  useEffect(() => {
    if (!enabled || !isRecording) return undefined;
    let last: number | null = null;
    let id = 0;
    const tick = (t: number) => {
      if (last !== null) pushFrame((rings.current as Record<ProfilerChannel, FrameRing>).js, t, t - last);
      last = t;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [enabled, isRecording]);

  // Hermes JS heap at 1 Hz while recording.
  useEffect(() => {
    if (!enabled || !isRecording) return undefined;
    const sample = () => {
      const s = readJsHeap(performance.now());
      if (s === null) return;
      heap.current.push(s);
      if (heap.current.length > MAX_HEAP_SAMPLES) heap.current.shift();
    };
    sample();
    const id = setInterval(sample, HEAP_SAMPLE_MS);
    return () => clearInterval(id);
  }, [enabled, isRecording]);

  const recordMapFrame = useCallback(() => {
    if (!recordingRef.current) return;
    const now = performance.now();
    const last = lastMapFrameAt.current;
    lastMapFrameAt.current = now;
    if (last !== null) {
      pushFrame((rings.current as Record<ProfilerChannel, FrameRing>).map, now, now - last);
    }
  }, []);

  const clearAll = useCallback(() => {
    const r = rings.current as Record<ProfilerChannel, FrameRing>;
    clearFrames(r.ui);
    clearFrames(r.js);
    clearFrames(r.map);
    heap.current = [];
  }, []);

  const startRecording = useCallback(() => {
    if (!enabled) return;
    clearAll();
    lastMapFrameAt.current = null;
    pending.value = [];
    startedAt.current = performance.now();
    recordingRef.current = true;
    recording.value = true;
    setIsRecording(true);
  }, [enabled, clearAll, pending, recording]);

  const stopRecording = useCallback(() => {
    recordingRef.current = false;
    recording.value = false; // the worklet drains the tail on its next frame
    setIsRecording(false);
  }, [recording]);

  const clearSamples = clearAll;

  const readLive = useCallback((): LiveProfilerReading => {
    const ms = emaFrameMs.value;
    const r = rings.current as Record<ProfilerChannel, FrameRing>;
    return {
      uiFps: ms > 0 ? Math.round(1000 / ms) : 0,
      uiFrameMs: Math.round(ms * 10) / 10,
      samples: { ui: r.ui.size, js: r.js.size, map: r.map.size },
    };
  }, [emaFrameMs]);

  const getReport = useCallback((): ProfilerReport => {
    const r = rings.current as Record<ProfilerChannel, FrameRing>;
    const channel = (c: ProfilerChannel): ProfilerChannelReport => ({
      ...CHANNELS[c],
      overwritten: r[c].overwritten,
      summary: summarizeFrames(frameSamples(r[c]), {
        targetFrameMs: DEFAULT_TARGET_FRAME_MS,
        budgetMs: R53_FRAME_BUDGET_MS,
      }),
    });
    return {
      schema: 'sharecropr.map-spike.profile/2',
      targetFrameMs: DEFAULT_TARGET_FRAME_MS,
      budgetMs: R53_FRAME_BUDGET_MS,
      recordingStartedAtMs: startedAt.current,
      channels: { ui: channel('ui'), js: channel('js'), map: channel('map') },
      jsHeap: {
        available: heap.current.length > 0,
        caveat:
          'Hermes JS heap only. NFR-09 (< 250 MB) is process memory: adb shell dumpsys meminfo com.sharecropr.app / Xcode Instruments.',
        samples: [...heap.current],
      },
      primaryEvidence:
        'SCR-0103 acceptance requires a Perfetto (Android) / Instruments (iOS) trace of the same session. These channels are supporting evidence only.',
    };
  }, []);

  const exportReport = useCallback(() => JSON.stringify(getReport(), null, 2), [getReport]);

  return {
    enabled,
    isRecording,
    startRecording,
    stopRecording,
    clearSamples,
    recordMapFrame,
    readLive,
    getReport,
    exportReport,
  };
}
