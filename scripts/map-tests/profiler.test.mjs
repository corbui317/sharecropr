import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_RING_CAPACITY,
  clearFrames,
  createFrameRing,
  frameSamples,
  percentile,
  pushFrame,
  ringCapacityFor,
  summarizeFrames,
} from '../../src/features/map/lib/fpsSummary.ts';
import {
  EMPTY_RENDER_MILESTONES,
  markFrameRendered,
  markMilestone,
} from '../../src/features/map/lib/renderMilestones.ts';
import { readJsHeap } from '../../src/features/map/lib/jsHeap.ts';

// Tooling for SPEC-008-T41 (R53) and SPEC-008-T72 (R73). These unit tests check the measurement
// math only; they do NOT satisfy T41/T72, which are on-device perf runs.

const s = (frameMs, timestamp = 0) => ({ timestamp, frameMs });
const many = (n, frameMs) => Array.from({ length: n }, (_, i) => s(frameMs, i * frameMs));

test('empty input summarises to zeros (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames([]);
  assert.equal(r.frameCount, 0);
  assert.equal(r.durationMs, 0);
  assert.equal(r.avgFps, 0);
  assert.equal(r.p95FrameMs, 0);
  assert.equal(r.maxFrameMs, 0);
  assert.equal(r.minInstantFps, 0);
  assert.deepEqual(r.windowFps, []);
  assert.equal(r.worstWindowFps, null);
});

test('steady 60 Hz: ~60 fps, nothing dropped or over budget (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames(many(120, 1000 / 60));
  assert.equal(r.frameCount, 120);
  assert.ok(Math.abs(r.avgFps - 60) < 1e-9);
  assert.equal(r.droppedFrames, 0);
  assert.equal(r.framesOverBudget, 0);
  assert.ok(r.windowFps.length >= 1);
  for (const w of r.windowFps) assert.ok(w > 59.5 && w < 60.5);
});

test('percentiles are nearest-rank over sorted intervals (SPEC-008-T41 tooling)', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1).reverse();
  const r = summarizeFrames(values.map((v) => s(v)));
  assert.equal(r.p50FrameMs, 50);
  assert.equal(r.p95FrameMs, 95);
  assert.equal(r.p99FrameMs, 99);
  assert.equal(r.maxFrameMs, 100);
  assert.equal(r.minInstantFps, 10);
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([7], 95), 7);
});

test('R53 budget counts frames strictly over 32 ms (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames([s(32), s(32.01)]);
  assert.equal(r.framesOverBudget, 1);
});

test('dropped frames count missed vsyncs against the target interval (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames([s(1000 / 60), s(2000 / 60), s(3000 / 60)]);
  assert.equal(r.droppedFrames, 3);
  const r120 = summarizeFrames(many(3, 1000 / 60), { targetFrameMs: 1000 / 120 });
  assert.equal(r120.droppedFrames, 3);
});

test('worst one-second window exposes an unsustained stretch (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames([...many(50, 20), ...many(25, 40)]);
  assert.deepEqual(r.windowFps, [50, 25]);
  assert.equal(r.worstWindowFps, 25);
  assert.equal(r.avgFps, 37.5);
  assert.equal(r.framesOverBudget, 25);
  assert.equal(r.droppedFrames, 25);
});

test('pauses longer than maxGapMs are excluded and counted (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames([s(16), s(16), s(5000), s(16)]);
  assert.equal(r.gapCount, 1);
  assert.equal(r.frameCount, 3);
  assert.equal(r.maxFrameMs, 16);
});

test('non-finite and non-positive intervals are discarded (SPEC-008-T41 tooling)', () => {
  const r = summarizeFrames([s(0), s(-1), s(Number.NaN), s(Number.POSITIVE_INFINITY), s(16)]);
  assert.equal(r.invalidCount, 4);
  assert.equal(r.frameCount, 1);
});

test('default ring covers at least 60 s at 120 Hz (SPEC-008-T41 tooling)', () => {
  assert.equal(ringCapacityFor(60, 120), 7200);
  assert.ok(DEFAULT_RING_CAPACITY >= 60 * 120);
});

test('ring keeps insertion order below capacity', () => {
  const ring = createFrameRing(4);
  pushFrame(ring, 1, 10);
  pushFrame(ring, 2, 20);
  assert.equal(ring.size, 2);
  assert.deepEqual(frameSamples(ring), [s(10, 1), s(20, 2)]);
});

test('ring overwrites oldest on wrap and counts overwrites', () => {
  const ring = createFrameRing(3);
  for (let i = 1; i <= 5; i += 1) pushFrame(ring, i, i * 10);
  assert.equal(ring.size, 3);
  assert.equal(ring.overwritten, 2);
  assert.deepEqual(frameSamples(ring), [s(30, 3), s(40, 4), s(50, 5)]);
  clearFrames(ring);
  assert.equal(ring.size, 0);
  assert.equal(ring.overwritten, 0);
  assert.deepEqual(frameSamples(ring), []);
});

test('ring rejects a non-positive or fractional capacity', () => {
  assert.throws(() => createFrameRing(0), RangeError);
  assert.throws(() => createFrameRing(2.5), RangeError);
});

test('render milestones are first-write-wins and rounded (SPEC-008-T72 tooling)', () => {
  const a = markMilestone(EMPTY_RENDER_MILESTONES, 'styleLoaded', 120.6);
  assert.equal(a.styleLoaded, 121);
  const b = markMilestone(a, 'styleLoaded', 999);
  assert.equal(b, a);
  assert.equal(markMilestone(a, 'mapFullyRendered', Number.NaN), a);
  assert.equal(markMilestone(a, 'mapFullyRendered', -1), a);
});

test('a frame before style load is not a painted map frame (SPEC-008-T72 tooling)', () => {
  assert.equal(markFrameRendered(EMPTY_RENDER_MILESTONES, false, 50), EMPTY_RENDER_MILESTONES);
});

test('first frame and first fully-rendered frame bracket first painted tile (SPEC-008-T72 tooling)', () => {
  const styled = markMilestone(EMPTY_RENDER_MILESTONES, 'styleLoaded', 100);
  const partial = markFrameRendered(styled, false, 150);
  assert.equal(partial.firstFrame, 150);
  assert.equal(partial.firstFullFrame, null);
  const full = markFrameRendered(partial, true, 400);
  assert.equal(full.firstFrame, 150);
  assert.equal(full.firstFullFrame, 400);
  // On Android a frame emits exactly one of Frame / FrameFully, so a fully-rendered
  // first frame must also set firstFrame.
  const fullFirst = markFrameRendered(styled, true, 300);
  assert.equal(fullFirst.firstFrame, 300);
  assert.equal(fullFirst.firstFullFrame, 300);
});

test('JS heap reader tolerates missing or throwing Hermes stats', () => {
  assert.equal(readJsHeap(1, {}), null);
  assert.equal(readJsHeap(1, { HermesInternal: {} }), null);
  assert.equal(
    readJsHeap(1, { HermesInternal: { getInstrumentedStats: () => { throw new Error('x'); } } }),
    null,
  );
  assert.deepEqual(
    readJsHeap(5, { HermesInternal: { getInstrumentedStats: () => ({ js_heapSize: 2048, js_allocatedBytes: 1024 }) } }),
    { t: 5, heapSizeBytes: 2048, allocatedBytes: 1024 },
  );
  assert.deepEqual(
    readJsHeap(5, { HermesInternal: { getInstrumentedStats: () => ({ js_heapSize: 2048 }) } }),
    { t: 5, heapSizeBytes: 2048, allocatedBytes: null },
  );
});
