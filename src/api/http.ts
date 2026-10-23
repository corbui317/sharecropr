/**
 * Retry-After capture for GoTrue rate limits (SPEC-001 §8.2 "Rate limited", SPEC-001-T56).
 *
 * auth-js turns a 429 into an AuthError that carries no headers, so the only place the
 * `Retry-After` header is visible is the fetch the client was built with. This wrapper records the
 * header for 429s on /auth/v1/* and hands it out once. No imports: src/api must stay free of
 * React Native (Invariant 11). It stores only {endpoint, seconds, at} and never the URL, the query
 * string or the body (Invariant 6), and never logs.
 */

export type AuthEndpoint = 'token' | 'resend' | 'recover' | 'signup';

const MAX_RETRY_AFTER_SEC = 86_400; // garbage guard: a day
const HINT_TTL_MS = 5_000;
const ENDPOINTS: readonly string[] = ['token', 'resend', 'recover', 'signup'];

export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  let seconds: number;
  if (/^\d+$/.test(trimmed)) {
    seconds = Number(trimmed);
  } else {
    const at = Date.parse(trimmed);
    if (Number.isNaN(at) || !/[A-Za-z]/.test(trimmed)) return null;
    seconds = Math.ceil((at - nowMs) / 1000);
  }
  return seconds >= 1 && seconds <= MAX_RETRY_AFTER_SEC ? seconds : null;
}

let hint: { endpoint: AuthEndpoint; seconds: number; at: number } | null = null;

export function takeRetryAfter(endpoint: AuthEndpoint, nowMs: number = Date.now()): number | null {
  const current = hint;
  if (!current || current.endpoint !== endpoint) return null;
  hint = null;
  return nowMs - current.at <= HINT_TTL_MS ? current.seconds : null;
}

export function __resetRetryAfterForTests(): void {
  hint = null;
}

export function createAuthFetch(base?: typeof fetch, now: () => number = Date.now): typeof fetch {
  return (async (input, init) => {
    const response = await (base ?? globalThis.fetch)(input, init);
    if (response.status === 429) {
      const o = input as { url?: string; href?: string };
      const url = typeof input === 'string' ? input : (o.url ?? o.href);
      const endpoint = /\/auth\/v1\/([a-z_]+)/.exec(url ?? '')?.[1];
      if (endpoint && ENDPOINTS.includes(endpoint)) {
        const at = now();
        const seconds = parseRetryAfter(response.headers.get('retry-after'), at);
        if (seconds !== null) hint = { endpoint: endpoint as AuthEndpoint, seconds, at };
      }
    }
    return response;
  }) as typeof fetch;
}
