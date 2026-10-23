import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  AUTH_ERROR_CODES,
  AUTH_CALLBACK_REDIRECT,
  PASSWORD_RESET_REDIRECT,
  cancelAccountDeletion,
  getDeletionStatus,
  getPendingVerificationEmail,
  mapAuthError,
  requestAccountDeletion,
  requestEmailChange,
  requestPasswordReset,
  resendVerificationEmail,
  signInWithEmail,
  signOut,
  signUpWithEmail,
} from '../auth-service';

// SPEC-001-T19 (sign-out slice), T46, T47, T48, T49, T51, T53: the auth-service contract.

jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn(() => Promise.resolve('')),
  CryptoDigestAlgorithm: { SHA1: 'SHA-1' },
  randomUUID: jest.fn(() => 'SHOULD-NOT-BE-USED'),
}));
jest.mock('@/api/query-cache', () => ({
  wipeQueryCache: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/domain/auth/hibp', () => ({
  checkPasswordBreached: jest.fn(() => Promise.resolve({ breached: false })),
}));
jest.mock('@/api/http', () => ({ takeRetryAfter: jest.fn(() => null) }));
jest.mock('@/api/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      resend: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      updateUser: jest.fn(),
    },
    rpc: jest.fn(),
  },
  signOutWithLocalFallback: jest.fn(),
}));

type Fn = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
const api = jest.requireMock<{
  supabase: { auth: Record<string, Fn>; rpc: Fn };
  signOutWithLocalFallback: Fn;
}>('@/api/supabase');
const http = jest.requireMock<{ takeRetryAfter: jest.Mock }>('@/api/http');
const crypto = jest.requireMock<{ randomUUID: jest.Mock }>('expo-crypto');
const cache = jest.requireMock<{ wipeQueryCache: jest.Mock }>('@/api/query-cache');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('mapAuthError', () => {
  test.each([
    [{ message: 'Email not confirmed', status: 400, code: 'email_not_confirmed' }, 'email_not_confirmed'],
    [{ message: 'Email not confirmed' }, 'email_not_confirmed'],
    [{ message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' }, 'bad_credentials'],
    [{ name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 }, 'network'],
    [{ message: 'Request rate limit reached', status: 429, code: 'over_request_rate_limit' }, 'rate_limited'],
    [{ message: 'User is banned', status: 400, code: 'user_banned' }, 'suspended'],
    [{ message: '???' }, 'unknown'],
  ])('maps %j to %s (SPEC-001-T49)', (input, expected) => {
    expect(mapAuthError(input)).toBe(expected);
  });

  test('email not confirmed is never bad_credentials (SPEC-001-T49)', () => {
    expect(mapAuthError({ message: 'Email not confirmed' })).not.toBe('bad_credentials');
  });
});

describe('sign-in / sign-up', () => {
  test('signInWithEmail maps the SDK error object (SPEC-001-T49)', async () => {
    api.supabase.auth.signInWithPassword!.mockResolvedValueOnce({
      data: null,
      error: { message: 'Email not confirmed', status: 400, code: 'email_not_confirmed' },
    });
    const res = await signInWithEmail('a@b.org', 'password-long-enough');
    expect(res).toEqual({ error: 'email_not_confirmed' });
  });
});

describe('password reset', () => {
  test('requestPasswordReset redirects to the allowlisted reset route (SPEC-001-T47)', async () => {
    api.supabase.auth.resetPasswordForEmail!.mockResolvedValueOnce({ error: null });
    await requestPasswordReset(' A@B.org ');
    expect(api.supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.org', {
      redirectTo: 'sharecropr://reset-password',
    });
    expect(PASSWORD_RESET_REDIRECT).toBe('sharecropr://reset-password');
  });
});

describe('email verification redirect', () => {
  beforeEach(async () => {
    api.signOutWithLocalFallback.mockResolvedValue({ remoteRevoked: true });
    await signOut(); // clears the in-memory pending address between tests
  });

  test('signUp and resend pass emailRedirectTo sharecropr://auth/callback (SPEC-001-T58)', async () => {
    api.supabase.auth.signUp!.mockResolvedValueOnce({ data: {}, error: null });
    api.supabase.auth.resend!.mockResolvedValueOnce({ error: null });
    await signUpWithEmail('a@b.org', 'password-long-enough');
    await resendVerificationEmail('a@b.org');
    expect(AUTH_CALLBACK_REDIRECT).toBe('sharecropr://auth/callback');
    expect(api.supabase.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ options: { emailRedirectTo: 'sharecropr://auth/callback' } }),
    );
    expect(api.supabase.auth.resend).toHaveBeenCalledWith(
      expect.objectContaining({ options: { emailRedirectTo: 'sharecropr://auth/callback' } }),
    );
  });

  test('the pending address is set after a successful signUp and cleared by signOut (SPEC-001-T58)', async () => {
    expect(getPendingVerificationEmail()).toBeNull();
    api.supabase.auth.signUp!.mockResolvedValueOnce({ data: {}, error: null });
    await signUpWithEmail(' A@B.org ', 'password-long-enough');
    expect(getPendingVerificationEmail()).toBe('a@b.org');
    api.signOutWithLocalFallback.mockResolvedValueOnce({ remoteRevoked: true });
    await signOut();
    expect(getPendingVerificationEmail()).toBeNull();
  });

  test('a failed signUp or resend does not set the pending address (SPEC-001-T58)', async () => {
    api.supabase.auth.signUp!.mockResolvedValueOnce({ data: null, error: { message: 'x', status: 500 } });
    await signUpWithEmail('a@b.org', 'password-long-enough');
    api.supabase.auth.resend!.mockResolvedValueOnce({ error: { message: 'x', status: 500 } });
    await resendVerificationEmail('c@d.org');
    expect(getPendingVerificationEmail()).toBeNull();
  });

  test('the pending address is cleared even when sign-out rejects (SPEC-001-T58)', async () => {
    api.supabase.auth.signUp!.mockResolvedValueOnce({ data: {}, error: null });
    await signUpWithEmail('a@b.org', 'password-long-enough');
    api.signOutWithLocalFallback.mockRejectedValueOnce(new Error('x'));
    await expect(signOut()).rejects.toThrow('x');
    expect(getPendingVerificationEmail()).toBeNull();
  });
});

