/**
 * Frame-interval ring buffer and summary for the EPIC-01 map spike profiler (SCR-0103).
 * Pure: no React / React Native imports, erasable TypeScript only — scripts/map-tests loads it
 * with node --experimental-strip-types.
 */

export type FrameSample = { timestamp: number; frameMs: number };

export const MAX_REFRESH_HZ = 120;
export const DEFAULT_RING_SECONDS = 120;
export const DEFAULT_TARGET_FRAME_MS = 1000 / 60; // ADR-0019 spike gate is 60 fps
export const R53_FRAME_BUDGET_MS = 32; // SPEC-008 R53: no frame exceeding 32 ms
export const DEFAULT_MAX_GAP_MS = 1000; // longer pauses (backgrounding, idle on-demand renderer) are excluded
export const DEFAULT_WINDOW_MS = 1000;

export function ringCapacityFor(seconds: number, maxHz: number = MAX_REFRESH_HZ): number {
  return Math.ceil(seconds * maxHz);
}

export const DEFAULT_RING_CAPACITY = ringCapacityFor(DEFAULT_RING_SECONDS);

export type FrameRing = {
  readonly capacity: number;
  readonly timestamps: Float64Array;
  readonly intervals: Float64Array;
  next: number;
  size: number;
  overwritten: number;
};

export function createFrameRing(capacity: number = DEFAULT_RING_CAPACITY): FrameRing {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`Frame ring capacity must be a positive integer, got ${capacity}`);
  }
  return {
    capacity,
    timestamps: new Float64Array(capacity),
    intervals: new Float64Array(capacity),
    next: 0,
    size: 0,
    overwritten: 0,
  };
}

export function pushFrame(ring: FrameRing, timestamp: number, frameMs: number): void {
  ring.timestamps[ring.next] = timestamp;
  ring.intervals[ring.next] = frameMs;
  ring.next = (ring.next + 1) % ring.capacity;
  if (ring.size < ring.capacity) {
    ring.size += 1;
  } else {
    ring.overwritten += 1;
  }
}

export function clearFrames(ring: FrameRing): void {
  ring.next = 0;
  ring.size = 0;
  ring.overwritten = 0;
}

/** Oldest → newest. */
export function frameSamples(ring: FrameRing): FrameSample[] {
  const out: FrameSample[] = [];
  const start = (ring.next - ring.size + ring.capacity) % ring.capacity;
  for (let i = 0; i < ring.size; i += 1) {
    const idx = (start + i) % ring.capacity;
    out.push({ timestamp: ring.timestamps[idx] ?? 0, frameMs: ring.intervals[idx] ?? 0 });
  }
  return out;
}

/** Nearest-rank percentile of an ascending-sorted array; 0 for empty input. */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx] ?? 0;
}

export type FrameSummaryOptions = {
  targetFrameMs?: number;
  budgetMs?: number;
  maxGapMs?: number;
  windowMs?: number;
};

export type FrameSummary = {
  frameCount: number;
  durationMs: number;
  /** frames ÷ elapsed time (not the mean of instantaneous fps, which is biased high) */
  avgFps: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  minInstantFps: number;
  /** frames with interval > budgetMs (R53: 32 ms) */
  framesOverBudget: number;
  /** missed vsyncs: Σ max(0, round(interval / target) − 1) */
  droppedFrames: number;
  /** fps per complete tumbling window of windowMs of included frame time */
  windowFps: number[];
  worstWindowFps: number | null;
  gapCount: number;
  invalidCount: number;
};

export function summarizeFrames(
  samples: readonly FrameSample[],
  options: FrameSummaryOptions = {},
): FrameSummary {
  const targetFrameMs = options.targetFrameMs ?? DEFAULT_TARGET_FRAME_MS;
  const budgetMs = options.budgetMs ?? R53_FRAME_BUDGET_MS;
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;

  const intervals: number[] = [];
  const windowFps: number[] = [];
  let durationMs = 0;
  let framesOverBudget = 0;
  let droppedFrames = 0;
  let gapCount = 0;
  let invalidCount = 0;
  let windowFrames = 0;
  let windowElapsed = 0;

  for (const sample of samples) {
    const dt = sample.frameMs;
    if (!Number.isFinite(dt) || dt <= 0) {
      invalidCount += 1;
      continue;
    }
    if (dt > maxGapMs) {
      gapCount += 1;
      continue;
    }
    intervals.push(dt);
    durationMs += dt;
    if (dt > budgetMs) framesOverBudget += 1;
    droppedFrames += Math.max(0, Math.round(dt / targetFrameMs) - 1);
    windowFrames += 1;
    windowElapsed += dt;
    if (windowElapsed >= windowMs) {
      windowFps.push((windowFrames * 1000) / windowElapsed);
      windowFrames = 0;
      windowElapsed = 0;
    }
  }

  const sorted = [...intervals].sort((a, b) => a - b);
  const maxFrameMs = sorted.length > 0 ? (sorted[sorted.length - 1] ?? 0) : 0;

  return {
    frameCount: intervals.length,
    durationMs,
    avgFps: durationMs > 0 ? (intervals.length * 1000) / durationMs : 0,
    p50FrameMs: percentile(sorted, 50),
    p95FrameMs: percentile(sorted, 95),
    p99FrameMs: percentile(sorted, 99),
    maxFrameMs,
    minInstantFps: maxFrameMs > 0 ? 1000 / maxFrameMs : 0,
    framesOverBudget,
    droppedFrames,
    windowFps,
    worstWindowFps: windowFps.length > 0 ? Math.min(...windowFps) : null,
    gapCount,
    invalidCount,
  };
}
