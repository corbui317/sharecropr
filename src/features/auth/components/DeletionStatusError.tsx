import { StyleSheet, Text } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { useSignOutAndRedirect } from '@/features/auth/hooks/useSignOutAndRedirect';
import { authCopy } from '@/features/auth/lib/copy';

/** Invariant 10: a failed deletion-status check is an actionable error, never a blank screen. */
export function DeletionStatusError({ onRetry }: { onRetry: () => void }) {
  const { signOut, pending, failed } = useSignOutAndRedirect();
  return (
    <AuthScreenShell title={authCopy.accountStatusTitle} subtitle={authCopy.accountStatusBody}>
      <AuthButton label={authCopy.tryAgain} onPress={onRetry} />
      <AuthButton label={authCopy.signOut} variant="secondary" loading={pending} onPress={signOut} />
      {failed ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {authCopy.signOutFailed}
        </Text>
      ) : null}
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  error: { color: '#b42318', fontSize: 14 },
});
