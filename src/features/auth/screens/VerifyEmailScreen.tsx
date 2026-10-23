import { useCallback, useState } from "react";
import { Link, Redirect, router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { AuthButton } from "@/features/auth/components/AuthButton";
import { AuthScreenShell } from "@/features/auth/components/AuthScreenShell";
import { BootSplash } from "@/features/auth/components/BootSplash";
import { useAuthSession } from "@/features/auth/hooks/useAuthSession";
import { useCountdown } from "@/features/auth/hooks/useCountdown";
import { useSignOutAndRedirect } from "@/features/auth/hooks/useSignOutAndRedirect";
import {
  resendVerificationEmail,
  type AuthErrorCode,
} from "@/features/auth/lib/auth-service";
import { authCopy, formatMmSs } from "@/features/auth/lib/copy";
import { authErrorCopy } from "@/features/auth/lib/error-copy";
import { routes } from "@/features/auth/lib/routes";

/** supabase/config.toml [auth.email] max_frequency: GoTrue refuses a resend inside this interval. */
const RESEND_MIN_INTERVAL_SEC = 60;

export function VerifyEmailScreen() {
  const { user, status, isEmailVerified } = useAuthSession();
  const params = useLocalSearchParams<{ email?: string; reason?: string }>();
  const email =
    user?.email ?? (typeof params.email === "string" ? params.email : "");
  const [resendUntil, setResendUntil] = useState<number | null>(null);
  // SPEC-001-T59: deadline-based, so a backgrounded app cannot drift; announced at start, 30 and 0.
  const cooldown = useCountdown(resendUntil, (r) =>
    r > 0 ? authCopy.resendCooldown(formatMmSs(r)) : authCopy.resendAvailable,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const signingOut = useSignOutAndRedirect();

  const handleResend = useCallback(async () => {
    if (!email || cooldown > 0) return;
    setLoading(true);
    setError(null);
    let resendError: AuthErrorCode | null;
    let retryAfterSec: number | null | undefined;
    try {
      ({ error: resendError, retryAfterSec } =
        await resendVerificationEmail(email));
    } catch {
      resendError = "unknown"; // Invariant 10: never leave the spinner on
    } finally {
      setLoading(false);
    }
    if (resendError === "rate_limited") {
      setResendUntil(
        Date.now() +
          (retryAfterSec && retryAfterSec > 0
            ? retryAfterSec
            : RESEND_MIN_INTERVAL_SEC) *
            1000,
      );
      return;
    }
    if (resendError) {
      setError(authErrorCopy(resendError, "resend"));
      return;
    }
    setResendUntil(Date.now() + RESEND_MIN_INTERVAL_SEC * 1000);
  }, [cooldown, email]);

  if (status === "loading") return <BootSplash />;
  if (!user && !email) return <Redirect href={routes.signIn} />;
  if (user && isEmailVerified) return <Redirect href={routes.map} />;

  return (
    <AuthScreenShell
      title={authCopy.verifyTitle}
      subtitle={authCopy.verifyBody(email)}
      footer={
        <>
          {params.reason === "expired" ? (
            <Text accessibilityLiveRegion="polite" style={styles.notice}>
              {authCopy.verifyLinkExpired}
            </Text>
          ) : null}
          <AuthButton
            label={
              cooldown > 0
                ? authCopy.resendCooldown(formatMmSs(cooldown))
                : authCopy.resendAvailable
            }
            onPress={() => void handleResend()}
            loading={loading}
            disabled={cooldown > 0}
            variant="secondary"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Link href={routes.signUp} style={styles.link}>
            {authCopy.wrongAddress}
          </Link>
          <AuthButton
            label={user ? authCopy.signOut : authCopy.backToSignIn}
            loading={signingOut.pending}
            onPress={() => {
              if (user) signingOut.signOut();
              else router.replace(routes.signIn);
            }}
            variant="secondary"
          />
          {signingOut.failed ? (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {authCopy.signOutFailed}
            </Text>
          ) : null}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  notice: { color: "#1a3d2e", marginBottom: 12, textAlign: "center" },
  error: { color: "#b42318", marginTop: 12, textAlign: "center" },
  link: {
    marginTop: 16,
    textAlign: "center",
    color: "#1a3d2e",
    fontWeight: "600",
  },
});
