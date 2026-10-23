import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

import { VerifyEmailScreen } from '../VerifyEmailScreen';

// SPEC-001-T48: verify-email works without a session (signUp returns none while confirmations are on).

const mockRedirects: unknown[] = [];
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Redirect: ({ href }: { href: unknown }) => {
      mockRedirects.push(href);
      return null;
    },
    router: { replace: jest.fn(), push: jest.fn() },
    useLocalSearchParams: () => mockParams,
  };
});
type AuthState = {
  status: string;
  session: object | null;
  user: { id: string; email?: string } | null;
  isEmailVerified: boolean;
};
let mockAuth: AuthState;
jest.mock('@/features/auth/hooks/useAuthSession', () => ({ useAuthSession: () => mockAuth }));
jest.mock('@/features/auth/lib/auth-service', () => ({
  resendVerificationEmail: jest.fn(),
  signOut: jest.fn(() => Promise.resolve()),
}));
const svc = jest.requireMock<{
  resendVerificationEmail: jest.Mock<(e: string) => Promise<{ error: string | null }>>;
  signOut: jest.Mock<() => Promise<void>>;
}>('@/features/auth/lib/auth-service');

beforeEach(() => {
  jest.clearAllMocks();
  mockRedirects.length = 0;
  mockParams = {};
  mockAuth = { status: 'unauthenticated', session: null, user: null, isEmailVerified: false };
});

describe('VerifyEmailScreen', () => {
  test('sessionless: shows the address from params and resends to it (SPEC-001-T48)', async () => {
    mockParams = { email: 'new@example.org' };
    svc.resendVerificationEmail.mockResolvedValue({ error: null });
    await render(<VerifyEmailScreen />);
    expect(screen.getByText(authCopy.verifyBody('new@example.org'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(authCopy.resendAvailable));
    await act(async () => {});
    expect(svc.resendVerificationEmail).toHaveBeenCalledWith('new@example.org');
    expect(mockRedirects).toHaveLength(0);
  });

  test('no session and no address -> /sign-in (SPEC-001-T48)', async () => {
    await render(<VerifyEmailScreen />);
    expect(mockRedirects).toEqual([routes.signIn]);
  });

  test('verified session -> /map (SPEC-001-T48)', async () => {
    mockAuth = {
      status: 'authenticated',
      session: {},
      user: { id: 'u1', email: 'a@b.org' },
      isEmailVerified: true,
    };
    await render(<VerifyEmailScreen />);
    expect(mockRedirects).toEqual([routes.map]);
  });

  test('resend network failure shows the network copy (SPEC-001-T49)', async () => {
    mockParams = { email: 'new@example.org' };
    svc.resendVerificationEmail.mockResolvedValue({ error: 'network' });
    await render(<VerifyEmailScreen />);
    await fireEvent.press(screen.getByText(authCopy.resendAvailable));
    await act(async () => {});
    expect(screen.getByText(authCopy.network)).toBeOnTheScreen();
  });

  const signedInUnverified: AuthState = {
    status: 'authenticated',
    session: {},
    user: { id: 'u1', email: 'a@b.org' },
    isEmailVerified: false,
  };

  test('signed in: Sign out signs out then replaces to sign-in (SPEC-001-T55)', async () => {
    mockAuth = signedInUnverified;
    svc.signOut.mockResolvedValueOnce();
    await render(<VerifyEmailScreen />);
    await fireEvent.press(screen.getByText(authCopy.signOut));
    await act(async () => {});
    expect(svc.signOut).toHaveBeenCalledTimes(1);
    expect(jest.requireMock<{ router: { replace: jest.Mock } }>('expo-router').router.replace).toHaveBeenCalledWith(
      routes.signIn,
    );
  });

  test('signed in: a failed Sign out shows inline copy (SPEC-001-T55)', async () => {
    mockAuth = signedInUnverified;
    svc.signOut.mockRejectedValueOnce(new Error('x'));
    await render(<VerifyEmailScreen />);
    await fireEvent.press(screen.getByText(authCopy.signOut));
    await act(async () => {});
    expect(screen.getByText(authCopy.signOutFailed)).toBeOnTheScreen();
  });

  test('a rejected resend shows resendFailed and the button is usable (SPEC-001-T57)', async () => {
    mockParams = { email: 'new@example.org' };
    svc.resendVerificationEmail.mockRejectedValueOnce(new Error('x'));
    await render(<VerifyEmailScreen />);
    await fireEvent.press(screen.getByText(authCopy.resendAvailable));
    await act(async () => {});
    expect(screen.getByText(authCopy.resendFailed)).toBeOnTheScreen();
    expect(screen.getByText(authCopy.resendAvailable)).toBeOnTheScreen();
  });
});
