import * as Crypto from 'expo-crypto';

import { wipeQueryCache } from '@/api/query-cache';
import { signOutWithLocalFallback, supabase } from '@/api/supabase';
import { checkPasswordBreached, type Sha1Hex } from '@/domain/auth/hibp';
import { normalizeEmail, isValidEmail } from '@/domain/validation/email';
import { validatePasswordLength } from '@/domain/validation/password';

export type AuthErrorCode =
  | 'invalid_email'
  | 'password_too_short'
  | 'password_too_long'
  | 'breach_check_unavailable'
  | 'password_breached'
  | 'network'
  | 'bad_credentials'
  | 'email_not_confirmed'
  | 'rate_limited'
  | 'suspended'
  | 'unknown';

// Hermes has no crypto.subtle, so the domain hasher is injected from expo-crypto.
const sha1Hex: Sha1Hex = async (input) =>
  (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, input)).toUpperCase();

function lengthError(password: string) {
  const check = validatePasswordLength(password);
  if (check.ok) return null;
  return check.reason === 'too_long' ? ('password_too_long' as const) : ('password_too_short' as const);
}

/**
 * SPEC-001 R08 permits skipping the breach check only when HIBP is unreachable.
 * A local hashing failure is not that, so it fails closed instead of silently skipping.
 */
async function breachError(password: string) {
  const hibp = await checkPasswordBreached(password, { sha1Hex });
  if ('breached' in hibp && hibp.breached) return 'password_breached' as const;
  if ('skipped' in hibp && hibp.reason === 'no_hasher') return 'breach_check_unavailable' as const;
  return null;
}

/** The fields of a GoTrue AuthError we read. Structural, so features never import the SDK. */
export type AuthErrorLike = { message: string; name?: string; status?: number; code?: string };

export function mapAuthError(error: AuthErrorLike): AuthErrorCode {
  const code = error.code ?? '';
  const lower = error.message.toLowerCase();
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) return 'network';
  // GoTrue checks the password before confirmation, so this is not an existence oracle.
  if (code === 'email_not_confirmed' || lower.includes('email not confirmed')) return 'email_not_confirmed';
  if (code === 'invalid_credentials' || lower.includes('invalid login credentials')) return 'bad_credentials';
  if (error.status === 429 || code.startsWith('over_') || lower.includes('rate limit')) return 'rate_limited';
  if (code === 'user_banned' || lower.includes('user is banned') || lower.includes('suspended')) return 'suspended';
  return 'unknown';
}

export async function signUpWithEmail(email: string, password: string) {
  if (!isValidEmail(email)) {
    return { error: 'invalid_email' as const };
  }

  const lengthErr = lengthError(password);
  if (lengthErr) return { error: lengthErr };

  const breachErr = await breachError(password);
  if (breachErr) return { error: breachErr };

  const { data, error } = await supabase.auth.signUp({
    email: normalizeEmail(email),
    password,
  });

  if (error) {
    return { error: mapAuthError(error) };
  }

  return { data, error: null };
}

export async function signInWithEmail(email: string, password: string) {
  if (!isValidEmail(email)) {
    return { error: 'invalid_email' as const };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  });

  if (error) {
    return { error: mapAuthError(error) };
  }

  return { data, error: null };
}

export async function signOut(): Promise<void> {
  try {
    await signOutWithLocalFallback();
  } finally {
    await wipeQueryCache(); // R25: the cache file goes even if the session purge failed
  }
}

export async function resendVerificationEmail(email: string): Promise<{ error: AuthErrorCode | null }> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: normalizeEmail(email),
  });
  return { error: error ? mapAuthError(error) : null };
}

/**
 * Allowlisted in supabase/config.toml. The scheme host is the first path segment and the (auth)
 * group adds none, so this opens app/(auth)/reset-password.tsx (SPEC-001-T47).
 */
export const PASSWORD_RESET_REDIRECT = 'sharecropr://reset-password';

export async function requestPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
    redirectTo: PASSWORD_RESET_REDIRECT,
  });
}

type RecoveryExchange = { error: 'link_invalid' | null };
const recoveryExchanges = new Map<string, Promise<RecoveryExchange>>();

/**
 * Exchange the PKCE recovery code for a session. The code is single-use, so a duplicate exchange
 * (StrictMode's double effect, a remount) would fail and wrongly show "link invalid": one exchange
 * per code. Resolved entries are kept; they are tiny.
 */
export function exchangeRecoveryCode(code: string): Promise<RecoveryExchange> {
  const existing = recoveryExchanges.get(code);
  if (existing) return existing;
  const exchange = supabase.auth.exchangeCodeForSession(code).then(
    ({ error }): RecoveryExchange => ({ error: error ? 'link_invalid' : null }),
    (): RecoveryExchange => ({ error: 'link_invalid' }),
  );
  recoveryExchanges.set(code, exchange);
  return exchange;
}

export async function updatePassword(newPassword: string) {
  const lengthErr = lengthError(newPassword);
  if (lengthErr) return { error: lengthErr };

  const breachErr = await breachError(newPassword);
  if (breachErr) return { error: breachErr };

  return supabase.auth.updateUser({ password: newPassword });
}

export type DeletionStatus = {
  pending: boolean;
  requested_at?: string;
  scheduled_at?: string;
  grace_elapsed?: boolean;
};
export type DeletionStatusResult =
  | { ok: true; status: DeletionStatus }
  | { ok: false; reason: 'unreachable' | 'error' };

function isDeletionStatus(v: unknown): v is DeletionStatus {
  return typeof v === 'object' && v !== null && typeof (v as { pending?: unknown }).pending === 'boolean';
}

export async function getDeletionStatus(): Promise<DeletionStatusResult> {
  const { data, error, status } = await supabase.rpc('get_account_deletion_status');
  if (error) return { ok: false, reason: status === 0 ? 'unreachable' : 'error' }; // postgrest-js: status 0 = fetch failed
  if (!isDeletionStatus(data)) return { ok: false, reason: 'error' };
  return { ok: true, status: data };
}

/** The caller holds the key per intent (useIntentKey), so retries replay server-side (SPEC-001-T53). */
export async function requestAccountDeletion({
  idempotencyKey,
  reason,
}: {
  idempotencyKey: string;
  reason?: string;
}) {
  return supabase.rpc('request_account_deletion', {
    p_reason: reason ?? null,
    p_idempotency_key: idempotencyKey,
  });
}

export type CancelDeletionResult =
  | { ok: true }
  | { ok: false; reason: 'grace_elapsed' | 'not_found' | 'failed' };

export async function cancelAccountDeletion(idempotencyKey: string): Promise<CancelDeletionResult> {
  const { error } = await supabase.rpc('cancel_account_deletion', {
    p_idempotency_key: idempotencyKey,
  });
  if (!error) return { ok: true };
  if (error.message.includes('invalid_transition')) return { ok: false, reason: 'grace_elapsed' };
  if (error.message.includes('request_not_found')) return { ok: false, reason: 'not_found' };
  return { ok: false, reason: 'failed' };
}

export async function requestEmailChange(newEmail: string, idempotencyKey: string) {
  if (!isValidEmail(newEmail)) {
    return { error: 'invalid_email' as const };
  }
  return supabase.rpc('request_email_change', {
    p_new_email: normalizeEmail(newEmail),
    p_idempotency_key: idempotencyKey,
  });
}
