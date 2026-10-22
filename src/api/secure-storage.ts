import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1800;

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const metaKey = (key: string) => `${key}__n`;
const partKey = (key: string, index: number) => `${key}__${index}`;

export const chunkedSecureStorage = {
  async getItem(key: string): Promise<string | null> {
    const n = Number(await SecureStore.getItemAsync(metaKey(key), OPTS));
    if (!n) return null;

    const parts = await Promise.all(
      Array.from({ length: n }, (_, i) => SecureStore.getItemAsync(partKey(key, i), OPTS)),
    );

    if (parts.some((part) => part == null)) {
      await chunkedSecureStorage.removeItem(key);
      return null;
    }

    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }

    const prev = Number(await SecureStore.getItemAsync(metaKey(key), OPTS)) || 0;
    await Promise.all(chunks.map((chunk, i) => SecureStore.setItemAsync(partKey(key, i), chunk, OPTS)));
    for (let i = chunks.length; i < prev; i++) {
      await SecureStore.deleteItemAsync(partKey(key, i), OPTS);
    }
    await SecureStore.setItemAsync(metaKey(key), String(chunks.length), OPTS);
  },

  async removeItem(key: string): Promise<void> {
    const n = Number(await SecureStore.getItemAsync(metaKey(key), OPTS)) || 0;
    await SecureStore.deleteItemAsync(metaKey(key), OPTS);
    for (let i = 0; i < n; i++) {
      await SecureStore.deleteItemAsync(partKey(key, i), OPTS);
    }
  },
};
