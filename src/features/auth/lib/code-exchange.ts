import { supabase } from '@/api/supabase';

export type CodeExchange = { error: 'link_invalid' | null };
const exchanges = new Map<string, Promise<CodeExchange>>();

/**
 * Exchange a PKCE auth code for a session. The code and its verifier are single-use, and auth-js
 * removes the verifier even when the exchange fails, so a duplicate exchange (StrictMode's double
 * effect, a remount, or OAuth on Android delivering the same redirect to both oauth.ts and the
 * router's /auth/callback) would fail and wrongly show "link invalid": one exchange per code.
 * Resolved entries are kept; they are tiny and hold no token (SPEC-001-T47, SPEC-001-T58).
 */
export function exchangeAuthCode(code: string): Promise<CodeExchange> {
  const existing = exchanges.get(code);
  if (existing) return existing;
  const exchange = supabase.auth.exchangeCodeForSession(code).then(
    ({ error }): CodeExchange => ({ error: error ? 'link_invalid' : null }),
    (): CodeExchange => ({ error: 'link_invalid' }),
  );
  exchanges.set(code, exchange);
  return exchange;
}
