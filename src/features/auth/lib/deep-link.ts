export type AuthRedirect =
  | { kind: 'code'; code: string }
  | { kind: 'error'; reason: 'expired' | 'denied' | 'other' }
  | { kind: 'none' };

const CODE_PATTERN = /^[A-Za-z0-9._~-]{1,512}$/;
const WANTED = new Set(['code', 'error', 'error_code']);

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/** Collects only the keys we act on. Implicit-flow tokens in the fragment are never read or kept (Invariant 6). */
function collect(part: string, into: Record<string, string>): void {
  for (const pair of part.split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq);
    if (!WANTED.has(key) || key in into) continue;
    const value = decode(pair.slice(eq + 1));
    if (value !== null) into[key] = value;
  }
}

/**
 * Reads the outcome of an auth redirect (SPEC-001-T58). GoTrue puts errors in the fragment when it
 * cannot tell which flow a link belonged to, so both the query and the fragment are read. Parsed by
 * hand: the React Native URL polyfill is partial. An error always wins over a code. Never log the URL.
 */
export function parseAuthRedirect(url: string | null): AuthRedirect {
  if (!url) return { kind: 'none' };
  const hash = url.indexOf('#');
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? '' : url.slice(hash + 1);
  const q = beforeHash.indexOf('?');
  const query = q === -1 ? '' : beforeHash.slice(q + 1);

  const params: Record<string, string> = {};
  collect(query, params);
  collect(fragment, params);

  if (params.error !== undefined || params.error_code !== undefined) {
    if (params.error_code === 'otp_expired') return { kind: 'error', reason: 'expired' };
    if (params.error === 'access_denied') return { kind: 'error', reason: 'denied' };
    return { kind: 'error', reason: 'other' };
  }
  const code = params.code;
  if (code !== undefined && CODE_PATTERN.test(code)) return { kind: 'code', code };
  return { kind: 'none' };
}
