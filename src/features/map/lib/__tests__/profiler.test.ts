import { expect, test } from '@jest/globals';

import {
  DEFAULT_RING_CAPACITY,
  clearFrames,
  createFrameRing,
  frameSamples,
  percentile,
  pushFrame,
  ringCapacityFor,
  summarizeFrames,
} from '@/features/map/lib/fpsSummary';
import { readJsHeap } from '@/features/map/lib/jsHeap';
import {
  EMPTY_RENDER_MILESTONES,
  markFrameRendered,
  markMilestone,
} from '@/features/map/lib/renderMilestones';

// Tooling for SPEC-008-T41 (R53) and SPEC-008-T72 (R73). These unit tests check the measurement
// math only; they do NOT satisfy T41/T72, which are on-device perf runs.
// Migrated from scripts/map-tests/profiler.test.mjs (node:test) by SCRUM-64; assertions unchanged.

const s = (frameMs: number, timestamp = 0) => ({ timestamp, frameMs });
const many = (n: number, frameMs: number) =>
  Array.from({ length: n }, (_, i) => s(frameMs, i * frameMs));

test('empty input summarises to zeros (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames([]);
  expect(r.frameCount).toBe(0);
  expect(r.durationMs).toBe(0);
  expect(r.avgFps).toBe(0);
  expect(r.p95FrameMs).toBe(0);
  expect(r.maxFrameMs).toBe(0);
  expect(r.minInstantFps).toBe(0);
  expect(r.windowFps).toEqual([]);
  expect(r.worstWindowFps).toBeNull();
});

test('steady 60 Hz: ~60 fps, nothing dropped or over budget (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames(many(120, 1000 / 60));
  expect(r.frameCount).toBe(120);
  expect(Math.abs(r.avgFps - 60)).toBeLessThan(1e-9);
  expect(r.droppedFrames).toBe(0);
  expect(r.framesOverBudget).toBe(0);
  expect(r.windowFps.length).toBeGreaterThanOrEqual(1);
  for (const w of r.windowFps) {
    expect(w).toBeGreaterThan(59.5);
    expect(w).toBeLessThan(60.5);
  }
});

test('percentiles are nearest-rank over sorted intervals (SPEC-008-T41 tooling)', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1).reverse();
  const r = summarizeFrames(values.map((v) => s(v)));
  expect(r.p50FrameMs).toBe(50);
  expect(r.p95FrameMs).toBe(95);
  expect(r.p99FrameMs).toBe(99);
  expect(r.maxFrameMs).toBe(100);
  expect(r.minInstantFps).toBe(10);
  expect(percentile([], 95)).toBe(0);
  expect(percentile([7], 95)).toBe(7);
});

test('R53 budget counts frames strictly over 32 ms (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames([s(32), s(32.01)]);
  expect(r.framesOverBudget).toBe(1);
});

test('dropped frames count missed vsyncs against the target interval (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames([s(1000 / 60), s(2000 / 60), s(3000 / 60)]);
  expect(r.droppedFrames).toBe(3);
  const r120 = summarizeFrames(many(3, 1000 / 60), { targetFrameMs: 1000 / 120 });
  expect(r120.droppedFrames).toBe(3);
});

test('worst one-second window exposes an unsustained stretch (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames([...many(50, 20), ...many(25, 40)]);
  expect(r.windowFps).toEqual([50, 25]);
  expect(r.worstWindowFps).toBe(25);
  expect(r.avgFps).toBe(37.5);
  expect(r.framesOverBudget).toBe(25);
  expect(r.droppedFrames).toBe(25);
});

test('pauses longer than maxGapMs are excluded and counted (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames([s(16), s(16), s(5000), s(16)]);
  expect(r.gapCount).toBe(1);
  expect(r.frameCount).toBe(3);
  expect(r.maxFrameMs).toBe(16);
});

test('non-finite and non-positive intervals are discarded (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames([s(0), s(-1), s(Number.NaN), s(Number.POSITIVE_INFINITY), s(16)]);
  expect(r.invalidCount).toBe(4);
  expect(r.frameCount).toBe(1);
});

