import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';

type Props = {
  loadingProvider: 'apple' | 'google' | 'email' | null;
  disabled?: boolean;
  onApple: () => void;
  onGoogle: () => void;
};

export function ProviderButtons({ loadingProvider, disabled, onApple, onGoogle }: Props) {
  const busy = loadingProvider !== null;

  return (
    <View style={styles.container}>
      {Platform.OS === 'ios' && !disabled && !busy ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={12}
          style={styles.appleButton}
          onPress={onApple}
        />
      ) : (
        <Pressable
          style={[styles.button, styles.appleFallback]}
          onPress={onApple}
          disabled={disabled || busy}
          accessibilityRole="button"
          accessibilityLabel="Sign in with Apple"
        >
          {loadingProvider === 'apple' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.appleText}>Sign in with Apple</Text>
          )}
        </Pressable>
      )}

      <Pressable
        style={[styles.button, styles.google]}
        onPress={onGoogle}
        disabled={disabled || busy}
        accessibilityRole="button"
        accessibilityLabel="Sign in with Google"
      >
        {loadingProvider === 'google' ? (
          <ActivityIndicator color="#1a3d2e" />
        ) : (
          <Text style={styles.googleText}>Sign in with Google</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  appleButton: { width: '100%', height: 48 },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  appleFallback: { backgroundColor: '#000' },
  appleText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  google: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#c5d4cb' },
  googleText: { color: '#1a3d2e', fontSize: 16, fontWeight: '600' },
});
