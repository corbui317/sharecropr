import assert from 'node:assert/strict';
import test from 'node:test';

import { isApplePrivateRelay, isValidEmail } from '../src/domain/validation/email.ts';
import { checkPasswordBreached } from '../src/domain/auth/hibp.ts';
import { validatePasswordLength } from '../src/domain/validation/password.ts';

test('accepts Apple private relay addresses (SPEC-001-T03)', () => {
  assert.equal(isValidEmail('x7k2p@privaterelay.appleid.com'), true);
  assert.equal(isApplePrivateRelay('x7k2p@privaterelay.appleid.com'), true);
});

test('password length rules (SPEC-001-T05)', () => {
  assert.equal(validatePasswordLength('short').ok, false);
  assert.equal(validatePasswordLength('abcdefghijkl').ok, true);
  assert.equal(validatePasswordLength('a'.repeat(128)).ok, true);
  assert.equal(validatePasswordLength('a'.repeat(129)).ok, false);
  assert.equal(validatePasswordLength('short').reason, 'too_short');
  assert.equal(validatePasswordLength('a'.repeat(129)).reason, 'too_long');
});

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const FAKE_HASH = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';
const fakeSha1 = async () => FAKE_HASH.toLowerCase();

function mockFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

test('HIBP detects breached password via injected hasher (SPEC-001-T06)', async () => {
  let url;
  const restore = mockFetch(async (u) => {
    url = u;
    return new Response(`0000000000000000000000000000000000A:1\r\n${FAKE_HASH.slice(5)}:3861493`);
  });
  try {
    const result = await checkPasswordBreached('password', { sha1Hex: fakeSha1 });
    assert.deepEqual(result, { breached: true });
    assert.equal(url, 'https://api.pwnedpasswords.com/range/5BAA6');
  } finally {
    restore();
  }
});

test('HIBP reports clean password (SPEC-001-T06)', async () => {
  const restore = mockFetch(async () => new Response('0000000000000000000000000000000000A:1'));
  try {
    assert.deepEqual(await checkPasswordBreached('x', { sha1Hex: fakeSha1 }), { breached: false });
  } finally {
    restore();
  }
});

test('HIBP network failure or non-OK skips with reason network (SPEC-001-T07)', async () => {
  let restore = mockFetch(async () => {
    throw new TypeError('network down');
  });
  try {
    assert.deepEqual(await checkPasswordBreached('x', { sha1Hex: fakeSha1 }), {
      skipped: true,
      reason: 'network',
    });
  } finally {
    restore();
  }
  restore = mockFetch(async () => new Response('', { status: 503 }));
  try {
    assert.deepEqual(await checkPasswordBreached('x', { sha1Hex: fakeSha1 }), {
      skipped: true,
      reason: 'network',
    });
  } finally {
    restore();
  }
});

test('HIBP missing or failing hasher is distinct from a network skip (SPEC-001-T07)', async () => {
  let fetched = false;
  const restore = mockFetch(async () => {
    fetched = true;
    return new Response('');
  });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    assert.deepEqual(await checkPasswordBreached('x'), { skipped: true, reason: 'no_hasher' });
    const throwing = async () => {
      throw new Error('boom');
    };
    assert.deepEqual(await checkPasswordBreached('x', { sha1Hex: throwing }), {
      skipped: true,
      reason: 'no_hasher',
    });
    assert.equal(fetched, false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    restore();
  }
});

test('HIBP falls back to Node web crypto when no hasher injected (SPEC-001-T06)', async () => {
  let url;
  const restore = mockFetch(async (u) => {
    url = u;
    return new Response('');
  });
  try {
    assert.deepEqual(await checkPasswordBreached('password'), { breached: false });
    assert.equal(url, 'https://api.pwnedpasswords.com/range/5BAA6');
  } finally {
    restore();
  }
});
