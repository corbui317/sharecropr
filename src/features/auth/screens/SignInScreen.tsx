import { useState } from 'react';
import { Link, Redirect, router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { AuthTextField } from '@/features/auth/components/AuthTextField';
import { ProviderButtons } from '@/features/auth/components/ProviderButtons';
import { useCountdown } from '@/features/auth/hooks/useCountdown';
import { useIsOffline } from '@/features/auth/hooks/useIsOffline';
import { useAuthSession } from '@/features/auth/hooks/useAuthSession';
import { signInWithEmail } from '@/features/auth/lib/auth-service';
import { authCopy, formatMmSs } from '@/features/auth/lib/copy';
import { authErrorCopy, rateLimitedCopy } from '@/features/auth/lib/error-copy';
import { routes, verifyEmailHref } from '@/features/auth/lib/routes';
import { normalizeEmail } from '@/domain/validation/email';
import { signInWithApple, signInWithGoogle } from '@/features/auth/lib/oauth';

export function SignInScreen() {
  const { status, session } = useAuthSession();
  const offline = useIsOffline();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<'apple' | 'google' | 'email' | null>(
    null,
  );

  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  // SPEC-001-T56: submit stays disabled for exactly Retry-After seconds; no auto-retry.
  const remaining = useCountdown(rateLimitedUntil, (r) =>
    r > 0 ? rateLimitedCopy('sign_in', r) : authCopy.signInAvailableAgain,
  );
  const shownError = remaining > 0 ? rateLimitedCopy('sign_in', remaining) : error;

  const handleEmailSignIn = async () => {
    setError(null);
    setRateLimitedUntil(null);
    setLoadingProvider('email');
    let result: Awaited<ReturnType<typeof signInWithEmail>>;
    try {
      result = await signInWithEmail(email, password);
    } catch {
      result = { error: 'unknown' }; // Invariant 10: never leave the spinner on
    } finally {
      setLoadingProvider(null);
    }

    if (result.error === 'email_not_confirmed') {
      router.replace(verifyEmailHref(normalizeEmail(email)));
      return;
    }
    if (result.error === 'rate_limited' && result.retryAfterSec && result.retryAfterSec > 0) {
      setRateLimitedUntil(Date.now() + result.retryAfterSec * 1000);
      return;
    }
    if (result.error) {
      setError(authErrorCopy(result.error, 'sign_in'));
      return;
    }

    router.replace('/');
  };

  const handleProvider = async (provider: 'apple' | 'google') => {
    setError(null);
    setLoadingProvider(provider);
    const fn = provider === 'apple' ? signInWithApple : signInWithGoogle;
    const { error: providerError, cancelled } = await fn();
    setLoadingProvider(null);
    if (cancelled) return;

    if (providerError) {
      setError(authCopy.providerFailed(provider === 'apple' ? 'Apple' : 'Google'));
      return;
    }

    router.replace('/');
  };

  if (status === 'loading') return null;
  if (session) return <Redirect href="/" />;

  return (
    <AuthScreenShell
      title="Welcome back"
      subtitle="Sign in to trade surplus crops with nearby gardeners."
      banner={
        offline ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{authCopy.offline}</Text>
          </View>
        ) : null
      }
      footer={
        <Text style={styles.footer}>
          New here?{' '}
          <Link href={routes.signUp} style={styles.link}>
            Create an account
          </Link>
        </Text>
      }
    >
      <ProviderButtons
        loadingProvider={loadingProvider}
        disabled={offline}
        onApple={() => void handleProvider('apple')}
        onGoogle={() => void handleProvider('google')}
      />

      <Text style={styles.divider}>or use email</Text>

      <AuthTextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!offline}
      />
      <AuthTextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        editable={!offline}
        error={shownError ?? undefined}
        errorLiveRegion={remaining > 0 ? 'none' : 'polite'}
      />

      <Link href={routes.forgotPassword} style={styles.forgot}>
        Forgot password?
      </Link>

      <AuthButton
        label={remaining > 0 ? authCopy.tryAgainIn(formatMmSs(remaining)) : 'Sign in'}
        onPress={() => void handleEmailSignIn()}
        loading={loadingProvider === 'email'}
        disabled={offline || remaining > 0}
      />
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#fff4e5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  bannerText: { color: '#7a4b00', fontSize: 14 },
  divider: {
    textAlign: 'center',
    color: '#5d6f66',
    marginVertical: 8,
    fontSize: 14,
  },
  forgot: { color: '#1a3d2e', fontWeight: '600', marginBottom: 4 },
  footer: { marginTop: 24, textAlign: 'center', color: '#3d4f46' },
  link: { color: '#1a3d2e', fontWeight: '700' },
});
