import assert from 'node:assert/strict';
import test from 'node:test';

import { isApplePrivateRelay, isValidEmail } from '../src/domain/validation/email.ts';
import { validatePasswordLength } from '../src/domain/validation/password.ts';

test('accepts Apple private relay addresses (T03)', () => {
  assert.equal(isValidEmail('x7k2p@privaterelay.appleid.com'), true);
  assert.equal(isApplePrivateRelay('x7k2p@privaterelay.appleid.com'), true);
});

test('password length rules (T05)', () => {
  assert.equal(validatePasswordLength('short').ok, false);
  assert.equal(validatePasswordLength('abcdefghijkl').ok, true);
  assert.equal(validatePasswordLength('a'.repeat(128)).ok, true);
  assert.equal(validatePasswordLength('a'.repeat(129)).ok, false);
});
