import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Platform } from 'react-native';

import { signInWithApple, signInWithGoogle } from '../oauth';

// SPEC-001-T52: a provider cancel is silent.

jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));
jest.mock('expo-auth-session', () => ({
  makeRedirectUri: () => 'sharecropr://auth/callback',
}));
jest.mock('../code-exchange', () => ({ exchangeAuthCode: jest.fn() }));
jest.mock('@/api/supabase', () => ({
  supabase: {
    auth: {
      signInWithIdToken: jest.fn(),
      signInWithOAuth: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      getUser: jest.fn(),
      updateUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

const apple = jest.requireMock<{ signInAsync: jest.Mock<() => Promise<unknown>> }>(
  'expo-apple-authentication',
);
const browser = jest.requireMock<{ openAuthSessionAsync: jest.Mock<() => Promise<unknown>> }>(
  'expo-web-browser',
);
const exchange = jest.requireMock<{
  exchangeAuthCode: jest.Mock<(code: string) => Promise<{ error: 'link_invalid' | null }>>;
}>('../code-exchange');
const api = jest.requireMock<{
  supabase: { auth: Record<string, jest.Mock<(...a: unknown[]) => Promise<unknown>>> };
}>('@/api/supabase');

describe('provider cancel', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
    jest.clearAllMocks();
  });

  test('Apple cancel is detected by err.code, not the message (SPEC-001-T52)', async () => {
    Platform.OS = 'ios';
    apple.signInAsync.mockRejectedValueOnce(
      Object.assign(new Error('The user canceled the authorization attempt'), {
        code: 'ERR_REQUEST_CANCELED',
      }),
    );
    expect(await signInWithApple()).toEqual({ error: null, cancelled: true });
    expect(api.supabase.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  test('other Apple errors surface (SPEC-001-T52)', async () => {
    Platform.OS = 'ios';
    const boom = Object.assign(new Error('bad response'), { code: 'ERR_INVALID_RESPONSE' });
    apple.signInAsync.mockRejectedValueOnce(boom);
    const res = await signInWithApple();
    expect(res.error).toBe(boom);
    expect(res.cancelled).toBeFalsy();
  });

  test('Google sheet dismissed -> silent cancel (SPEC-001-T52)', async () => {
    api.supabase.auth.signInWithOAuth!.mockResolvedValueOnce({
      data: { url: 'https://x' },
      error: null,
    });
    browser.openAuthSessionAsync.mockResolvedValueOnce({ type: 'cancel' });
    expect(await signInWithGoogle()).toEqual({ error: null, cancelled: true });
    expect(api.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test('Google success exchanges the parsed code via the shared single-flight (SPEC-001-T58)', async () => {
    api.supabase.auth.signInWithOAuth!.mockResolvedValueOnce({ data: { url: 'https://x' }, error: null });
    browser.openAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: 'sharecropr://auth/callback?code=goog-1',
    });
    exchange.exchangeAuthCode.mockResolvedValueOnce({ error: null });
    expect(await signInWithGoogle()).toEqual({ error: null });
    expect(exchange.exchangeAuthCode).toHaveBeenCalledWith('goog-1');
    expect(api.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test('a failed exchange or a redirect without a code is an error (SPEC-001-T58)', async () => {
    api.supabase.auth.signInWithOAuth!.mockResolvedValue({ data: { url: 'https://x' }, error: null });
    browser.openAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: 'sharecropr://auth/callback?code=goog-2',
    });
    exchange.exchangeAuthCode.mockResolvedValueOnce({ error: 'link_invalid' });
    expect((await signInWithGoogle()).error?.message).toBe('oauth_exchange_failed');

    browser.openAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: 'sharecropr://auth/callback#error=access_denied',
    });
    expect((await signInWithGoogle()).error?.message).toBe('oauth_code_missing');
  });
});
