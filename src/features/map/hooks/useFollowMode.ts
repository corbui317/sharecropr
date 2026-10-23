import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

import type { DeviceLocation } from '@/domain/geo/types';
import type { FollowEvent } from '@/features/map/lib/followMode';
import { useFollowModeStore } from '@/features/map/stores/followModeStore';

export type FollowModeController = {
  userLocation: DeviceLocation | null;
  following: boolean;
  requestPermission: () => Promise<boolean>;
  recenter: () => void;
  /** A user pan/pinch/rotate began: follow clears now, not at gesture end (R04). */
  onGestureStart: () => void;
  onGestureEnd: () => void;
};

type Options = {
  onAnimateToUser: (location: DeviceLocation) => void;
};

/**
 * Follow-mode state per SPEC-008 §5.1 and Mobile Architecture §4.2.
 * `following` lives in Zustand so location ticks do not re-render the marker tree.
 */
export function useFollowMode({ onAnimateToUser }: Options): FollowModeController {
  const following = useFollowModeStore((s) => s.following);
  const userLocationRef = useRef<DeviceLocation | null>(null);
  const [userLocation, setUserLocation] = useState<DeviceLocation | null>(null);

  const animateRef = useRef(onAnimateToUser);
  animateRef.current = onAnimateToUser;

  // The reducer owns every follow decision; this only runs the effect it returns.
  const run = useCallback((event: FollowEvent) => {
    const effect = useFollowModeStore.getState().dispatch(event);
    if (effect === 'animateToUser' && userLocationRef.current) {
      animateRef.current(userLocationRef.current);
    }
  }, []);

  const applyLocation = useCallback(
    (location: DeviceLocation) => {
      userLocationRef.current = location;
      setUserLocation(location);
      run({ type: 'locationFix' });
    },
    [run],
  );

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    const toDevice = (fix: Location.LocationObject): DeviceLocation => ({
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
    });

    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || status !== 'granted') return;

        // A failed initial fix must not prevent the watcher from starting.
        try {
          const initial = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (cancelled) return;
          applyLocation(toDevice(initial));
        } catch {
          if (cancelled) return;
        }

        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 5,
            timeInterval: 2000,
          },
          (fix) => {
            if (cancelled) return;
            applyLocation(toDevice(fix));
          },
        );
        if (cancelled) {
          sub.remove();
          return;
        }
        subscription = sub;
      } catch {
        // Permission/services errors: stay with no location; the map remains usable.
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
      subscription = null;
    };
  }, [applyLocation]);

  const requestPermission = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  }, []);

  const recenter = useCallback(() => {
    run({ type: 'recenter', hasFix: userLocationRef.current !== null });
  }, [run]);

  const onGestureStart = useCallback(() => run({ type: 'gestureStart' }), [run]);
  const onGestureEnd = useCallback(() => run({ type: 'gestureEnd' }), [run]);

  return {
    userLocation,
    following,
    requestPermission,
    recenter,
    onGestureStart,
    onGestureEnd,
  };
}
