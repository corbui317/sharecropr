import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { AuthTextField } from '@/features/auth/components/AuthTextField';
import { BootSplash } from '@/features/auth/components/BootSplash';
import { useAuthSession } from '@/features/auth/hooks/useAuthSession';
import { exchangeRecoveryCode, updatePassword } from '@/features/auth/lib/auth-service';
import type { AuthErrorCode } from '@/features/auth/lib/auth-service';
import { authCopy } from '@/features/auth/lib/copy';
import { authErrorCopy } from '@/features/auth/lib/error-copy';
import { routes } from '@/features/auth/lib/routes';
import { TIMED_OUT, withTimeout } from '@/features/auth/lib/with-timeout';

const EXCHANGE_TIMEOUT_MS = 10000;

export function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ code?: string; error?: string; error_code?: string }>();
  const { status, session } = useAuthSession();
  const code = typeof params.code === 'string' ? params.code : undefined;
  const linkError = Boolean(params.error ?? params.error_code);
  const [exchange, setExchange] = useState<{ code: string; ok: boolean } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // SPEC-001-T47: the PKCE code is exchanged once (auth-service dedupes per code) before the form shows.
  useEffect(() => {
    if (!code || linkError) return;
    let active = true;
    void withTimeout(exchangeRecoveryCode(code), EXCHANGE_TIMEOUT_MS).then(
      (res) => {
        if (active) setExchange({ code, ok: res !== TIMED_OUT && !res.error });
      },
      () => {
        if (active) setExchange({ code, ok: false });
      },
    );
    return () => {
      active = false;
    };
  }, [code, linkError]);

  let link: 'checking' | 'ready' | 'invalid';
  if (linkError) link = 'invalid';
  else if (code) link = exchange?.code === code ? (exchange.ok ? 'ready' : 'invalid') : 'checking';
  else if (status === 'loading') link = 'checking';
  else link = session ? 'ready' : 'invalid';

  const handleSubmit = async () => {
    setError(null);
    if (password !== confirm) {
      setError(authCopy.passwordsDontMatch);
      return;
    }

    setLoading(true);
    const result = await updatePassword(password);
    setLoading(false);

    if ('error' in result && result.error) {
      const code = typeof result.error === 'string' ? result.error : 'unknown';
      setError(authErrorCopy(code as AuthErrorCode, 'password_update'));
      return;
    }

    router.replace(routes.signIn);
  };

  if (link === 'checking') return <BootSplash />;
  if (link === 'invalid') {
    return (
      <AuthScreenShell title={authCopy.resetLinkInvalidTitle} subtitle={authCopy.resetLinkInvalidBody}>
        <AuthButton
          label={authCopy.resetLinkRequestNew}
          onPress={() => router.replace(routes.forgotPassword)}
        />
      </AuthScreenShell>
    );
  }

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
