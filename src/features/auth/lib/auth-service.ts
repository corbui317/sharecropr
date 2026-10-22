import * as Crypto from 'expo-crypto';

import { wipeQueryCache } from '@/api/query-cache';
import { supabase } from '@/api/supabase';
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

export function mapAuthError(message: string): AuthErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'bad_credentials';
  if (lower.includes('email not confirmed')) return 'bad_credentials';
  if (lower.includes('rate limit')) return 'rate_limited';
  if (lower.includes('user is banned') || lower.includes('suspended')) return 'suspended';
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
    return { error: mapAuthError(error.message) };
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
    return { error: mapAuthError(error.message) };
  }

  return { data, error: null };
}

export async function signOut() {
  await supabase.auth.signOut();
  await wipeQueryCache();
}

export async function resendVerificationEmail(email: string) {
  return supabase.auth.resend({
    type: 'signup',
    email: normalizeEmail(email),
  });
}

export async function requestPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
    redirectTo: 'sharecropr://auth/reset-password',
  });
}

export async function updatePassword(newPassword: string) {
  const lengthErr = lengthError(newPassword);
  if (lengthErr) return { error: lengthErr };

  const breachErr = await breachError(newPassword);
  if (breachErr) return { error: breachErr };

  return supabase.auth.updateUser({ password: newPassword });
}

export async function getDeletionStatus() {
  return supabase.rpc('get_account_deletion_status');
}

export async function requestAccountDeletion(reason?: string) {
  return supabase.rpc('request_account_deletion', {
    p_reason: reason ?? null,
    p_idempotency_key: Crypto.randomUUID(),
  });
}

export async function cancelAccountDeletion() {
  return supabase.rpc('cancel_account_deletion', {
    p_idempotency_key: Crypto.randomUUID(),
  });
}

export async function requestEmailChange(newEmail: string) {
  if (!isValidEmail(newEmail)) {
    return { error: 'invalid_email' as const };
  }
  return supabase.rpc('request_email_change', {
    p_new_email: normalizeEmail(newEmail),
    p_idempotency_key: Crypto.randomUUID(),
  });
}
