import { describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import { useIntentKey } from '../useIntentKey';

// SPEC-001-T53: one idempotency key per user intent.

jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: jest.fn(() => `k${++n}`) };
});

describe('useIntentKey', () => {
  test('stable across re-renders (SPEC-001-T53)', async () => {
    const { result, rerender } = await renderHook(() => useIntentKey());
    const first = result.current.key;
    await rerender({});
    await rerender({});
    expect(result.current.key).toBe(first);
  });

  test('renew() mints a new key (SPEC-001-T53)', async () => {
    const { result } = await renderHook(() => useIntentKey());
    const first = result.current.key;
    await act(async () => {
      result.current.renew();
    });
    expect(result.current.key).not.toBe(first);
  });

  test('a changed scope mints a new key; the same scope keeps it (SPEC-001-T53)', async () => {
    const { result, rerender } = await renderHook((p: { scope: string }) => useIntentKey(p.scope), {
      initialProps: { scope: 'a@b.org' },
    });
    const first = result.current.key;
    await rerender({ scope: 'a@b.org' });
    expect(result.current.key).toBe(first);
    await rerender({ scope: 'c@d.org' });
    expect(result.current.key).not.toBe(first);
  });

  test('two mounts get different keys (SPEC-001-T53)', async () => {
    const one = await renderHook(() => useIntentKey());
    const two = await renderHook(() => useIntentKey());
    expect(one.result.current.key).not.toBe(two.result.current.key);
  });
});
