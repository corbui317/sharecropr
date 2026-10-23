import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useCountdown } from '../useCountdown';

// SPEC-001-T56 (§8.2 Rate limited, §12): deadline-based countdown, announced at start, 60, 30 and 0 only.

let announce: jest.SpiedFunction<typeof AccessibilityInfo.announceForAccessibility>;
const message = (n: number) => `remaining ${n}`;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-22T12:00:00Z'));
  jest.clearAllMocks();
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// RNTL schedules its own timers, so count only the intervals this hook creates and clears.
function spyIntervals() {
  const set = jest.spyOn(globalThis, 'setInterval');
  const clear = jest.spyOn(globalThis, 'clearInterval');
  const mine = () => set.mock.results.filter((_, i) => set.mock.calls[i]?.[1] === 1000);
  return { set, clear, mine };
}

async function tick(sec: number) {
  await act(async () => {
    jest.advanceTimersByTime(sec * 1000);
  });
}

describe('useCountdown', () => {
  test('null -> 0, no timer, no announcement (SPEC-001-T56)', async () => {
    const spy = spyIntervals();
    const { result } = await renderHook(() => useCountdown(null, message));
    expect(result.current).toBe(0);
    expect(spy.mine()).toHaveLength(0);
    expect(announce).not.toHaveBeenCalled();
  });

  test('counts down from the deadline and announces once at the start (SPEC-001-T56)', async () => {
    const until = Date.now() + 90_000;
    const { result } = await renderHook(() => useCountdown(until, message));
    expect(result.current).toBe(90);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('remaining 90');
    await tick(1);
    expect(result.current).toBe(89);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  test('over a full run it announces exactly start, 60, 30, 0 and stops (SPEC-001-T56)', async () => {
    const spy = spyIntervals();
    const until = Date.now() + 90_000;
    const { result } = await renderHook(() => useCountdown(until, message));
    expect(spy.mine()).toHaveLength(1);
    await tick(95);
    expect(result.current).toBe(0);
    expect(announce.mock.calls.map((c) => c[0])).toEqual([
      'remaining 90',
      'remaining 60',
      'remaining 30',
      'remaining 0',
    ]);
    expect(spy.clear).toHaveBeenCalledWith(spy.mine()[0]?.value);
  });

  test('is deadline-based: a skipped clock jumps to 0 with the 0 announcement (SPEC-001-T56)', async () => {
    const until = Date.now() + 90_000;
    const { result } = await renderHook(() => useCountdown(until, message));
    await act(async () => {
      jest.setSystemTime(Date.now() + 100_000);
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(0);
    expect(announce).toHaveBeenLastCalledWith('remaining 0');
  });

  test('unmounting mid-countdown clears the interval (SPEC-001-T56)', async () => {
    const spy = spyIntervals();
    const until = Date.now() + 90_000;
    const { unmount } = await renderHook(() => useCountdown(until, message));
    expect(spy.mine()).toHaveLength(1);
    expect(spy.clear).not.toHaveBeenCalledWith(spy.mine()[0]?.value);
    await unmount();
    expect(spy.clear).toHaveBeenCalledWith(spy.mine()[0]?.value);
  });
});
