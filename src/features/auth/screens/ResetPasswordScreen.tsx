import { useState } from 'react';
import { router } from 'expo-router';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { AuthTextField } from '@/features/auth/components/AuthTextField';
import { updatePassword } from '@/features/auth/lib/auth-service';
import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

export function ResetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const result = await updatePassword(password);
    setLoading(false);

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
      setError('Could not update password. Request a new reset link.');
      return;
    }

    router.replace(routes.signIn);
  };

  return (
    <AuthScreenShell title="Choose a new password" subtitle={authCopy.passwordTooShort}>
      <AuthTextField
        label="New password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <AuthTextField
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={error ?? undefined}
      />
      <AuthButton label="Update password" onPress={() => void handleSubmit()} loading={loading} />
    </AuthScreenShell>
  );
}
