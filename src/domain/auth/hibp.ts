const HIBP_TIMEOUT_MS = 1500;

/** Returns the SHA-1 of the UTF-8 password as UPPERCASE hex (what HIBP expects). */
export type Sha1Hex = (input: string) => Promise<string>;

export type CheckPasswordOptions = {
  /** Injected by the feature layer on Hermes, which has no crypto.subtle. */
  sha1Hex?: Sha1Hex;
};

const webCryptoSha1Hex: Sha1Hex = async (input) => {
  const data = new TextEncoder().encode(input);
  const hash = await globalThis.crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
};

function resolveHasher(options?: CheckPasswordOptions): Sha1Hex | null {
  if (options?.sha1Hex) return options.sha1Hex;
  if (typeof globalThis.crypto?.subtle?.digest === 'function') return webCryptoSha1Hex;
  return null;
}

export type HibpResult =
  | { breached: true }
  | { breached: false }
  | { skipped: true; reason: 'network' }
  // Not an R08 skip: the check could not even run. Callers must not treat this as "HIBP down".
  | { skipped: true; reason: 'no_hasher' };

export async function checkPasswordBreached(
  password: string,
  options?: CheckPasswordOptions,
): Promise<HibpResult> {
  const sha1Hex = resolveHasher(options);
  if (!sha1Hex) return { skipped: true, reason: 'no_hasher' };

  let hash: string;
  try {
    hash = (await sha1Hex(password)).toUpperCase();
  } catch {
    return { skipped: true, reason: 'no_hasher' };
  }
  if (!/^[0-9A-F]{40}$/.test(hash)) return { skipped: true, reason: 'no_hasher' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS);

  try {
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: controller.signal,
      headers: { 'Add-Padding': 'true' },
    });

    if (!response.ok) {
      return { skipped: true, reason: 'network' };
    }

    const body = await response.text();
    const breached = body.split('\n').some((line) => {
      const [hashSuffix] = line.split(':');
      return hashSuffix?.trim() === suffix;
    });

    return breached ? { breached: true } : { breached: false };
  } catch {
    return { skipped: true, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export async function hibpRequestPrefix(
  password: string,
  options?: CheckPasswordOptions,
): Promise<string> {
  const sha1Hex = resolveHasher(options);
  if (!sha1Hex) throw new Error('No SHA-1 implementation available');
  return (await sha1Hex(password)).toUpperCase().slice(0, 5);
}
