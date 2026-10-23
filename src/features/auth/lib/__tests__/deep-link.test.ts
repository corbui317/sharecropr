import { describe, expect, test } from '@jest/globals';

import { parseAuthRedirect } from '../deep-link';

// SPEC-001-T58: the callback URL is parsed by hand, from the query and the fragment.

const BASE = 'sharecropr://auth/callback';

describe('parseAuthRedirect', () => {
  test('?code= is a code (SPEC-001-T58)', () => {
    expect(parseAuthRedirect(`${BASE}?code=abc-123`)).toEqual({ kind: 'code', code: 'abc-123' });
  });

  test('a fragment otp_expired error is expired (SPEC-001-T58)', () => {
    expect(
      parseAuthRedirect(
        `${BASE}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
      ),
    ).toEqual({ kind: 'error', reason: 'expired' });
  });

  test('the same params in the query are expired too (SPEC-001-T58)', () => {
    expect(parseAuthRedirect(`${BASE}?error=access_denied&error_code=otp_expired`)).toEqual({
      kind: 'error',
      reason: 'expired',
    });
  });

  test('an error wins over a code (SPEC-001-T58)', () => {
    expect(parseAuthRedirect(`${BASE}?code=abc#error=access_denied&error_code=otp_expired`)).toEqual({
      kind: 'error',
      reason: 'expired',
    });
    expect(parseAuthRedirect(`${BASE}?code=abc&error=server_error`)).toEqual({
      kind: 'error',
      reason: 'other',
    });
  });

  test('server_error is other; access_denied without otp_expired is denied (SPEC-001-T58)', () => {
    expect(parseAuthRedirect(`${BASE}#error=server_error`)).toEqual({ kind: 'error', reason: 'other' });
    expect(parseAuthRedirect(`${BASE}#error=access_denied`)).toEqual({ kind: 'error', reason: 'denied' });
  });

  test('null, empty and param-less URLs are none (SPEC-001-T58)', () => {
    expect(parseAuthRedirect(null)).toEqual({ kind: 'none' });
    expect(parseAuthRedirect('')).toEqual({ kind: 'none' });
    expect(parseAuthRedirect(BASE)).toEqual({ kind: 'none' });
    expect(parseAuthRedirect(`${BASE}?foo=bar`)).toEqual({ kind: 'none' });
  });

  test('malformed percent-encoding is none and does not throw (SPEC-001-T58)', () => {
    expect(() => parseAuthRedirect(`${BASE}?code=%E0%A4%A`)).not.toThrow();
    expect(parseAuthRedirect(`${BASE}?code=%E0%A4%A`)).toEqual({ kind: 'none' });
  });

  test('a code outside [A-Za-z0-9._~-] or over 512 chars is none (SPEC-001-T58)', () => {
    expect(parseAuthRedirect(`${BASE}?code=ab%20cd`)).toEqual({ kind: 'none' });
    expect(parseAuthRedirect(`${BASE}?code=a/b`)).toEqual({ kind: 'none' });
    expect(parseAuthRedirect(`${BASE}?code=${'a'.repeat(513)}`)).toEqual({ kind: 'none' });
    expect(parseAuthRedirect(`${BASE}?code=${'a'.repeat(512)}`)).toEqual({
      kind: 'code',
      code: 'a'.repeat(512),
    });
  });

  test('implicit tokens are never read (SPEC-001-T58)', () => {
    const result = parseAuthRedirect(`${BASE}#access_token=SECRET-AT&refresh_token=SECRET-RT`);
    expect(result).toEqual({ kind: 'none' });
    expect(JSON.stringify(result)).not.toMatch(/SECRET/);
  });
});
