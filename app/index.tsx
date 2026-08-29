import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';

import { BootSplash } from '@/features/auth/components/BootSplash';
import { useAuthSession } from '@/features/auth/hooks/useAuthSession';
import { getDeletionStatus } from '@/features/auth/lib/auth-service';

import { routes } from '@/features/auth/lib/routes';

export default function Index() {
  const { status, session, isEmailVerified } = useAuthSession();
  const [pendingDeletion, setPendingDeletion] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) {
      setPendingDeletion(false);
      return;
    }
    void getDeletionStatus().then(({ data }) => {
      const payload = data as { pending?: boolean } | null;
      setPendingDeletion(Boolean(payload?.pending));
    });
  }, [session]);

  if (status === 'loading' || (session && pendingDeletion === null)) {
    return <BootSplash />;
  }

  if (!session) {
    return <Redirect href={routes.signIn} />;
  }

  if (pendingDeletion) {
    return <Redirect href={routes.restoreAccount} />;
  }

  if (!isEmailVerified) {
    return <Redirect href={routes.verifyEmail} />;
  }

  return <Redirect href={routes.map} />;
}
