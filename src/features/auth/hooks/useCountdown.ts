import { useEffect, useReducer, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

const remainingSec = (untilMs: number | null) =>
  untilMs === null ? 0 : Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));

/**
 * Deadline-based countdown (SPEC-001 §8.2 Rate limited, §12). Remaining time is recomputed from the
 * wall clock on each tick, so a backgrounded app or skipped ticks cannot drift. Screen readers hear
 * it at the start and when it crosses 60, 30 and 0 only; announcing every second would be noise.
 * SPEC-001-T56.
 */
export function useCountdown(
  untilMs: number | null,
  messageFor: (remainingSec: number) => string,
): number {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const remaining = remainingSec(untilMs);
  const previous = useRef<number | null>(null);
  const messageRef = useRef(messageFor);
  messageRef.current = messageFor;

  useEffect(() => {
    previous.current = null;
  }, [untilMs]);

  // Announcements happen in the tick itself, not in a render effect: React batches renders, so a
  // render-based check would miss thresholds crossed between two committed renders.
  const announceIfCrossed = (now: number) => {
    const prev = previous.current;
    previous.current = now;
    const crossed =
      prev === null ||
      (now === 0 && prev > 0) ||
      (prev > 60 && now <= 60 && now > 0) ||
      (prev > 30 && now <= 30 && now > 0);
    if (crossed) AccessibilityInfo.announceForAccessibility(messageRef.current(now));
  };

  const running = untilMs !== null && remaining > 0;
  useEffect(() => {
    if (untilMs === null) return;
    announceIfCrossed(remainingSec(untilMs)); // start
    if (!running) return;
    const timer = setInterval(() => {
      announceIfCrossed(remainingSec(untilMs));
      tick();
    }, 1000);
    return () => clearInterval(timer);
    // announceIfCrossed only touches refs, so it is deliberately not a dependency
  }, [running, untilMs]);

  return remaining;
}
