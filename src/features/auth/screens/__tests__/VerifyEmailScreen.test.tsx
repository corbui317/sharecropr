import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

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
  resendVerificationEmail: jest.Mock<
    (e: string) => Promise<{ error: string | null; retryAfterSec?: number | null }>
  >;
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

  describe('resend cooldown', () => {
    let announce: jest.SpiedFunction<typeof AccessibilityInfo.announceForAccessibility>;
    beforeEach(() => {
      jest.useFakeTimers();
      announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      mockParams = { email: 'new@example.org' };
    });
    afterEach(() => {
      jest.useRealTimers();
      announce.mockRestore();
    });

    const pressResend = async () => {
      await fireEvent.press(screen.getByRole('button', { name: authCopy.resendAvailable }));
      await act(async () => {});
    };
    const tick = (sec: number) =>
      act(async () => {
        jest.advanceTimersByTime(sec * 1000);
      });
    const resendButton = (name: string) => screen.getByRole('button', { name });

    test('a successful resend waits 60 s, not an hour (SPEC-001-T59)', async () => {
      svc.resendVerificationEmail.mockResolvedValue({ error: null });
      await render(<VerifyEmailScreen />);
      await pressResend();
      const waiting = resendButton(authCopy.resendCooldown('1:00'));
      expect(waiting.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
      expect(screen.queryByText(authCopy.resendCooldown('60:00'))).toBeNull();
      await tick(59);
      expect(resendButton(authCopy.resendCooldown('0:01'))).toBeOnTheScreen();
      await tick(1);
      const again = resendButton(authCopy.resendAvailable);
      expect(again.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
    });

    test('a 429 with retryAfterSec 47 counts down from 0:47 (SPEC-001-T59)', async () => {
      svc.resendVerificationEmail.mockResolvedValue({ error: 'rate_limited', retryAfterSec: 47 });
      await render(<VerifyEmailScreen />);
      await pressResend();
      expect(resendButton(authCopy.resendCooldown('0:47'))).toBeOnTheScreen();
      await tick(47);
      expect(resendButton(authCopy.resendAvailable)).toBeOnTheScreen();
    });

    test('a 429 without seconds falls back to 1:00 (SPEC-001-T59)', async () => {
      svc.resendVerificationEmail.mockResolvedValue({ error: 'rate_limited', retryAfterSec: null });
      await render(<VerifyEmailScreen />);
      await pressResend();
      expect(resendButton(authCopy.resendCooldown('1:00'))).toBeOnTheScreen();
    });

    test('announces at start, 30 and 0 only (SPEC-001-T59)', async () => {
      svc.resendVerificationEmail.mockResolvedValue({ error: null });
      await render(<VerifyEmailScreen />);
      await pressResend();
      await tick(60);
      expect(announce.mock.calls.map((c) => c[0])).toEqual([
        authCopy.resendCooldown('1:00'),
        authCopy.resendCooldown('0:30'),
        authCopy.resendAvailable,
      ]);
    });

    test('reason=expired shows the expired copy above the resend button (SPEC-001-T59)', async () => {
      mockParams = { email: 'new@example.org', reason: 'expired' };
      await render(<VerifyEmailScreen />);
      expect(screen.getByText(authCopy.verifyLinkExpired)).toBeOnTheScreen();
    });

    test('no expired copy without the reason (SPEC-001-T59)', async () => {
      await render(<VerifyEmailScreen />);
      expect(screen.queryByText(authCopy.verifyLinkExpired)).toBeNull();
    });

    test('a rejected resend leaves the button enabled and not loading (SPEC-001-T59)', async () => {
      svc.resendVerificationEmail.mockRejectedValueOnce(new Error('x'));
      await render(<VerifyEmailScreen />);
      await pressResend();
      const button = resendButton(authCopy.resendAvailable);
      expect(button.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
      expect(screen.getByText(authCopy.resendFailed)).toBeOnTheScreen();
    });
  });
});
