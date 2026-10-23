import { createClient, type Session } from '@supabase/supabase-js';
export type { Session, User } from '@supabase/supabase-js';

import { createAuthFetch } from './http';
import { chunkedSecureStorage } from './secure-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set for auth.',
  );
}

const AUTH_STORAGE_KEY = 'sc.auth.session';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: chunkedSecureStorage,
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  // SPEC-001-T56: AuthError carries no headers, so Retry-After is captured here.
  global: { fetch: createAuthFetch() },
});

let refreshLock: Promise<Session | null> | null = null;

export async function refreshSessionSingleFlight(): Promise<Session | null> {
  if (refreshLock) return refreshLock;
  refreshLock = supabase.auth.refreshSession().then(({ data }) => data.session);
  try {
    return await refreshLock;
  } finally {
    refreshLock = null;
  }
}

/**
 * Token auto-refresh lifecycle (SPEC-001 R24). GoTrue cannot see the app lifecycle on a phone, and
 * src/api may not import React Native (AGENTS.md Invariant 11), so the AppState listener is the boot
 * hook src/features/auth/hooks/useAuthAutoRefresh.ts, which calls these. Both are idempotent.
 * SCRUM-62 · mobile-architecture §5.3.
 */
export function startAutoRefresh(): Promise<void> {
  return supabase.auth.startAutoRefresh();
}

export function stopAutoRefresh(): Promise<void> {
  return supabase.auth.stopAutoRefresh();
}

/**
 * Sign out, revoking the refresh token server-side when the server is reachable (SPEC-001 R25, T19).
 *
 * GoTrue's signOut() loads the session first. If the access token has expired and the refresh
 * cannot reach the server (offline, 5xx), it returns that error WITHOUT clearing storage, and
 * signOut({ scope: 'local' }) takes the same early return. So on any failure we purge the persisted
 * session ourselves, then run the local sign-out: it now finds no session, clears the PKCE verifier
 * and user entries, and emits SIGNED_OUT so AuthProvider updates. Offline, the refresh token stays
 * valid server-side until it expires (R23); that is the honest limit of signing out offline.
 */
export async function signOutWithLocalFallback(): Promise<{ remoteRevoked: boolean }> {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (!error) return { remoteRevoked: true };
  } catch {
    // fall through: purge locally
  }
  await chunkedSecureStorage.removeItem(AUTH_STORAGE_KEY);
  await supabase.auth.signOut({ scope: 'local' });
  return { remoteRevoked: false };
}
