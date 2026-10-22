import { useCallback, useEffect, useState } from 'react';
import { Link, Redirect, router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { BootSplash } from '@/features/auth/components/BootSplash';
import { useAuthSession } from '@/features/auth/hooks/useAuthSession';
import { resendVerificationEmail, signOut } from '@/features/auth/lib/auth-service';
import { authCopy, formatMmSs } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

const RESEND_COOLDOWN_SEC = 3600;

export function VerifyEmailScreen() {
  const { user, status, isEmailVerified } = useAuthSession();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = user?.email ?? (typeof params.email === 'string' ? params.email : '');
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = useCallback(async () => {
    if (!email || cooldown > 0) return;
    setLoading(true);
    setError(null);
    const { error: resendError } = await resendVerificationEmail(email);
    setLoading(false);
    if (resendError) {
      if (resendError === 'rate_limited') {
        setCooldown(RESEND_COOLDOWN_SEC);
        return;
      }
      if (resendError === 'network') {
        setError(authCopy.network);
        return;
      }
      setError('Could not resend right now. Try again shortly.');
      return;
    }
    setCooldown(RESEND_COOLDOWN_SEC);
  }, [cooldown, email]);

  if (status === 'loading') return <BootSplash />;
  if (!user && !email) return <Redirect href={routes.signIn} />;
  if (user && isEmailVerified) return <Redirect href={routes.map} />;

  return (
    <AuthScreenShell
      title={authCopy.verifyTitle}
      subtitle={authCopy.verifyBody(email)}
      footer={
        <>
          <AuthButton
            label={cooldown > 0 ? authCopy.resendCooldown(formatMmSs(cooldown)) : authCopy.resendAvailable}
            onPress={() => void handleResend()}
            loading={loading}
            disabled={cooldown > 0}
            variant="secondary"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Link href={routes.signUp} style={styles.link}>
            Wrong address? Start over
          </Link>
          <AuthButton
            label={user ? authCopy.signOut : authCopy.backToSignIn}
            onPress={() => {
              if (user) {
                void signOut().then(() => router.replace(routes.signIn));
              } else {
                router.replace(routes.signIn);
              }
            }}
            variant="secondary"
          />
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  error: { color: '#b42318', marginTop: 12, textAlign: 'center' },
  link: { marginTop: 16, textAlign: 'center', color: '#1a3d2e', fontWeight: '600' },
});
