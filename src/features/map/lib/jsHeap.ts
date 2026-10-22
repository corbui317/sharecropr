/**
 * Hermes JS-heap sample. JS heap only — NOT process memory; NFR-09 (< 250 MB) is measured
 * with `adb shell dumpsys meminfo` / Xcode Instruments. Pure, erasable TypeScript only.
 */

export type JsHeapSample = { t: number; heapSizeBytes: number; allocatedBytes: number | null };

type HermesStats = { js_heapSize?: unknown; js_allocatedBytes?: unknown };
type HermesHost = { HermesInternal?: { getInstrumentedStats?: () => HermesStats } };

export function readJsHeap(t: number, host: unknown = globalThis): JsHeapSample | null {
  let stats: HermesStats | undefined;
  try {
    stats = (host as HermesHost).HermesInternal?.getInstrumentedStats?.();
  } catch {
    return null;
  }
  if (!stats || typeof stats.js_heapSize !== 'number') return null;
  return {
    t,
    heapSizeBytes: stats.js_heapSize,
    allocatedBytes: typeof stats.js_allocatedBytes === 'number' ? stats.js_allocatedBytes : null,
  };
}
