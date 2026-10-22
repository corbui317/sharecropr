import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { useAuthSession } from '@/features/auth/hooks/useAuthSession';
import { signOut } from '@/features/auth/lib/auth-service';

import { routes } from '@/features/auth/lib/routes';

export default function ProfileScreen() {
  const { user } = useAuthSession();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.email}>{user?.email}</Text>
      <AuthButton label="Security" variant="secondary" onPress={() => router.push(routes.profileSecurity)} />
      <AuthButton
        label="Sign out"
        variant="secondary"
        onPress={() => {
          void signOut().then(() => router.replace(routes.signIn));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, backgroundColor: '#f7f5f0' },
  title: { fontSize: 24, fontWeight: '700', color: '#1a3d2e' },
  email: { fontSize: 16, color: '#3d4f46', marginBottom: 12 },
});
