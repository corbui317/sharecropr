import { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { BootSplash } from '@/features/auth/components/BootSplash';
import { DeletionStatusError } from '@/features/auth/components/DeletionStatusError';
import { useAuthSession } from '@/features/auth/hooks/useAuthSession';
import { useDeletionStatus } from '@/features/auth/hooks/useDeletionStatus';
import { useIntentKey } from '@/features/auth/hooks/useIntentKey';
import { cancelAccountDeletion, signOut } from '@/features/auth/lib/auth-service';
import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

export function RestoreAccountScreen() {
  const { status, session, user } = useAuthSession();
  const { state, retry } = useDeletionStatus(user?.id ?? null);
  const intent = useIntentKey();
  const [loading, setLoading] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [graceElapsed, setGraceElapsed] = useState(false);

  if (status === 'loading') return <BootSplash />;
  if (!session) return <Redirect href={routes.signIn} />;
  if (state.kind === 'idle' || state.kind === 'loading') return <BootSplash />;
  if (state.kind !== 'ready') return <DeletionStatusError onRetry={retry} />;
  const deletionStatus = state.status;
  if (!deletionStatus.pending) return <Redirect href={routes.map} />;

  if (graceElapsed || deletionStatus.grace_elapsed) {
    return (
      <AuthScreenShell title="Account deleted" subtitle={authCopy.graceElapsed}>
        <AuthButton
          label="Start over"
          onPress={() => {
            void signOut().then(() => router.replace(routes.signUp));
          }}
        />
      </AuthScreenShell>
    );
  }

  const requestDate = deletionStatus.requested_at
    ? new Date(deletionStatus.requested_at).toLocaleDateString()
    : '—';
  const scheduledDate = deletionStatus.scheduled_at
    ? new Date(deletionStatus.scheduled_at).toLocaleDateString()
    : '—';

  const handleKeep = async () => {
    setLoading(true);
    setRestoreError(null);
    const result = await cancelAccountDeletion(intent.key);
    setLoading(false);
    if (result.ok || result.reason === 'not_found') {
      router.replace(routes.map);
      return;
    }
    if (result.reason === 'grace_elapsed') {
      setGraceElapsed(true);
      return;
    }
    setRestoreError(authCopy.restoreFailed);
  };

  return (
    <AuthScreenShell
      title={authCopy.restoreTitle}
      subtitle={authCopy.restoreBody(requestDate, scheduledDate)}
    >
      <AuthButton label={authCopy.restoreKeep} loading={loading} onPress={() => void handleKeep()} />
      <AuthButton
        label={authCopy.restoreContinue}
        variant="secondary"
        onPress={() => {
          void signOut().then(() => router.replace(routes.signIn));
        }}
      />
      {restoreError ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {restoreError}
        </Text>
      ) : null}
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  error: { color: '#b42318', fontSize: 14 },
});
