import { useEffect, useRef, useState } from 'react';

import type { DeviceLocation } from '@/domain/geo/types';
import { lerpLocation, progressAt } from '@/features/map/lib/avatarInterpolation';
import { FOLLOW_ANIMATION_MS } from '@/features/map/lib/followMode';

/**
 * Eases the avatar between fixes (SPEC-008 R02, SCR-0102). Linear over the follow-camera duration so a
 * following avatar stays near the centre. The device position lives in component memory only (R10):
 * never logged, persisted or sent anywhere. The rAF timestamp is the clock; the first frame is t=0.
 */
export function useInterpolatedLocation(
  target: DeviceLocation | null,
  durationMs: number = FOLLOW_ANIMATION_MS,
): DeviceLocation | null {
  const [shown, setShown] = useState<DeviceLocation | null>(target);
  const shownRef = useRef<DeviceLocation | null>(target);

  useEffect(() => {
    const show = (location: DeviceLocation | null) => {
      shownRef.current = location;
      setShown(location);
    };

    if (target === null) {
      show(null);
      return;
    }
    const from = shownRef.current;
    if (from === target) return; // already displayed (mount): nothing to animate
    if (from === null || durationMs <= 0) {
      show(target);
      return;
    }

    let frameId = 0;
    let startedAt: number | null = null;
    const step = (ts: number) => {
      startedAt ??= ts;
      const t = progressAt(startedAt, ts, durationMs);
      show(lerpLocation(from, target, t));
      if (t < 1) frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [target, durationMs]);

  return shown;
}
