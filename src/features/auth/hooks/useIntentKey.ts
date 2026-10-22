import { useCallback, useState } from 'react';
import * as Crypto from 'expo-crypto';

export type IntentKey = { key: string; renew: () => void };

/**
 * One idempotency key per user intent (SPEC-001-T53, SCRUM-63). Retries of the same intent reuse it,
 * so the server replays the stored result instead of acting twice. A new intent gets a new key: on
 * remount, on renew(), or when `scope` changes. The server binds a key to its arguments
 * (app.idempotency_probe), so pass the argument as scope (e.g. the normalised new email).
 */
export function useIntentKey(scope = ''): IntentKey {
  const [intent, setIntent] = useState(() => ({ scope, key: Crypto.randomUUID() }));
  let current = intent;
  if (intent.scope !== scope) {
    current = { scope, key: Crypto.randomUUID() };
    setIntent(current); // React's "adjust state while rendering" pattern
  }
  const renew = useCallback(
    () => setIntent((prev) => ({ scope: prev.scope, key: Crypto.randomUUID() })),
    [],
  );
  return { key: current.key, renew };
}
