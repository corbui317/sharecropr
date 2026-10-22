import { Redirect } from 'expo-router';

import { BootSplash } from '@/features/auth/components/BootSplash';
import { DeletionStatusError } from '@/features/auth/components/DeletionStatusError';
import { useAuthSession } from '@/features/auth/hooks/useAuthSession';
import { useDeletionStatus } from '@/features/auth/hooks/useDeletionStatus';
import { routes } from '@/features/auth/lib/routes';

/**
 * Root route logic (SPEC-001-T46). Lives here because every .ts(x) under app/ is a route; app/index.tsx
 * only re-exports it.
 */
export function BootGateScreen() {
  const { status, session, user, isEmailVerified } = useAuthSession();
  const { state, retry } = useDeletionStatus(user?.id ?? null);

  if (status === 'loading') return <BootSplash />;
  if (!session) return <Redirect href={routes.signIn} />;
  if (state.kind === 'idle' || state.kind === 'loading') return <BootSplash />;
  if (state.kind === 'error') return <DeletionStatusError onRetry={retry} />;
  if (state.kind === 'ready' && state.status.pending) return <Redirect href={routes.restoreAccount} />;
  // 'unreachable' (offline / timeout) opens the app normally — SPEC-001 §8.2 Offline. Grace-period
  // writes are refused server-side (EC-07), so this cannot leak a deleted account's capabilities.
  if (!isEmailVerified) return <Redirect href={routes.verifyEmail} />;
  return <Redirect href={routes.map} />;
}
