import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  PASSWORD_RESET_REDIRECT,
  cancelAccountDeletion,
  exchangeRecoveryCode,
  getDeletionStatus,
  mapAuthError,
  requestAccountDeletion,
  requestEmailChange,
  requestPasswordReset,
  resendVerificationEmail,
  signInWithEmail,
  signOut,
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

  test('exchangeRecoveryCode: concurrent calls for one code make one exchange (SPEC-001-T47)', async () => {
    api.supabase.auth.exchangeCodeForSession!.mockResolvedValue({ data: {}, error: null });
    const [a, b] = await Promise.all([exchangeRecoveryCode('c1'), exchangeRecoveryCode('c1')]);
    expect(api.supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ error: null });
    expect(b).toEqual({ error: null });
  });

  test('exchangeRecoveryCode: SDK error or rejection -> link_invalid (SPEC-001-T47)', async () => {
    api.supabase.auth.exchangeCodeForSession!.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid flow state' },
    });
    expect(await exchangeRecoveryCode('bad-1')).toEqual({ error: 'link_invalid' });

    api.supabase.auth.exchangeCodeForSession!.mockRejectedValueOnce(new Error('offline'));
    expect(await exchangeRecoveryCode('bad-2')).toEqual({ error: 'link_invalid' });
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
    expect(await resendVerificationEmail('a@b.org')).toEqual({ error: 'rate_limited' });
    api.supabase.auth.resend!.mockResolvedValueOnce({ error: null });
    expect(await resendVerificationEmail('a@b.org')).toEqual({ error: null });
  });
});
