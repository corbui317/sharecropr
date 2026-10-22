import { afterEach, expect, jest, test } from '@jest/globals';

import { checkPasswordBreached } from '@/domain/auth/hibp';

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const FAKE_HASH = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';
const fakeSha1 = async () => FAKE_HASH.toLowerCase();

const realFetch = globalThis.fetch;
const realCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

function mockFetch(impl: (url: string) => Promise<Response>) {
  const fn = jest.fn(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realCrypto) Object.defineProperty(globalThis, 'crypto', realCrypto);
});

test('HIBP detects breached password via injected hasher (SPEC-001-T06)', async () => {
  const fetchMock = mockFetch(
    async () =>
      new Response(`0000000000000000000000000000000000A:1\r\n${FAKE_HASH.slice(5)}:3861493`),
  );
  await expect(checkPasswordBreached('password', { sha1Hex: fakeSha1 })).resolves.toEqual({
    breached: true,
  });
  expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.pwnedpasswords.com/range/5BAA6');
});

test('HIBP reports clean password (SPEC-001-T06)', async () => {
  mockFetch(async () => new Response('0000000000000000000000000000000000A:1'));
  await expect(checkPasswordBreached('x', { sha1Hex: fakeSha1 })).resolves.toEqual({
    breached: false,
  });
});

test('HIBP network failure or non-OK skips with reason network (SPEC-001-T07)', async () => {
  mockFetch(async () => {
    throw new TypeError('network down');
  });
  await expect(checkPasswordBreached('x', { sha1Hex: fakeSha1 })).resolves.toEqual({
    skipped: true,
    reason: 'network',
  });

  mockFetch(async () => new Response('', { status: 503 }));
  await expect(checkPasswordBreached('x', { sha1Hex: fakeSha1 })).resolves.toEqual({
    skipped: true,
    reason: 'network',
  });
});

test('HIBP missing or failing hasher is distinct from a network skip (SPEC-001-T07)', async () => {
  const fetchMock = mockFetch(async () => new Response(''));
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });

  await expect(checkPasswordBreached('x')).resolves.toEqual({ skipped: true, reason: 'no_hasher' });
  const throwing = async (): Promise<string> => {
    throw new Error('boom');
  };
  await expect(checkPasswordBreached('x', { sha1Hex: throwing })).resolves.toEqual({
    skipped: true,
    reason: 'no_hasher',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('HIBP falls back to Node web crypto when no hasher injected (SPEC-001-T06)', async () => {
  const fetchMock = mockFetch(async () => new Response(''));
  await expect(checkPasswordBreached('password')).resolves.toEqual({ breached: false });
  expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.pwnedpasswords.com/range/5BAA6');
});
