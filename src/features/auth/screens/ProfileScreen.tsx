import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { useAuthSession } from '@/features/auth/hooks/useAuthSession';
import { useSignOutAndRedirect } from '@/features/auth/hooks/useSignOutAndRedirect';
import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

/**
 * Profile tab logic (SPEC-001-T55). Lives here because every .ts(x) under app/ is a route;
 * app/(tabs)/profile/index.tsx only re-exports it.
 */
export function ProfileScreen() {
  const { user } = useAuthSession();
  const { signOut, pending, failed } = useSignOutAndRedirect();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.email}>{user?.email}</Text>
      <AuthButton label="Security" variant="secondary" onPress={() => router.push(routes.profileSecurity)} />
      <AuthButton label={authCopy.signOut} variant="secondary" loading={pending} onPress={signOut} />
      {failed ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {authCopy.signOutFailed}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, backgroundColor: '#f7f5f0' },
  title: { fontSize: 24, fontWeight: '700', color: '#1a3d2e' },
  email: { fontSize: 16, color: '#3d4f46', marginBottom: 12 },
  error: { color: '#b42318', fontSize: 14 },
});
