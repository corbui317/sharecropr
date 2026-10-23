import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { Platform } from 'react-native';

import { supabase } from '@/api/supabase';
import { exchangeAuthCode } from '@/features/auth/lib/code-exchange';
import { parseAuthRedirect } from '@/features/auth/lib/deep-link';

WebBrowser.maybeCompleteAuthSession();

const redirectTo = makeRedirectUri({
  scheme: 'sharecropr',
  path: 'auth/callback',
});

export type OAuthProvider = 'apple' | 'google';

export type OAuthResult = { error: Error | null; cancelled?: boolean };

// expo-modules CodedError: the code is on .code; the message is 'The user canceled the authorization attempt'.
function isUserCancel(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ERR_REQUEST_CANCELED'
  );
}

export async function signInWithApple(): Promise<OAuthResult> {
  if (Platform.OS !== 'ios') {
    return signInWithOAuth('apple');
  }

  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      return { error: new Error('missing_identity_token') };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });

    if (error) return { error };

    const displayName = credential.fullName
      ? `${credential.fullName.givenName ?? ''} ${credential.fullName.familyName ?? ''}`.trim()
      : '';

    if (displayName.length >= 2) {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (userId) {
        await supabase.auth.updateUser({ data: { display_name: displayName } });
        await supabase.from('profiles').update({ display_name: displayName }).eq('id', userId);
      }
    }

    return { error: null };
  } catch (err) {
    if (isUserCancel(err)) return { error: null, cancelled: true };
    return { error: err instanceof Error ? err : new Error('apple_sign_in_failed') };
  }
}

export async function signInWithGoogle(): Promise<OAuthResult> {
  return signInWithOAuth('google');
}

async function signInWithOAuth(provider: OAuthProvider): Promise<OAuthResult> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    return { error: error ?? new Error('oauth_url_missing') };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success' || !result.url) {
    return { error: null, cancelled: true };
  }

  // On Android the same redirect can also reach the router's /auth/callback (SPEC-001-T58). The PKCE
  // verifier is single-use, so both callers go through one exchange per code.
  const parsed = parseAuthRedirect(result.url);
  if (parsed.kind !== 'code') {
    return { error: new Error('oauth_code_missing') };
  }

  const exchanged = await exchangeAuthCode(parsed.code);
  return { error: exchanged.error ? new Error('oauth_exchange_failed') : null };
}
