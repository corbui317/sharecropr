import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { routes } from '../routes';
import { signOutAndRedirect } from '../sign-out';

// SPEC-001-T55 (R25, §8.2 Error, Invariant 10): sign-out never rejects, navigates only on success.

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('@/features/auth/lib/auth-service', () => ({ signOut: jest.fn() }));

const mockSignOut = jest.requireMock<{ signOut: jest.Mock<() => Promise<void>> }>(
  '@/features/auth/lib/auth-service',
).signOut;
const mockReplace = jest.requireMock<{ router: { replace: jest.Mock } }>('expo-router').router.replace;

function defer() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('signOutAndRedirect', () => {
  test('navigates after signOut resolves and reports signed_out (SPEC-001-T55)', async () => {
    mockSignOut.mockResolvedValueOnce();
    await expect(signOutAndRedirect(routes.signUp)).resolves.toBe('signed_out');
    expect(mockReplace).toHaveBeenCalledWith(routes.signUp);
    expect(mockSignOut.mock.invocationCallOrder[0]).toBeLessThan(
      mockReplace.mock.invocationCallOrder[0] as number,
    );
  });

  test('defaults to the sign-in route (SPEC-001-T55)', async () => {
    mockSignOut.mockResolvedValueOnce();
    await signOutAndRedirect();
    expect(mockReplace).toHaveBeenCalledWith(routes.signIn);
  });

  test('a rejecting signOut resolves failed, does not navigate, and never rejects (SPEC-001-T55)', async () => {
    mockSignOut.mockRejectedValueOnce(new Error('x'));
    await expect(signOutAndRedirect()).resolves.toBe('failed');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test('a throwing router.replace is also contained (SPEC-001-T55)', async () => {
    mockSignOut.mockResolvedValueOnce();
    mockReplace.mockImplementationOnce(() => {
      throw new Error('nav');
    });
    await expect(signOutAndRedirect()).resolves.toBe('failed');
  });

  test('concurrent calls share one signOut and one outcome (SPEC-001-T55)', async () => {
    const d = defer();
    mockSignOut.mockReturnValueOnce(d.promise);
    const a = signOutAndRedirect();
    const b = signOutAndRedirect();
    d.resolve();
    expect(await a).toBe('signed_out');
    expect(await b).toBe('signed_out');
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  test('after it settles, a new call signs out again (SPEC-001-T55)', async () => {
    mockSignOut.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce();
    expect(await signOutAndRedirect()).toBe('failed');
    expect(await signOutAndRedirect()).toBe('signed_out');
    expect(mockSignOut).toHaveBeenCalledTimes(2);
  });
});
