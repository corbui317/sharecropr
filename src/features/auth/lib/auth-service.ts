import * as Crypto from 'expo-crypto';

import { wipeQueryCache } from '@/api/query-cache';
import { supabase } from '@/api/supabase';
import { checkPasswordBreached } from '@/domain/auth/hibp';
import { normalizeEmail, isValidEmail } from '@/domain/validation/email';
import { validatePasswordLength } from '@/domain/validation/password';

export type AuthErrorCode =
  | 'invalid_email'
  | 'password_too_short'
  | 'password_breached'
  | 'network'
  | 'bad_credentials'
  | 'rate_limited'
  | 'suspended'
  | 'unknown';

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

  const lengthCheck = validatePasswordLength(password);
  if (!lengthCheck.ok) {
    return { error: 'password_too_short' as const };
  }

  const hibp = await checkPasswordBreached(password);
  if ('breached' in hibp && hibp.breached) {
    return { error: 'password_breached' as const };
  }

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
  const lengthCheck = validatePasswordLength(newPassword);
  if (!lengthCheck.ok) {
    return { error: 'password_too_short' as const };
  }

  const hibp = await checkPasswordBreached(newPassword);
  if ('breached' in hibp && hibp.breached) {
    return { error: 'password_breached' as const };
  }

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