test('default ring covers at least 60 s at 120 Hz (SPEC-008-T41 tooling)', () => {
  expect(ringCapacityFor(60, 120)).toBe(7200);
  expect(DEFAULT_RING_CAPACITY).toBeGreaterThanOrEqual(60 * 120);
});

test('ring keeps insertion order below capacity (SPEC-008-T41 tooling)', () => {
  const ring = createFrameRing(4);
  pushFrame(ring, 1, 10);
  pushFrame(ring, 2, 20);
  expect(ring.size).toBe(2);
  expect(frameSamples(ring)).toEqual([s(10, 1), s(20, 2)]);
});

test('ring overwrites oldest on wrap and counts overwrites (SPEC-008-T41 tooling)', () => {
  const ring = createFrameRing(3);
  for (let i = 1; i <= 5; i += 1) pushFrame(ring, i, i * 10);
  expect(ring.size).toBe(3);
  expect(ring.overwritten).toBe(2);
  expect(frameSamples(ring)).toEqual([s(30, 3), s(40, 4), s(50, 5)]);
  clearFrames(ring);
  expect(ring.size).toBe(0);
  expect(ring.overwritten).toBe(0);
  expect(frameSamples(ring)).toEqual([]);
});

test('ring rejects a non-positive or fractional capacity (SPEC-008-T41 tooling)', () => {
  expect(() => createFrameRing(0)).toThrow(RangeError);
  expect(() => createFrameRing(2.5)).toThrow(RangeError);
});

test('render milestones are first-write-wins and rounded (SPEC-008-T72 tooling)', () => {
  const a = markMilestone(EMPTY_RENDER_MILESTONES, 'styleLoaded', 120.6);
  expect(a.styleLoaded).toBe(121);
  const b = markMilestone(a, 'styleLoaded', 999);
  expect(b).toBe(a);
  expect(markMilestone(a, 'mapFullyRendered', Number.NaN)).toBe(a);
  expect(markMilestone(a, 'mapFullyRendered', -1)).toBe(a);
});

test('a frame before style load is not a painted map frame (SPEC-008-T72 tooling)', () => {
  expect(markFrameRendered(EMPTY_RENDER_MILESTONES, false, 50)).toBe(EMPTY_RENDER_MILESTONES);
});

test('first frame and first fully-rendered frame bracket first painted tile (SPEC-008-T72 tooling)', () => {
  const styled = markMilestone(EMPTY_RENDER_MILESTONES, 'styleLoaded', 100);
  const partial = markFrameRendered(styled, false, 150);
  expect(partial.firstFrame).toBe(150);
  expect(partial.firstFullFrame).toBeNull();
  const full = markFrameRendered(partial, true, 400);
  expect(full.firstFrame).toBe(150);
  expect(full.firstFullFrame).toBe(400);
  // On Android a frame emits exactly one of Frame / FrameFully, so a fully-rendered
  // first frame must also set firstFrame.
  const fullFirst = markFrameRendered(styled, true, 300);
  expect(fullFirst.firstFrame).toBe(300);
  expect(fullFirst.firstFullFrame).toBe(300);
});

// Supporting data for NFR-09 (memory < 250 MB); SPEC-008 §13 has no memory T-ID, so the NFR is the ID.
test('JS heap reader tolerates missing or throwing Hermes stats (NFR-09 tooling)', () => {
  expect(readJsHeap(1, {})).toBeNull();
  expect(readJsHeap(1, { HermesInternal: {} })).toBeNull();
  expect(
    readJsHeap(1, {
      HermesInternal: {
        getInstrumentedStats: () => {
          throw new Error('x');
        },
      },
    }),
  ).toBeNull();
  expect(
    readJsHeap(5, {
      HermesInternal: {
        getInstrumentedStats: () => ({ js_heapSize: 2048, js_allocatedBytes: 1024 }),
      },
    }),
  ).toEqual({ t: 5, heapSizeBytes: 2048, allocatedBytes: 1024 });
  expect(
    readJsHeap(5, { HermesInternal: { getInstrumentedStats: () => ({ js_heapSize: 2048 }) } }),
  ).toEqual({ t: 5, heapSizeBytes: 2048, allocatedBytes: null });
});
