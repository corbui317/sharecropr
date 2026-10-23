import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { AuthTextField } from '@/features/auth/components/AuthTextField';
import { useIsOffline } from '@/features/auth/hooks/useIsOffline';
import { requestPasswordReset } from '@/features/auth/lib/auth-service';
import { authCopy } from '@/features/auth/lib/copy';
import { authErrorCopy } from '@/features/auth/lib/error-copy';
import { routes } from '@/features/auth/lib/routes';

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offline = useIsOffline();

  const handleSubmit = async () => {
    if (offline) return;
    setLoading(true);
    setError(null);
    try {
      const { error: code } = await requestPasswordReset(email);
      // R29: only a transport failure may differ from the success screen; a 429 or 5xx would reveal
      // whether the account exists, so authErrorCopy returns null for those.
      const copy = code ? authErrorCopy(code, 'password_reset_request') : null;
      if (copy) setError(copy);
      else setSubmitted(true);
    } catch {
      setError(authCopy.network);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <AuthScreenShell title="Check your email" subtitle={authCopy.resetSuccess(email)}>
        <AuthButton label="Back to sign in" onPress={() => router.replace(routes.signIn)} />
      </AuthScreenShell>
    );
  }

  return (
    <AuthScreenShell
      title="Reset your password"
      subtitle="Enter the email on your account. We'll send a reset link if we find one."
      banner={
        offline ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{authCopy.offlineReset}</Text>
          </View>
        ) : null
      }
    >
      <AuthTextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!offline}
        error={error ?? undefined}
      />
      <AuthButton
        label="Send reset link"
        onPress={() => void handleSubmit()}
        loading={loading}
        disabled={offline}
      />
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#fff4e5', borderRadius: 12, padding: 12, marginBottom: 16 },
  bannerText: { color: '#7a4b00', fontSize: 14 },
});
