import { describe, expect, jest, test } from '@jest/globals';

import { AUTH_ERROR_CODES } from '../auth-service';
import { authCopy } from '../copy';
import { authErrorCopy, rateLimitedCopy, type AuthErrorContext } from '../error-copy';

// SPEC-001-T57: authErrorCopy is total over code x context and uses only §8.3 strings (R29).

jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn(), CryptoDigestAlgorithm: { SHA1: 'SHA-1' } }));
jest.mock('@/api/query-cache', () => ({ wipeQueryCache: jest.fn() }));
jest.mock('@/api/http', () => ({ takeRetryAfter: jest.fn() }));
jest.mock('@/api/supabase', () => ({ supabase: { auth: {}, rpc: jest.fn() }, signOutWithLocalFallback: jest.fn() }));

const CONTEXTS: AuthErrorContext[] = ['sign_in', 'sign_up', 'password_reset_request', 'password_update', 'resend'];

const allStrings = new Set<string>(
  Object.values(authCopy).flatMap((v) => (typeof v === 'string' ? [v] : [])),
);

describe('authErrorCopy', () => {
  test('is total and only returns authCopy strings (SPEC-001-T57)', () => {
    for (const context of CONTEXTS) {
      for (const code of AUTH_ERROR_CODES) {
        const copy = authErrorCopy(code, context);
        expect(copy === null || allStrings.has(copy)).toBe(true);
      }
    }
  });

  test('password reset request shows copy only for a transport failure (R29) (SPEC-001-T57)', () => {
    for (const code of AUTH_ERROR_CODES) {
      const copy = authErrorCopy(code, 'password_reset_request');
      expect(copy).toBe(code === 'network' ? authCopy.network : null);
    }
  });

  test('sign-in has no account-existence oracle (SPEC-001-T57)', () => {
    const wrong = authErrorCopy('bad_credentials', 'sign_in');
    expect(authErrorCopy('invalid_email', 'sign_in')).toBe(wrong);
    expect(authErrorCopy('unknown', 'sign_in')).toBe(wrong);
    expect(wrong).toBe(authCopy.wrongCredentials);
    for (const context of CONTEXTS) {
      for (const code of AUTH_ERROR_CODES) {
        expect(authErrorCopy(code, context) ?? '').not.toMatch(
          /no account|not found|doesn.t exist|not registered|already (registered|exists)/i,
        );
      }
    }
  });

  test('sign-in email_not_confirmed routes instead of showing copy (SPEC-001-T57)', () => {
    expect(authErrorCopy('email_not_confirmed', 'sign_in')).toBeNull();
  });

  test('resend rate_limited is handled by the countdown, not copy (SPEC-001-T57)', () => {
    expect(authErrorCopy('rate_limited', 'resend')).toBeNull();
    expect(authErrorCopy('unknown', 'resend')).toBe(authCopy.resendFailed);
  });
});

describe('rateLimitedCopy', () => {
  test('formats the countdown, or falls back to the interim string (SPEC-001-T56)', () => {
    expect(rateLimitedCopy('sign_in', 252)).toBe('Too many sign-in attempts. Try again in 4:12.');
    expect(rateLimitedCopy('sign_in', null)).toBe(authCopy.signInRateLimited);
  });
});
