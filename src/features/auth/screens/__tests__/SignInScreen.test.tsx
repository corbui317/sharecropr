import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { authCopy } from '@/features/auth/lib/copy';
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

const mockSignIn = jest.requireMock<{ signInWithEmail: jest.Mock<() => Promise<unknown>> }>(
  '@/features/auth/lib/auth-service',
).signInWithEmail;
const mockOauth = jest.requireMock<{ signInWithApple: jest.Mock<() => Promise<unknown>> }>(
  '@/features/auth/lib/oauth',
);
const mockRouter = jest.requireMock<{ router: { replace: jest.Mock } }>('expo-router').router;

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
    jest.clearAllMocks();
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

  test.each([
    ['rate_limited', authCopy.signInRateLimited],
    ['network', authCopy.network],
  ])('%s gets its own copy, not wrongCredentials (SPEC-001-T49)', async (code, copy) => {
    Platform.OS = 'ios';
    mockSignIn.mockResolvedValueOnce({ error: code });
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'a@b.org');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'whatever-password');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await act(async () => {});
    expect(screen.getByText(copy)).toBeOnTheScreen();
    expect(screen.queryByText(authCopy.wrongCredentials)).toBeNull();
  });

  test('email_not_confirmed routes to verify-email with the address (SPEC-001-T49)', async () => {
    Platform.OS = 'ios';
    mockSignIn.mockResolvedValueOnce({ error: 'email_not_confirmed' });
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), ' A@B.org ');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'whatever-password');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await act(async () => {});
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/(auth)/verify-email',
      params: { email: 'a@b.org' },
    });
    expect(screen.queryByText(authCopy.wrongCredentials)).toBeNull();
  });

  test('Apple cancel is silent (SPEC-001-T52)', async () => {
    Platform.OS = 'android';
    mockOauth.signInWithApple.mockResolvedValueOnce({ error: null, cancelled: true });
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in with Apple' }));
    await act(async () => {});
    expect(screen.queryByText(authCopy.providerFailed('Apple'))).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
