import { AppState, type AppStateStatus } from 'react-native';
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

function handleAppStateChange(state: AppStateStatus) {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
}

AppState.addEventListener('change', handleAppStateChange);