describe('getDeletionStatus', () => {
  test.each([
    [
      { data: { pending: true, scheduled_at: 'x' }, error: null, status: 200 },
      { ok: true, status: { pending: true, scheduled_at: 'x' } },
    ],
    [
      { data: null, error: { message: 'FetchError: Network request failed' }, status: 0 },
      { ok: false, reason: 'unreachable' },
    ],
    [{ data: null, error: { message: 'boom' }, status: 500 }, { ok: false, reason: 'error' }],
    [{ data: 'junk', error: null, status: 200 }, { ok: false, reason: 'error' }],
  ])('classifies %j (SPEC-001-T46)', async (rpcResult, expected) => {
    api.supabase.rpc.mockResolvedValueOnce(rpcResult);
    expect(await getDeletionStatus()).toEqual(expected);
  });
});

describe('idempotency keys come from the caller', () => {
  test("cancelAccountDeletion passes the caller's key and classifies (SPEC-001-T51, SPEC-001-T53)", async () => {
    api.supabase.rpc.mockResolvedValueOnce({ data: {}, error: null });
    expect(await cancelAccountDeletion('k-1')).toEqual({ ok: true });
    expect(api.supabase.rpc).toHaveBeenCalledWith('cancel_account_deletion', {
      p_idempotency_key: 'k-1',
    });

    api.supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'invalid_transition' } });
    expect(await cancelAccountDeletion('k-1')).toEqual({ ok: false, reason: 'grace_elapsed' });

    api.supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'request_not_found' } });
    expect(await cancelAccountDeletion('k-1')).toEqual({ ok: false, reason: 'not_found' });

    api.supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'other' } });
    expect(await cancelAccountDeletion('k-1')).toEqual({ ok: false, reason: 'failed' });
  });

  test('requestAccountDeletion / requestEmailChange use the caller key, never mint one (SPEC-001-T53)', async () => {
    api.supabase.rpc.mockResolvedValue({ data: {}, error: null });
    await requestAccountDeletion({ idempotencyKey: 'k-2' });
    expect(api.supabase.rpc).toHaveBeenLastCalledWith(
      'request_account_deletion',
      expect.objectContaining({ p_idempotency_key: 'k-2' }),
    );
    await requestEmailChange('New@Example.org', 'k-3');
    expect(api.supabase.rpc).toHaveBeenLastCalledWith(
      'request_email_change',
      expect.objectContaining({ p_idempotency_key: 'k-3' }),
    );
    expect(crypto.randomUUID).not.toHaveBeenCalled();

    api.supabase.rpc.mockClear();
    expect(await requestEmailChange('not-an-email', 'k-4')).toEqual({ error: 'invalid_email' });
    expect(api.supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('signOut', () => {
  test('wipes the query cache even if sign-out rejects (SPEC-001-T19)', async () => {
    api.signOutWithLocalFallback.mockRejectedValueOnce(new Error('x'));
    await expect(signOut()).rejects.toThrow('x');
    expect(cache.wipeQueryCache).toHaveBeenCalledTimes(1);
  });

  test('happy path signs out then wipes, in order (SPEC-001-T19)', async () => {
    api.signOutWithLocalFallback.mockResolvedValueOnce({ remoteRevoked: true });
    await signOut();
    expect(api.signOutWithLocalFallback).toHaveBeenCalledTimes(1);
    expect(cache.wipeQueryCache).toHaveBeenCalledTimes(1);
    expect(api.signOutWithLocalFallback.mock.invocationCallOrder[0]).toBeLessThan(
      cache.wipeQueryCache.mock.invocationCallOrder[0] as number,
    );
  });
});

describe('resendVerificationEmail', () => {
  test('maps errors (SPEC-001-T48)', async () => {
    api.supabase.auth.resend!.mockResolvedValueOnce({
      error: { status: 429, code: 'over_email_send_rate_limit', message: 'rate limit' },
    });
    expect(await resendVerificationEmail('a@b.org')).toEqual({
      error: 'rate_limited',
      retryAfterSec: null,
    });
    api.supabase.auth.resend!.mockResolvedValueOnce({ error: null });
    expect(await resendVerificationEmail('a@b.org')).toEqual({ error: null });
  });
});

describe('Retry-After and never-reject contract', () => {
  test('rate-limited sign-in returns the header hint (SPEC-001-T56)', async () => {
    http.takeRetryAfter.mockReturnValueOnce(120);
    api.supabase.auth.signInWithPassword!.mockResolvedValueOnce({
      data: null,
      error: { message: 'rate limit', status: 429, code: 'over_request_rate_limit' },
    });
    expect(await signInWithEmail('a@b.org', 'password-long-enough')).toEqual({
      error: 'rate_limited',
      retryAfterSec: 120,
    });
    expect(http.takeRetryAfter).toHaveBeenCalledWith('token');
  });

  test('resend 429 without a header parses seconds from the GoTrue message (SPEC-001-T56)', async () => {
    api.supabase.auth.resend!.mockResolvedValueOnce({
      error: {
        status: 429,
        code: 'over_email_send_rate_limit',
        message: 'For security purposes, you can only request this after 47 seconds.',
      },
    });
    expect(await resendVerificationEmail('a@b.org')).toEqual({ error: 'rate_limited', retryAfterSec: 47 });
  });

  test('rate-limited with neither source -> retryAfterSec null (SPEC-001-T56)', async () => {
    api.supabase.auth.signInWithPassword!.mockResolvedValueOnce({
      data: null,
      error: { message: 'rate limit', status: 429 },
    });
    expect(await signInWithEmail('a@b.org', 'password-long-enough')).toEqual({
      error: 'rate_limited',
      retryAfterSec: null,
    });
  });

  test('no SDK call ever rejects out of the auth-service (SPEC-001-T57)', async () => {
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['signInWithPassword', () => signInWithEmail('a@b.org', 'password-long-enough')],
      ['signUp', () => signUpWithEmail('a@b.org', 'a-long-enough-passphrase-1')],
      ['resend', () => resendVerificationEmail('a@b.org')],
      ['resetPasswordForEmail', () => requestPasswordReset('a@b.org')],
    ];
    for (const [fn, run] of calls) {
      api.supabase.auth[fn]!.mockRejectedValueOnce(new Error('x'));
      expect(await run()).toEqual({ error: 'unknown' });
      api.supabase.auth[fn]!.mockRejectedValueOnce({ name: 'AuthRetryableFetchError', status: 0, message: 'offline' });
      expect(await run()).toEqual({ error: 'network' });
    }
  });

  test('requestPasswordReset returns a normalized error code (SPEC-001-T57)', async () => {
    api.supabase.auth.resetPasswordForEmail!.mockResolvedValueOnce({ error: null });
    expect(await requestPasswordReset('a@b.org')).toEqual({ error: null });
    api.supabase.auth.resetPasswordForEmail!.mockResolvedValueOnce({
      error: { name: 'AuthRetryableFetchError', status: 0, message: 'x' },
    });
    expect(await requestPasswordReset('a@b.org')).toEqual({ error: 'network' });
    api.supabase.auth.resetPasswordForEmail!.mockResolvedValueOnce({ error: { status: 429, message: 'x' } });
    expect(await requestPasswordReset('a@b.org')).toEqual({ error: 'rate_limited' });
  });

  test('AUTH_ERROR_CODES lists every code (SPEC-001-T57)', () => {
    expect(AUTH_ERROR_CODES).toContain('rate_limited');
    expect(AUTH_ERROR_CODES).toHaveLength(11);
  });
});
