import { router, type Href } from 'expo-router';

import { signOut } from '@/features/auth/lib/auth-service';
import { routes } from '@/features/auth/lib/routes';

let inFlight: Promise<'signed_out' | 'failed'> | null = null;

/**
 * The one way a screen signs the user out (SPEC-001-T55, R25, Invariant 10). Single-flight, never
 * rejects, and navigates only after sign-out succeeded. On failure the session may still be present,
 * so navigating would just bounce back through `/`; the caller shows `authCopy.signOutFailed` and
 * stays on its screen instead.
 */
export function signOutAndRedirect(target: Href = routes.signIn): Promise<'signed_out' | 'failed'> {
  if (inFlight) return inFlight;
  const run = (async (): Promise<'signed_out' | 'failed'> => {
    try {
      await signOut();
      router.replace(target);
      return 'signed_out';
    } catch {
      return 'failed';
    } finally {
      inFlight = null;
    }
  })();
  inFlight = run;
  return run;
}
