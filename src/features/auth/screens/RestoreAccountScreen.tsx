import { useEffect, useState } from 'react';
import { Redirect, router } from 'expo-router';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { useAuthSession } from '@/features/auth/hooks/useAuthSession';
import {
  cancelAccountDeletion,
  getDeletionStatus,
  signOut,
} from '@/features/auth/lib/auth-service';
import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

type DeletionStatus = {
  pending: boolean;
  requested_at?: string;
  scheduled_at?: string;
  grace_elapsed?: boolean;
};

export function RestoreAccountScreen() {
  const { status, session } = useAuthSession();
  const [deletionStatus, setDeletionStatus] = useState<DeletionStatus | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void getDeletionStatus().then(({ data }) => setDeletionStatus((data as DeletionStatus) ?? null));
  }, []);

  if (status === 'loading' || deletionStatus === null) return null;
  if (!session) return <Redirect href={routes.signIn} />;
  if (!deletionStatus.pending) return <Redirect href={routes.map} />;

  if (deletionStatus.grace_elapsed) {
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

  return (
    <AuthScreenShell
      title={authCopy.restoreTitle}
      subtitle={authCopy.restoreBody(requestDate, scheduledDate)}
    >
      <AuthButton
        label={authCopy.restoreKeep}
        loading={loading}
        onPress={() => {
          setLoading(true);
          void cancelAccountDeletion()
            .then(() => router.replace(routes.map))
            .finally(() => setLoading(false));
        }}
      />
      <AuthButton
        label={authCopy.restoreContinue}
        variant="secondary"
        onPress={() => {
          void signOut().then(() => router.replace(routes.signIn));
        }}
      />
    </AuthScreenShell>
  );
}
