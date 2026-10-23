import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import { useSignOutAndRedirect } from '../useSignOutAndRedirect';

// SPEC-001-T55: the hook exposes pending/failed and never sets state after unmount.

jest.mock('@/features/auth/lib/sign-out', () => ({ signOutAndRedirect: jest.fn() }));
const mockSignOut = jest.requireMock<{
  signOutAndRedirect: jest.Mock<(target?: unknown) => Promise<'signed_out' | 'failed'>>;
}>('@/features/auth/lib/sign-out').signOutAndRedirect;

function defer<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useSignOutAndRedirect', () => {
  test('pending is true while in flight and false after (SPEC-001-T55)', async () => {
    const d = defer<'signed_out' | 'failed'>();
    mockSignOut.mockReturnValueOnce(d.promise);
    const { result } = await renderHook(() => useSignOutAndRedirect('/x' as never));
    expect(result.current.pending).toBe(false);
    await act(async () => {
      result.current.signOut();
    });
    expect(result.current.pending).toBe(true);
    expect(mockSignOut).toHaveBeenCalledWith('/x');
    await act(async () => {
      d.resolve('signed_out');
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.failed).toBe(false);
  });

  test('failed is set after a failure and cleared by a retry (SPEC-001-T55)', async () => {
    mockSignOut.mockResolvedValueOnce('failed');
    const { result } = await renderHook(() => useSignOutAndRedirect());
    await act(async () => {
      result.current.signOut();
    });
    expect(result.current.failed).toBe(true);
    const d = defer<'signed_out' | 'failed'>();
    mockSignOut.mockReturnValueOnce(d.promise);
    await act(async () => {
      result.current.signOut();
    });
    expect(result.current.failed).toBe(false);
    await act(async () => {
      d.resolve('signed_out');
    });
  });

  test('resolving after unmount does not touch state (SPEC-001-T55)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const d = defer<'signed_out' | 'failed'>();
    mockSignOut.mockReturnValueOnce(d.promise);
    const { result, unmount } = await renderHook(() => useSignOutAndRedirect());
    await act(async () => {
      result.current.signOut();
    });
    await unmount();
    await act(async () => {
      d.resolve('failed');
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
