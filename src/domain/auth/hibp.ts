const HIBP_TIMEOUT_MS = 1500;

async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export type HibpResult =
  | { breached: true }
  | { breached: false }
  | { skipped: true };

export async function checkPasswordBreached(password: string): Promise<HibpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS);

  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: controller.signal,
      headers: { 'Add-Padding': 'true' },
    });

    if (!response.ok) {
      return { skipped: true };
    }

    const body = await response.text();
    const breached = body.split('\n').some((line) => {
      const [hashSuffix] = line.split(':');
      return hashSuffix?.trim() === suffix;
    });

    return breached ? { breached: true } : { breached: false };
  } catch {
    return { skipped: true };
  } finally {
    clearTimeout(timer);
  }
}

export function hibpRequestPrefix(password: string): Promise<string> {
  return sha1Hex(password).then((hash) => hash.slice(0, 5));
}
