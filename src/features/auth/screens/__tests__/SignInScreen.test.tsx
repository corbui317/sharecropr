import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { SignInScreen } from '@/features/auth/screens/SignInScreen';

// Component slice of SPEC-001-T01. The full T01 (bundle has no Facebook/X strings, real device
// layout) stays a Maestro flow per ADR-0015; this pins the provider order in the rendered tree.

jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Redirect: () => null,
    router: { replace: jest.fn(), push: jest.fn() },
  };
});
jest.mock('@/features/auth/hooks/useAuthSession', () => ({
  useAuthSession: () => ({ status: 'unauthenticated', session: null }),
}));
jest.mock('@/features/auth/hooks/useIsOffline', () => ({ useIsOffline: () => false }));
jest.mock('@/features/auth/lib/auth-service', () => ({ signInWithEmail: jest.fn() }));
jest.mock('@/features/auth/lib/oauth', () => ({
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
}));

function providerOrder() {
  const google = screen.getByRole('button', { name: 'Sign in with Google' });
  const row = google.parent;
  if (!row) throw new Error('Google button has no parent');
  return row.children.map((child) =>
    child === google ? 'google' : typeof child === 'string' ? child : String(child.type),
  );
}

describe('SignInScreen', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
  });

  test('iOS: native Apple button renders above Google, plus the email path (SPEC-001-T01)', async () => {
    Platform.OS = 'ios';
    await render(<SignInScreen />);

    const order = providerOrder();
    expect(order).toHaveLength(2);
    expect(order[0]).toMatch(/AppleAuthentication/);
    expect(order[1]).toBe('google');
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
    expect(screen.getByLabelText('Password')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
  });

  test('Android: Apple fallback button renders above Google (SPEC-001-T01)', async () => {
    Platform.OS = 'android';
    await render(<SignInScreen />);

    expect(screen.getByRole('button', { name: 'Sign in with Apple' })).toBeOnTheScreen();
    const google = screen.getByRole('button', { name: 'Sign in with Google' });
    const apple = screen.getByRole('button', { name: 'Sign in with Apple' });
    expect(google.parent?.children.indexOf(apple)).toBe(0);
    expect(google.parent?.children.indexOf(google)).toBe(1);
  });
});
