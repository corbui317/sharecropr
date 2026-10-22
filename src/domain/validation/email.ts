const APPLE_RELAY_SUFFIX = '@privaterelay.appleid.com';

export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function isApplePrivateRelay(email: string): boolean {
  return email.trim().toLowerCase().endsWith(APPLE_RELAY_SUFFIX);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
