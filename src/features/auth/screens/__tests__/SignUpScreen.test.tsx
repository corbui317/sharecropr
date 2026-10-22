import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { authCopy } from '@/features/auth/lib/copy';

import { SignUpScreen } from '../SignUpScreen';

// SPEC-001-T48 (sessionless signUp -> verify-email with the address), T52 (provider cancel is silent).

jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Redirect: () => null,
    router: { replace: jest.fn(), push: jest.fn() },
  };
});
jest.mock('@/features/auth/hooks/useIsOffline', () => ({ useIsOffline: () => false }));
jest.mock('@/features/auth/lib/auth-service', () => ({ signUpWithEmail: jest.fn() }));
jest.mock('@/features/auth/lib/oauth', () => ({
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
}));

const mockRouter = jest.requireMock<{ router: { replace: jest.Mock } }>('expo-router').router;
const svc = jest.requireMock<{ signUpWithEmail: jest.Mock<() => Promise<unknown>> }>(
  '@/features/auth/lib/auth-service',
);
const oauth = jest.requireMock<{ signInWithApple: jest.Mock<() => Promise<unknown>> }>(
  '@/features/auth/lib/oauth',
);

describe('SignUpScreen', () => {
  const originalOS = Platform.OS;
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    Platform.OS = originalOS;
  });

  test('sessionless signUp goes to verify-email carrying the normalised address (SPEC-001-T48)', async () => {
    svc.signUpWithEmail.mockResolvedValueOnce({ data: { session: null }, error: null });
    await render(<SignUpScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), ' New@Example.org ');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'a-long-enough-passphrase');
    await fireEvent.press(screen.getByText('Create account'));
    await act(async () => {});
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/(auth)/verify-email',
      params: { email: 'new@example.org' },
    });
  });

  test('network failure shows the network copy (SPEC-001-T49)', async () => {
    svc.signUpWithEmail.mockResolvedValueOnce({ error: 'network' });
    await render(<SignUpScreen />);
    await fireEvent.press(screen.getByText('Create account'));
    await act(async () => {});
    expect(screen.getByText(authCopy.network)).toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('cancelled provider: no error, no navigation (SPEC-001-T52)', async () => {
    Platform.OS = 'android';
    oauth.signInWithApple.mockResolvedValueOnce({ error: null, cancelled: true });
    await render(<SignUpScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in with Apple' }));
    await act(async () => {});
    expect(screen.queryByText(authCopy.providerFailed('Apple'))).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
