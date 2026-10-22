import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { startAutoRefresh, stopAutoRefresh } from '@/api/supabase';

/**
 * App boot hook (SCRUM-62): drives GoTrue token auto-refresh from the app lifecycle — SPEC-001 R24,
 * startAutoRefresh() on `active`, stopAutoRefresh() otherwise. Without it, a user who backgrounds the
 * app for an hour returns to a 401 storm (mobile-architecture §5.3, ADR-0007).
 *
 * It lives in features, not src/api, because src/api must not import React Native (Invariant 11).
 * Mount exactly once, in app/_layout.tsx.
 */
export function useAuthAutoRefresh(): void {
  useEffect(() => {
    // Sync to the state we boot into. On React Native the SDK starts its ticker at client construction,
    // so only the two unambiguous states act here; 'unknown' / 'inactive' at boot leave it running
    // rather than risk stopping refresh in an app that is actually in the foreground.
    const initial = AppState.currentState;
    if (initial === 'active') void startAutoRefresh();
    else if (initial === 'background') void stopAutoRefresh();

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void startAutoRefresh();
      else void stopAutoRefresh();
    });
    return () => subscription.remove();
  }, []);
}
