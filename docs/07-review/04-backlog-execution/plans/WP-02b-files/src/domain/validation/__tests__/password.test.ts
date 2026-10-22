import { expect, test } from '@jest/globals';

import { validatePasswordLength } from '@/domain/validation/password';

// T05's "200-character accepted" contradicts R06/N18 (reject above 128); the code follows R06/N18.
// Spec defect reported in WP-02b — not resolved here.
test('password length rules (SPEC-001-T05)', () => {
  expect(validatePasswordLength('short')).toEqual({ ok: false, reason: 'too_short' });
  expect(validatePasswordLength('a'.repeat(11))).toEqual({ ok: false, reason: 'too_short' });
  expect(validatePasswordLength('abcdefghijkl')).toEqual({ ok: true });
  expect(validatePasswordLength('a'.repeat(128))).toEqual({ ok: true });
  expect(validatePasswordLength('a'.repeat(129))).toEqual({ ok: false, reason: 'too_long' });
});
