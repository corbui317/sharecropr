import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

import type { DeviceLocation } from '@/domain/geo/types';
import { useFollowModeStore } from '@/features/map/stores/followModeStore';

export type FollowModeController = {
  userLocation: DeviceLocation | null;
  following: boolean;
  requestPermission: () => Promise<boolean>;
  recenter: () => void;
  onUserGesture: () => void;
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
  const setFollowing = useFollowModeStore((s) => s.setFollowing);
  const userLocationRef = useRef<DeviceLocation | null>(null);
  const [userLocation, setUserLocation] = useState<DeviceLocation | null>(null);

  const applyLocation = useCallback(
    (location: DeviceLocation, animate: boolean) => {
      userLocationRef.current = location;
      setUserLocation(location);
      if (animate && useFollowModeStore.getState().following) {
        onAnimateToUser(location);
      }
    },
    [onAnimateToUser],
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
          applyLocation(toDevice(initial), useFollowModeStore.getState().following);
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
            applyLocation(toDevice(fix), useFollowModeStore.getState().following);
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
    setFollowing(true);
    if (userLocationRef.current) {
      onAnimateToUser(userLocationRef.current);
    }
  }, [onAnimateToUser, setFollowing]);

  const onUserGesture = useCallback(() => {
    setFollowing(false);
  }, [setFollowing]);

  return {
    userLocation,
    following,
    requestPermission,
    recenter,
    onUserGesture,
  };
}
