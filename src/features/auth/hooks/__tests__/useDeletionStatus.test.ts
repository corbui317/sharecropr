import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import type { DeletionStatusResult } from '@/features/auth/lib/auth-service';

import { useDeletionStatus } from '../useDeletionStatus';

// SPEC-001-T46: deletion status is keyed on (user, attempt), derived during render.

jest.mock('@/features/auth/lib/auth-service', () => ({ getDeletionStatus: jest.fn() }));
const mockGet = jest.requireMock<{ getDeletionStatus: jest.Mock<() => Promise<DeletionStatusResult>> }>(
  '@/features/auth/lib/auth-service',
).getDeletionStatus;

function defer<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockGet.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('useDeletionStatus', () => {
  test('no user -> idle, no fetch (SPEC-001-T46)', async () => {
    const { result } = await renderHook(() => useDeletionStatus(null));
    expect(result.current.state.kind).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('user present -> loading until resolved, then ready (SPEC-001-T46)', async () => {
    const d = defer<DeletionStatusResult>();
    mockGet.mockReturnValueOnce(d.promise);
    const { result } = await renderHook(() => useDeletionStatus('u1'));
    expect(result.current.state.kind).toBe('loading');
    await act(async () => {
      d.resolve({ ok: true, status: { pending: true } });
    });
    expect(result.current.state).toEqual({ kind: 'ready', status: { pending: true } });
  });

  test("user changes -> loading again and a new fetch, never the previous user's result (SPEC-001-T46)", async () => {
    const d1 = defer<DeletionStatusResult>();
    const d2 = defer<DeletionStatusResult>();
    mockGet.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    const { result, rerender } = await renderHook((p: { id: string }) => useDeletionStatus(p.id), {
      initialProps: { id: 'u1' },
    });
    await act(async () => {
      d1.resolve({ ok: true, status: { pending: true } });
    });
    expect(result.current.state.kind).toBe('ready');
    await rerender({ id: 'u2' });
    expect(result.current.state.kind).toBe('loading');
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test('{ok:false,reason:error} -> error; retry() refetches (SPEC-001-T46)', async () => {
    mockGet.mockResolvedValueOnce({ ok: false, reason: 'error' });
    const { result } = await renderHook(() => useDeletionStatus('u1'));
    await act(async () => {});
    expect(result.current.state.kind).toBe('error');
    mockGet.mockResolvedValueOnce({ ok: true, status: { pending: false } });
    await act(async () => {
      result.current.retry();
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual({ kind: 'ready', status: { pending: false } });
  });

  test('rejection -> error (SPEC-001-T46)', async () => {
    mockGet.mockRejectedValueOnce(new Error('x'));
    const { result } = await renderHook(() => useDeletionStatus('u1'));
    await act(async () => {});
    expect(result.current.state.kind).toBe('error');
  });

  test('no answer in 8 s -> unreachable (SPEC-001-T46)', async () => {
    jest.useFakeTimers();
    mockGet.mockReturnValueOnce(new Promise(() => {}));
    const { result } = await renderHook(() => useDeletionStatus('u1'));
    expect(result.current.state.kind).toBe('loading');
    await act(async () => {
      jest.advanceTimersByTime(8000);
    });
    expect(result.current.state.kind).toBe('unreachable');
  });
});
