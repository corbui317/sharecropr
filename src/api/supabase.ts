import { createClient, type Session } from '@supabase/supabase-js';
export type { Session, User } from '@supabase/supabase-js';

import { chunkedSecureStorage } from './secure-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set for auth.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: chunkedSecureStorage,
    storageKey: 'sc.auth.session',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
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
