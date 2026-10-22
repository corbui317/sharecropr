import { Redirect, Tabs } from 'expo-router';

import { BootSplash } from '@/features/auth/components/BootSplash';
import { useAuthSession } from '@/features/auth/hooks/useAuthSession';

import { routes } from '@/features/auth/lib/routes';

export default function TabsLayout() {
  const { status, session, isEmailVerified } = useAuthSession();

  if (status === 'loading') {
    return <BootSplash />;
  }

  if (!session) {
    return <Redirect href={routes.signIn} />;
  }

  if (!isEmailVerified) {
    return <Redirect href={routes.verifyEmail} />;
  }

  return (
    <Tabs screenOptions={{ headerShown: true, tabBarActiveTintColor: '#1a3d2e' }}>
      <Tabs.Screen name="map" options={{ title: 'Map' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
