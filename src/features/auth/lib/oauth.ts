import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { Platform } from 'react-native';

import { supabase } from '@/api/supabase';

WebBrowser.maybeCompleteAuthSession();

const redirectTo = makeRedirectUri({
  scheme: 'sharecropr',
  path: 'auth/callback',
});

export type OAuthProvider = 'apple' | 'google';

export async function signInWithApple(): Promise<{ error: Error | null }> {
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
    if (err instanceof Error && err.message.includes('ERR_REQUEST_CANCELED')) {
      return { error: null };
    }
    return { error: err instanceof Error ? err : new Error('apple_sign_in_failed') };
  }
}

export async function signInWithGoogle(): Promise<{ error: Error | null }> {
  return signInWithOAuth('google');
}

async function signInWithOAuth(provider: OAuthProvider): Promise<{ error: Error | null }> {
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
    return { error: null };
  }

  const url = new URL(result.url);
  const code = url.searchParams.get('code');
  if (!code) {
    return { error: new Error('oauth_code_missing') };
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  return { error: exchangeError };
}
