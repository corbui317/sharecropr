import { createMMKV, deleteMMKV, type MMKV } from 'react-native-mmkv';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const MMKV_KEY_NAME = 'sc.query.encryption_key';
const CACHE_ID = 'sc.query';

let cache: MMKV | null = null;

// AES-256 key: MMKV allows at most 32 bytes, so the key is exactly 32 ASCII chars
// drawn from a 64-symbol alphabet (6 bits each = 192 bits of CSPRNG entropy, no modulo bias).
const KEY_LENGTH = 32;
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function generateKey(): string {
  const bytes = Crypto.getRandomBytes(KEY_LENGTH);
  return Array.from(bytes, (b) => KEY_ALPHABET[b & 63]).join('');
}

/**
 * Legacy installs stored a 64-char Math.random() key, which exceeds MMKV's 32-byte limit
 * and is not secret-grade. Those are discarded along with the (re-fetchable) cache file.
 */
async function getOrCreateEncryptionKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(MMKV_KEY_NAME, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (existing && existing.length === KEY_LENGTH) return existing;

  if (existing) deleteMMKV(CACHE_ID);
  const key = generateKey();
  await SecureStore.setItemAsync(MMKV_KEY_NAME, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

export async function getQueryCache(): Promise<MMKV> {
  if (cache) return cache;
  const encryptionKey = await getOrCreateEncryptionKey();
  cache = createMMKV({ id: CACHE_ID, encryptionKey, encryptionType: 'AES-256' });
  return cache;
}

export async function wipeQueryCache(): Promise<void> {
  if (cache) {
    cache.clearAll();
    cache = null;
  }
  deleteMMKV(CACHE_ID);
}
