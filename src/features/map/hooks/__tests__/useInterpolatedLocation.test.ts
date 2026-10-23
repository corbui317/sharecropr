// SPEC-008 R02 (avatar interpolation) · SCR-0102 · SCRUM-25
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import type { DeviceLocation } from '@/domain/geo/types';
import { useInterpolatedLocation } from '@/features/map/hooks/useInterpolatedLocation';

const A: DeviceLocation = { latitude: 45, longitude: -122 };
const B: DeviceLocation = { latitude: 46, longitude: -121 };
const C: DeviceLocation = { latitude: 47, longitude: -120 };

type Frame = { id: number; cb: (ts: number) => void };
let frames: Frame[] = [];
let nextId = 1;
let cancelSpy: jest.SpiedFunction<typeof cancelAnimationFrame>;

// Manual rAF queue: RN's preset defines rAF as a zero-delay timer, which fake timers would spin on.
async function frame(ts: number) {
  const due = frames;
  frames = [];
  await act(async () => {
    due.forEach((f) => f.cb(ts));
  });
}

beforeEach(() => {
  frames = [];
  nextId = 1;
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = nextId++;
    frames.push({ id, cb });
    return id;
  });
  cancelSpy = jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
    frames = frames.filter((f) => f.id !== id);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useInterpolatedLocation', () => {
  test('the first non-null target is returned immediately with no frame requested', async () => {
    const { result } = await renderHook<DeviceLocation | null, { t: DeviceLocation | null }>(({ t }) => useInterpolatedLocation(t), {
      initialProps: { t: A as DeviceLocation | null },
    });
    expect(result.current).toEqual(A);
    expect(frames).toHaveLength(0);
  });

  test('a new target eases A -> midpoint -> B over 200 ms, then stops requesting frames', async () => {
    const { result, rerender } = await renderHook<DeviceLocation | null, { t: DeviceLocation | null }>(({ t }) => useInterpolatedLocation(t), {
      initialProps: { t: A as DeviceLocation | null },
    });
    await rerender({ t: B });
    await frame(1000);
    expect(result.current).toEqual(A);
    await frame(1100);
    expect(result.current?.latitude).toBeCloseTo(45.5, 10);
    expect(result.current?.longitude).toBeCloseTo(-121.5, 10);
    await frame(1200);
    expect(result.current).toEqual(B);
    expect(frames).toHaveLength(0);
  });

  test('retargeting mid-flight starts from the displayed midpoint and cancels the old frame', async () => {
    const { result, rerender } = await renderHook<DeviceLocation | null, { t: DeviceLocation | null }>(({ t }) => useInterpolatedLocation(t), {
      initialProps: { t: A as DeviceLocation | null },
    });
    await rerender({ t: B });
    await frame(1000);
    await frame(1100);
    cancelSpy.mockClear();
    await rerender({ t: C });
    expect(cancelSpy).toHaveBeenCalled();
    await frame(2000);
    expect(result.current?.latitude).toBeCloseTo(45.5, 10);
    await frame(2200);
    expect(result.current).toEqual(C);
  });

  test('unmounting mid-flight cancels the pending frame', async () => {
    const { rerender, unmount } = await renderHook<DeviceLocation | null, { t: DeviceLocation | null }>(({ t }) => useInterpolatedLocation(t), {
      initialProps: { t: A as DeviceLocation | null },
    });
    await rerender({ t: B });
    expect(frames).toHaveLength(1);
    await unmount();
    expect(frames).toHaveLength(0);
  });

  test('a null target returns null', async () => {
    const { result } = await renderHook<DeviceLocation | null, { t: DeviceLocation | null }>(({ t }) => useInterpolatedLocation(t), {
      initialProps: { t: null as DeviceLocation | null },
    });
    expect(result.current).toBeNull();
  });
});
