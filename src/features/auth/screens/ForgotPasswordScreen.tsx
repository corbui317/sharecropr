import { useState } from 'react';
import { router } from 'expo-router';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { AuthTextField } from '@/features/auth/components/AuthTextField';
import { requestPasswordReset } from '@/features/auth/lib/auth-service';
import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    await requestPasswordReset(email);
    setLoading(false);
    setSubmitted(true);
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
    >
      <AuthTextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <AuthButton label="Send reset link" onPress={() => void handleSubmit()} loading={loading} />
    </AuthScreenShell>
  );
}
