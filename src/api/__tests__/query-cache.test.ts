import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { getQueryCache, wipeQueryCache } from '../query-cache';

// SPEC-001-T54 (unit, R25): getQueryCache is single-flight.

jest.mock('react-native-mmkv', () => ({
  createMMKV: jest.fn(() => ({ clearAll: jest.fn() })),
  deleteMMKV: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: jest.fn((n: number) => new Uint8Array(n)),
}));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
}));

const mmkv = jest.requireMock<{ createMMKV: jest.Mock }>('react-native-mmkv');
const store = jest.requireMock<{
  getItemAsync: jest.Mock<(...a: unknown[]) => Promise<string | null>>;
  setItemAsync: jest.Mock;
}>('expo-secure-store');

function defer<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('getQueryCache single-flight', () => {
  beforeEach(async () => {
    await wipeQueryCache();
    mmkv.createMMKV.mockClear();
    store.getItemAsync.mockClear();
    store.setItemAsync.mockClear();
  });

  test('concurrent first calls create one key and one MMKV instance (SPEC-001-T54)', async () => {
    const d = defer<string | null>();
    store.getItemAsync.mockImplementationOnce(() => d.promise);
    const a = getQueryCache();
    const b = getQueryCache();
    d.resolve(null);
    const [ca, cb] = await Promise.all([a, b]);
    expect(ca).toBe(cb);
    expect(store.setItemAsync).toHaveBeenCalledTimes(1);
    expect(mmkv.createMMKV).toHaveBeenCalledTimes(1);
    expect(store.getItemAsync).toHaveBeenCalledTimes(1);
  });

  test('a failed init does not wedge the lock; the next call retries (SPEC-001-T54)', async () => {
    store.getItemAsync.mockRejectedValueOnce(new Error('keychain locked'));
    await expect(getQueryCache()).rejects.toThrow('keychain locked');
    await expect(getQueryCache()).resolves.toBeDefined();
    expect(mmkv.createMMKV).toHaveBeenCalledTimes(1);
  });

  test('once open, later calls reuse the instance without touching SecureStore (SPEC-001-T54)', async () => {
    const first = await getQueryCache();
    store.getItemAsync.mockClear();
    const second = await getQueryCache();
    expect(second).toBe(first);
    expect(store.getItemAsync).not.toHaveBeenCalled();
  });
});
