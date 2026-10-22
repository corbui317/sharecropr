import { expect, test } from '@jest/globals';

import { isApplePrivateRelay, isValidEmail } from '@/domain/validation/email';

test('accepts Apple private relay addresses (SPEC-001-T03)', () => {
  expect(isValidEmail('x7k2p@privaterelay.appleid.com')).toBe(true);
  expect(isApplePrivateRelay('x7k2p@privaterelay.appleid.com')).toBe(true);
});
