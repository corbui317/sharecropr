import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { __resetRetryAfterForTests, createAuthFetch, parseRetryAfter, takeRetryAfter } from '../http';

// SPEC-001-T56: Retry-After is captured from GoTrue 429s by the client fetch (AuthError carries no headers).

const NOW = Date.parse('2026-10-22T12:00:00Z');

function res(status: number, retryAfter?: string) {
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null) },
  } as unknown as Response;
}

let clock = NOW;
const now = () => clock;

beforeEach(() => {
  clock = NOW;
  __resetRetryAfterForTests();
});

describe('parseRetryAfter', () => {
  test('accepts delta-seconds (SPEC-001-T56)', () => {
    expect(parseRetryAfter('120', NOW)).toBe(120);
    expect(parseRetryAfter(' 30 ', NOW)).toBe(30);
  });

  test.each(['0', '-5', '1.5', 'abc', '', null, '86401'])('rejects %j (SPEC-001-T56)', (value) => {
    expect(parseRetryAfter(value, NOW)).toBeNull();
  });

  test('accepts an HTTP date, rounding up; a past date is null (SPEC-001-T56)', () => {
    expect(parseRetryAfter(new Date(NOW + 90_000).toUTCString(), NOW)).toBe(90);
    expect(parseRetryAfter(new Date(NOW - 5_000).toUTCString(), NOW)).toBeNull();
  });
});

describe('createAuthFetch', () => {
  test('records Retry-After from a 429 on an auth endpoint, once (SPEC-001-T56)', async () => {
    const base = jest.fn(() => Promise.resolve(res(429, '120')));
    const f = createAuthFetch(base as unknown as typeof fetch, now);
    await f('https://x/auth/v1/token?grant_type=password');
    expect(takeRetryAfter('token', clock)).toBe(120);
    expect(takeRetryAfter('token', clock)).toBeNull();
  });

  test('records nothing for a 200 or a non-auth 429 (SPEC-001-T56)', async () => {
    const ok = createAuthFetch((() => Promise.resolve(res(200, '120'))) as unknown as typeof fetch, now);
    await ok('https://x/auth/v1/token?grant_type=password');
    expect(takeRetryAfter('token', clock)).toBeNull();

    const rest = createAuthFetch((() => Promise.resolve(res(429, '120'))) as unknown as typeof fetch, now);
    await rest('https://x/rest/v1/rpc/foo');
    expect(takeRetryAfter('token', clock)).toBeNull();
    expect(takeRetryAfter('resend', clock)).toBeNull();
  });

  test('a hint older than 5 s is dropped (SPEC-001-T56)', async () => {
    const f = createAuthFetch((() => Promise.resolve(res(429, '60'))) as unknown as typeof fetch, now);
    await f('https://x/auth/v1/resend');
    clock += 5_001;
    expect(takeRetryAfter('resend', clock)).toBeNull();
  });

  test('returns the same Response untouched (SPEC-001-T56)', async () => {
    const response = res(429, '10');
    const f = createAuthFetch((() => Promise.resolve(response)) as unknown as typeof fetch, now);
    expect(await f({ url: 'https://x/auth/v1/recover' } as unknown as Request)).toBe(response);
  });

  test('a base-fetch rejection propagates unchanged (SPEC-001-T56)', async () => {
    const boom = new TypeError('Network request failed');
    const f = createAuthFetch((() => Promise.reject(boom)) as unknown as typeof fetch, now);
    await expect(f('https://x/auth/v1/token')).rejects.toBe(boom);
  });
});
