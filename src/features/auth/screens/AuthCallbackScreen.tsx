import { useEffect, useState } from 'react';
import { useLinkingURL } from 'expo-linking';
import { Redirect, router, useLocalSearchParams } from 'expo-router';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { BootSplash } from '@/features/auth/components/BootSplash';
import { useAuthSession } from '@/features/auth/hooks/useAuthSession';
import { getPendingVerificationEmail } from '@/features/auth/lib/auth-service';
import { exchangeAuthCode } from '@/features/auth/lib/code-exchange';
import { authCopy } from '@/features/auth/lib/copy';
import { parseAuthRedirect, type AuthRedirect } from '@/features/auth/lib/deep-link';
import { routes, verifyEmailHref } from '@/features/auth/lib/routes';
import { TIMED_OUT, withTimeout } from '@/features/auth/lib/with-timeout';

const EXCHANGE_TIMEOUT_MS = 10000;
/** useLinkingURL is null until the initial URL resolves; wait this long before deciding there is none. */
const URL_GRACE_MS = 1500;

/**
 * sharecropr://auth/callback: the email-verification (and OAuth) redirect target (SPEC-001-T58).
 * Never logs the URL. Implicit tokens are never read; only a PKCE code or an error is.
 */
export function AuthCallbackScreen() {
  const url = useLinkingURL();
  const params = useLocalSearchParams<{ code?: string }>();
  const { status, session } = useAuthSession();

  // Fragment errors are invisible to route params, so the URL is the primary source.
  let parsed: AuthRedirect = parseAuthRedirect(url);
  if (parsed.kind === 'none' && typeof params.code === 'string') {
    parsed = parseAuthRedirect(`?code=${encodeURIComponent(params.code)}`);
  }
  const code = parsed.kind === 'code' ? parsed.code : null;

  const [exchange, setExchange] = useState<{ code: string; ok: boolean } | null>(null);
  const [graceOver, setGraceOver] = useState(false);

  useEffect(() => {
    if (!code) return;
    let active = true;
    // The shared single-flight makes StrictMode's second effect and the OAuth path safe.
    void withTimeout(exchangeAuthCode(code), EXCHANGE_TIMEOUT_MS).then(
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
  }, [code]);

  const waitingForUrl = url === null && parsed.kind === 'none';
  useEffect(() => {
    if (!waitingForUrl) return;
    const timer = setTimeout(() => setGraceOver(true), URL_GRACE_MS);
    return () => clearTimeout(timer);
  }, [waitingForUrl]);

  const linkDeadEnd = (title: string) => (
    <AuthScreenShell title={title}>
      <AuthButton label={authCopy.backToSignIn} onPress={() => router.replace(routes.signIn)} />
    </AuthScreenShell>
  );

  if (parsed.kind === 'code') {
    if (exchange?.code !== code) return <BootSplash />;
    if (exchange.ok || session) return <Redirect href={routes.home} />;
    return linkDeadEnd(authCopy.verifyLinkUsed); // the verifier is gone; the email was already confirmed
  }

  if (parsed.kind === 'error') {
    if (parsed.reason === 'expired') {
      const email = getPendingVerificationEmail();
      if (email) return <Redirect href={verifyEmailHref(email, 'expired')} />;
      return linkDeadEnd(authCopy.verifyLinkExpired);
    }
    return linkDeadEnd(authCopy.verifyLinkUsed);
  }

  if ((waitingForUrl && !graceOver) || status === 'loading') return <BootSplash />;
  return <Redirect href={session ? routes.home : routes.signIn} />;
}
