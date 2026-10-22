import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { AuthTextField } from '@/features/auth/components/AuthTextField';
import { useAuthSession } from '@/features/auth/hooks/useAuthSession';
import { requestEmailChange, updatePassword } from '@/features/auth/lib/auth-service';
import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

export function SecuritySettingsScreen() {
  const { user } = useAuthSession();
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<'email' | 'password' | null>(null);

  const handleEmailChange = async () => {
    setError(null);
    setMessage(null);
    setLoading('email');
    const result = await requestEmailChange(newEmail);
    setLoading(null);
    if ('error' in result && result.error) {
      setError(authCopy.aal2Required);
      return;
    }
    if (result.error) {
      setError(authCopy.aal2Required);
      return;
    }
    setMessage(`Confirmation sent to ${newEmail}. Your current address stays active until you confirm.`);
  };

  const handlePasswordChange = async () => {
    setError(null);
    setMessage(null);
    setLoading('password');
    const result = await updatePassword(newPassword);
    setLoading(null);
    if (result.error === 'password_too_short') {
      setError(authCopy.passwordTooShort);
      return;
    }
    if (result.error === 'password_too_long') {
      setError(authCopy.passwordTooLong);
      return;
    }
    if (result.error === 'breach_check_unavailable') {
      setError(authCopy.breachCheckUnavailable);
      return;
    }
    if (result.error === 'password_breached') {
      setError(authCopy.passwordBreached);
      return;
    }
    if ('error' in result && result.error) {
      setError(authCopy.aal2Required);
      return;
    }
    setMessage('Password updated.');
  };

  return (
    <AuthScreenShell title="Security" subtitle={user?.email ?? ''}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Change email</Text>
        <AuthTextField
          label="New email"
          value={newEmail}
          onChangeText={setNewEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <AuthButton
          label="Request change"
          variant="secondary"
          onPress={() => void handleEmailChange()}
          loading={loading === 'email'}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Change password</Text>
        <AuthTextField
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          textContentType="newPassword"
          error={error ?? undefined}
        />
        <AuthButton
          label="Update password"
          variant="secondary"
          onPress={() => void handlePasswordChange()}
          loading={loading === 'password'}
        />
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <AuthButton
        label="Delete account"
        variant="danger"
        onPress={() => router.push(routes.deleteAccount)}
      />
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a3d2e' },
  message: { color: '#1a3d2e', marginBottom: 12 },
});
