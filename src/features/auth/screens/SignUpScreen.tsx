import { useState } from 'react';
import { Link, router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { AuthTextField } from '@/features/auth/components/AuthTextField';
import { ProviderButtons } from '@/features/auth/components/ProviderButtons';
import { useIsOffline } from '@/features/auth/hooks/useIsOffline';
import { normalizeEmail } from '@/domain/validation/email';
import { signUpWithEmail } from '@/features/auth/lib/auth-service';
import { authCopy } from '@/features/auth/lib/copy';
import { verifyEmailHref, routes } from '@/features/auth/lib/routes';
import { signInWithApple, signInWithGoogle } from '@/features/auth/lib/oauth';

export function SignUpScreen() {
  const offline = useIsOffline();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<'apple' | 'google' | 'email' | null>(
    null,
  );

  const handleSignUp = async () => {
    setFieldError(null);
    setLoadingProvider('email');
    const result = await signUpWithEmail(email, password);
    setLoadingProvider(null);

    if (result.error === 'password_too_short') {
      setFieldError(authCopy.passwordTooShort);
      return;
    }
    if (result.error === 'password_too_long') {
      setFieldError(authCopy.passwordTooLong);
      return;
    }
    if (result.error === 'breach_check_unavailable') {
      setFieldError(authCopy.breachCheckUnavailable);
      return;
    }
    if (result.error === 'password_breached') {
      setFieldError(authCopy.passwordBreached);
      return;
    }
    if (result.error === 'network') {
      setFieldError(authCopy.network);
      return;
    }
    if (result.error) {
      setFieldError('Something went wrong. Try again.');
      return;
    }

    router.replace(verifyEmailHref(normalizeEmail(email)));
  };

  const handleProvider = async (provider: 'apple' | 'google') => {
    setFieldError(null);
    setLoadingProvider(provider);
    const fn = provider === 'apple' ? signInWithApple : signInWithGoogle;
    const { error, cancelled } = await fn();
    setLoadingProvider(null);
    if (cancelled) return;
    if (error) {
      setFieldError(authCopy.providerFailed(provider === 'apple' ? 'Apple' : 'Google'));
      return;
    }
    router.replace('/');
  };

  return (
    <AuthScreenShell
      title="Join Sharecropr"
      subtitle="Passwords need at least 12 characters. Length beats complexity."
      footer={
        <Text style={styles.footer}>
          Already have an account?{' '}
          <Link href={routes.signIn} style={styles.link}>
            Sign in
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
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!offline}
        error={fieldError ?? undefined}
      />

      <AuthButton
        label="Create account"
        onPress={() => void handleSignUp()}
        loading={loadingProvider === 'email'}
        disabled={offline}
      />
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  divider: { textAlign: 'center', color: '#5d6f66', marginVertical: 8, fontSize: 14 },
  footer: { marginTop: 24, textAlign: 'center', color: '#3d4f46' },
  link: { color: '#1a3d2e', fontWeight: '700' },
});
