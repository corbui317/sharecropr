import type { DeviceLocation } from '@/domain/geo/types';

/** Linear interpolation between two fixes; t is clamped to [0, 1]. No antimeridian handling (launch metros only). */
export function lerpLocation(from: DeviceLocation, to: DeviceLocation, t: number): DeviceLocation {
  const k = Math.min(1, Math.max(0, t));
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * k,
    longitude: from.longitude + (to.longitude - from.longitude) * k,
  };
}

/** Animation progress in [0, 1]; a non-positive duration is already complete. */
export function progressAt(startedAt: number, now: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (now - startedAt) / durationMs));
}
