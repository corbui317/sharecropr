import type { Href } from 'expo-router';

export const routes = {
  home: '/' as Href,
  signIn: '/(auth)/sign-in' as Href,
  signUp: '/(auth)/sign-up' as Href,
  verifyEmail: '/(auth)/verify-email' as Href,
  forgotPassword: '/(auth)/forgot-password' as Href,
  resetPassword: '/(auth)/reset-password' as Href,
  restoreAccount: '/(auth)/restore-account' as Href,
  map: '/(tabs)/map' as Href,
  profile: '/(tabs)/profile' as Href,
  profileSecurity: '/(tabs)/profile/security' as Href,
  deleteAccount: '/(tabs)/profile/delete-account' as Href,
} as const;

/** Verify screen with the address the mail went to: signUp returns no session while confirmations are on (SPEC-001-T48). */
export const verifyEmailHref = (email: string): Href =>
  ({ pathname: '/(auth)/verify-email', params: { email } }) as Href;
