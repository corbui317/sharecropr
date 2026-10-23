// SPEC-008-T04 · SPEC-008-T07 · SPEC-008-T08 (partial) · R01 · R06 · R07 · Invariant 4 · SCRUM-25
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import type { DeviceLocation } from '@/domain/geo/types';
import { useFollowMode, type FollowModeController } from '@/features/map/hooks/useFollowMode';
import { INITIAL_FOLLOW_STATE } from '@/features/map/lib/followMode';
import { useFollowModeStore } from '@/features/map/stores/followModeStore';

jest.mock('expo-location', () => {
  const state: { watcher: ((fix: unknown) => void) | null } = { watcher: null };
  return {
    __state: state,
    Accuracy: { Balanced: 3 },
    requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
    requestBackgroundPermissionsAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 45, longitude: -122 } })),
    watchPositionAsync: jest.fn(async (_opts: unknown, cb: (fix: unknown) => void) => {
      state.watcher = cb;
      return { remove: jest.fn() };
    }),
  };
});

type LocationMock = {
  __state: { watcher: ((fix: unknown) => void) | null };
  requestBackgroundPermissionsAsync: jest.Mock;
  watchPositionAsync: jest.Mock;
};
const location = () => jest.requireMock<LocationMock>('expo-location');

const A: DeviceLocation = { latitude: 45, longitude: -122 };

async function pushFix(latitude: number, longitude: number) {
  await act(async () => {
    location().__state.watcher?.({ coords: { latitude, longitude } });
  });
}

async function boot(onAnimateToUser: (l: DeviceLocation) => void) {
  const hook = await renderHook<FollowModeController, { cb: (l: DeviceLocation) => void }>(({ cb }) => useFollowMode({ onAnimateToUser: cb }), {
    initialProps: { cb: onAnimateToUser },
  });
  await act(async () => {});
  return hook;
}

beforeEach(() => {
  useFollowModeStore.setState(INITIAL_FOLLOW_STATE);
  location().__state.watcher = null;
  location().watchPositionAsync.mockClear();
  location().requestBackgroundPermissionsAsync.mockClear();
});

describe('useFollowMode', () => {
  test('at boot, following: the initial fix animates to the user once (R01, R07)', async () => {
    const onAnimateToUser = jest.fn();
    await boot(onAnimateToUser);
    expect(onAnimateToUser).toHaveBeenCalledTimes(1);
    expect(onAnimateToUser).toHaveBeenCalledWith(A);
  });

  test('onGestureStart clears following immediately, before any gesture end (SPEC-008-T04, R04, SCRUM-25 AC1)', async () => {
    const { result } = await boot(jest.fn());
    await act(async () => {
      result.current.onGestureStart();
    });
    expect(useFollowModeStore.getState().following).toBe(false);
    expect(result.current.following).toBe(false);
  });

  test('a watcher fix during a gesture updates the avatar but does not animate (SPEC-008-T07, SCRUM-25 AC2)', async () => {
    const onAnimateToUser = jest.fn();
    const { result } = await boot(onAnimateToUser);
    onAnimateToUser.mockClear();
    await act(async () => {
      result.current.onGestureStart();
    });
    await pushFix(46, -121);
    expect(onAnimateToUser).not.toHaveBeenCalled();
    expect(result.current.userLocation).toEqual({ latitude: 46, longitude: -121 });
  });

  test('after onGestureEnd a fix still does not animate (R07)', async () => {
    const onAnimateToUser = jest.fn();
    const { result } = await boot(onAnimateToUser);
    onAnimateToUser.mockClear();
    await act(async () => {
      result.current.onGestureStart();
    });
    await act(async () => {
      result.current.onGestureEnd();
    });
    await pushFix(46, -121);
    expect(onAnimateToUser).not.toHaveBeenCalled();
  });

  test('recenter follows again, animates to the last fix, and the next fix animates (R06)', async () => {
    const onAnimateToUser = jest.fn();
    const { result } = await boot(onAnimateToUser);
    await act(async () => {
      result.current.onGestureStart();
    });
    await act(async () => {
      result.current.onGestureEnd();
    });
    onAnimateToUser.mockClear();
    await act(async () => {
      result.current.recenter();
    });
    expect(useFollowModeStore.getState().following).toBe(true);
    expect(onAnimateToUser).toHaveBeenCalledWith(A);
    onAnimateToUser.mockClear();
    await pushFix(46, -121);
    expect(onAnimateToUser).toHaveBeenCalledWith({ latitude: 46, longitude: -121 });
  });

  test('a gesture start with no end followed by recenter still animates (stuck-gesture guard)', async () => {
    const onAnimateToUser = jest.fn();
    const { result } = await boot(onAnimateToUser);
    await act(async () => {
      result.current.onGestureStart();
    });
    onAnimateToUser.mockClear();
    await act(async () => {
      result.current.recenter();
    });
    expect(onAnimateToUser).toHaveBeenCalledWith(A);
  });

  test('never asks for background permission and watches with exactly the foreground options (Invariant 4)', async () => {
    await boot(jest.fn());
    expect(location().requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location().watchPositionAsync).toHaveBeenCalledTimes(1);
    expect(location().watchPositionAsync.mock.calls[0]?.[0]).toEqual({
      accuracy: 3,
      distanceInterval: 5,
      timeInterval: 2000,
    });
  });

  test('a new onAnimateToUser identity does not resubscribe the watcher', async () => {
    const { rerender } = await boot(jest.fn());
    await rerender({ cb: jest.fn() });
    await act(async () => {});
    expect(location().watchPositionAsync).toHaveBeenCalledTimes(1);
  });

  test('following is read from Zustand (SPEC-008-T08 partial)', async () => {
    const { result } = await boot(jest.fn());
    await act(async () => {
      useFollowModeStore.setState({ following: false });
    });
    expect(result.current.following).toBe(false);
  });
});
