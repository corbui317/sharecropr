import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

export type FpsSample = {
  timestamp: number;
  fps: number;
  frameMs: number;
};

export type FpsSummary = {
  avgFps: number;
  minFps: number;
  maxFrameMs: number;
  p95FrameMs: number;
  sampleCount: number;
};

const MAX_SAMPLES = 600;

/**
 * Lightweight FPS profiler for EPIC-01 SCR-0103.
 * Uses Reanimated frame callback to measure UI thread frame times.
 */
export function useFpsProfiler() {
  const lastTimestamp = useSharedValue(0);
  const currentFps = useSharedValue(60);
  const currentFrameMs = useSharedValue(16.67);

  const samplesRef = useRef<FpsSample[]>([]);
  const recordingRef = useRef(false);
  const [displayFps, setDisplayFps] = useState(60);
  const [displayFrameMs, setDisplayFrameMs] = useState(16.67);
  const [isRecording, setIsRecording] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);

  useFrameCallback((frameInfo) => {
    if (frameInfo.timestamp === undefined) {
      return;
    }

    if (lastTimestamp.value > 0) {
      const deltaMs = frameInfo.timestamp - lastTimestamp.value;
      if (deltaMs > 0) {
        const fps = 1000 / deltaMs;
        currentFps.value = fps;
        currentFrameMs.value = deltaMs;

        if (recordingRef.current) {
          const sample: FpsSample = {
            timestamp: frameInfo.timestamp,
            fps,
            frameMs: deltaMs,
          };
          const next = [...samplesRef.current, sample];
          samplesRef.current =
            next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
        }
      }
    }

    lastTimestamp.value = frameInfo.timestamp;
  });

  useEffect(() => {
    const id = setInterval(() => {
      setDisplayFps(Math.round(currentFps.value));
      setDisplayFrameMs(Math.round(currentFrameMs.value * 10) / 10);
      setSampleCount(samplesRef.current.length);
    }, 250);
    return () => clearInterval(id);
  }, [currentFps, currentFrameMs]);

  const startRecording = useCallback(() => {
    recordingRef.current = true;
    setIsRecording(true);
    samplesRef.current = [];
    setSampleCount(0);
  }, []);

  const stopRecording = useCallback(() => {
    recordingRef.current = false;
    setIsRecording(false);
  }, []);

  const clearSamples = useCallback(() => {
    samplesRef.current = [];
    setSampleCount(0);
  }, []);

  const getSummary = useCallback((): FpsSummary => {
    const samples = samplesRef.current;
    if (samples.length === 0) {
      return {
        avgFps: 0,
        minFps: 0,
        maxFrameMs: 0,
        p95FrameMs: 0,
        sampleCount: 0,
      };
    }

    const fpsValues = samples.map((s) => s.fps);
    const frameMsValues = samples.map((s) => s.frameMs).sort((a, b) => a - b);
    const p95Index = Math.floor(frameMsValues.length * 0.95);

    return {
      avgFps: fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length,
      minFps: Math.min(...fpsValues),
      maxFrameMs: Math.max(...frameMsValues),
      p95FrameMs: frameMsValues[p95Index] ?? 0,
      sampleCount: samples.length,
    };
  }, []);

  const exportSamples = useCallback(() => JSON.stringify(samplesRef.current, null, 2), []);

  return {
    displayFps,
    displayFrameMs,
    isRecording,
    sampleCount,
    startRecording,
    stopRecording,
    clearSamples,
    getSummary,
    exportSamples,
  };
}
