import { useCallback, useEffect, useRef, useState } from 'react';
import type { Href } from 'expo-router';

import { signOutAndRedirect } from '@/features/auth/lib/sign-out';

/** SPEC-001-T55: pending/failed state around signOutAndRedirect. Safe to unmount mid-flight. */
export function useSignOutAndRedirect(target?: Href): {
  signOut: () => void;
  pending: boolean;
  failed: boolean;
} {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const signOut = useCallback(() => {
    setPending(true);
    setFailed(false);
    void signOutAndRedirect(target).then((outcome) => {
      if (!mounted.current) return;
      setPending(false);
      setFailed(outcome === 'failed');
    });
  }, [target]);

  return { signOut, pending, failed };
}
