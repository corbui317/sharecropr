import { router } from 'expo-router';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { signOut } from '@/features/auth/lib/auth-service';
import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

/** Invariant 10: a failed deletion-status check is an actionable error, never a blank screen. */
export function DeletionStatusError({ onRetry }: { onRetry: () => void }) {
  return (
    <AuthScreenShell title={authCopy.accountStatusTitle} subtitle={authCopy.accountStatusBody}>
      <AuthButton label={authCopy.tryAgain} onPress={onRetry} />
      <AuthButton
        label={authCopy.signOut}
        variant="secondary"
        onPress={() => {
          void signOut().then(() => router.replace(routes.signIn));
        }}
      />
    </AuthScreenShell>
  );
}
