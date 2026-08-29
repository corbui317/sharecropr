import { createMMKV, deleteMMKV, type MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';

const MMKV_KEY_NAME = 'sc.query.encryption_key';
const CACHE_ID = 'sc.query';

let cache: MMKV | null = null;

async function getOrCreateEncryptionKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(MMKV_KEY_NAME, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (existing) return existing;

  const key = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0'),
  ).join('');
  await SecureStore.setItemAsync(MMKV_KEY_NAME, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

export async function getQueryCache(): Promise<MMKV> {
  if (cache) return cache;
  const encryptionKey = await getOrCreateEncryptionKey();
  cache = createMMKV({ id: CACHE_ID, encryptionKey });
  return cache;
}

export async function wipeQueryCache(): Promise<void> {
  if (cache) {
    cache.clearAll();
    cache = null;
  }
  deleteMMKV(CACHE_ID);
}
