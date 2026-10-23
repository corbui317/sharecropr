import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { authCopy } from '@/features/auth/lib/copy';
import { routes, verifyEmailHref } from '@/features/auth/lib/routes';

import { AuthCallbackScreen } from '../AuthCallbackScreen';

// SPEC-001-T58: /auth/callback exchanges the PKCE code once, reads fragment errors, never dead-ends.

const BASE = 'sharecropr://auth/callback';

const mockRedirects: unknown[] = [];
let mockParams: Record<string, string> = {};
let mockUrl: string | null = null;
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: unknown }) => {
    mockRedirects.push(href);
    return null;
  },
  router: { replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-linking', () => ({ useLinkingURL: () => mockUrl }));
let mockAuth: { status: string; session: object | null };
jest.mock('@/features/auth/hooks/useAuthSession', () => ({ useAuthSession: () => mockAuth }));
jest.mock('@/features/auth/lib/auth-service', () => ({ getPendingVerificationEmail: jest.fn(() => null) }));
// The real single-flight runs over a mocked SDK, so StrictMode's double effect is really exercised.
jest.mock('@/api/supabase', () => ({ supabase: { auth: { exchangeCodeForSession: jest.fn() } } }));

type Fn = jest.Mock<(...a: unknown[]) => Promise<unknown>>;
const sdk = jest.requireMock<{ supabase: { auth: { exchangeCodeForSession: Fn } } }>('@/api/supabase').supabase.auth;
const svc = jest.requireMock<{ getPendingVerificationEmail: jest.Mock<() => string | null> }>(
  '@/features/auth/lib/auth-service',
);
const mockRouter = jest.requireMock<{ router: { replace: jest.Mock } }>('expo-router').router;

beforeEach(() => {
  jest.clearAllMocks();
  mockRedirects.length = 0;
  mockParams = {};
  mockUrl = null;
  mockAuth = { status: 'unauthenticated', session: null };
  svc.getPendingVerificationEmail.mockReturnValue(null);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AuthCallbackScreen', () => {
  test('a code exchanges once (even under StrictMode), then redirects to / (SPEC-001-T58)', async () => {
    mockUrl = `${BASE}?code=once-1`;
    sdk.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    await render(
      <StrictMode>
        <AuthCallbackScreen />
      </StrictMode>,
    );
    await act(async () => {});
    expect(sdk.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(sdk.exchangeCodeForSession).toHaveBeenCalledWith('once-1');
    expect(mockRedirects).toContain(routes.home);
  });

  test('the code from route params is used when the URL has none (SPEC-001-T58)', async () => {
    mockUrl = BASE;
    mockParams = { code: 'param-1' };
    sdk.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    await render(<AuthCallbackScreen />);
    await act(async () => {});
    expect(sdk.exchangeCodeForSession).toHaveBeenCalledWith('param-1');
    expect(mockRedirects).toContain(routes.home);
  });

  test('exchange fails with no session -> already-used state with a sign-in action (SPEC-001-T58)', async () => {
    mockUrl = `${BASE}?code=used-1`;
    sdk.exchangeCodeForSession.mockResolvedValue({ data: null, error: { message: 'x' } });
    await render(<AuthCallbackScreen />);
    await act(async () => {});
    expect(screen.getByText(authCopy.verifyLinkUsed)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(authCopy.backToSignIn));
    expect(mockRouter.replace).toHaveBeenCalledWith(routes.signIn);
    expect(mockRedirects).not.toContain(routes.home);
  });

  test('exchange fails but a session exists -> / (SPEC-001-T58)', async () => {
    mockUrl = `${BASE}?code=used-2`;
    mockAuth = { status: 'authenticated', session: {} };
    sdk.exchangeCodeForSession.mockResolvedValue({ data: null, error: { message: 'x' } });
    await render(<AuthCallbackScreen />);
    await act(async () => {});
    expect(mockRedirects).toContain(routes.home);
    expect(screen.queryByText(authCopy.verifyLinkUsed)).toBeNull();
  });

  test('an exchange that never settles resolves to the used state after 10 s (SPEC-001-T58)', async () => {
    jest.useFakeTimers();
    mockUrl = `${BASE}?code=hang-1`;
    sdk.exchangeCodeForSession.mockReturnValue(new Promise(() => {}));
    await render(<AuthCallbackScreen />);
    await act(async () => {
      jest.advanceTimersByTime(9000);
    });
    expect(screen.queryByText(authCopy.verifyLinkUsed)).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.getByText(authCopy.verifyLinkUsed)).toBeOnTheScreen();
  });

  test('a fragment otp_expired with a known pending address -> verify-email with reason expired (SPEC-001-T58)', async () => {
    mockUrl = `${BASE}#error=access_denied&error_code=otp_expired`;
    svc.getPendingVerificationEmail.mockReturnValue('new@example.org');
    await render(<AuthCallbackScreen />);
    expect(mockRedirects).toEqual([verifyEmailHref('new@example.org', 'expired')]);
    expect(mockRedirects[0]).toEqual({
      pathname: '/(auth)/verify-email',
      params: { email: 'new@example.org', reason: 'expired' },
    });
    expect(sdk.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test('expired with no pending address -> expired copy and a sign-in action (SPEC-001-T58)', async () => {
    mockUrl = `${BASE}#error=access_denied&error_code=otp_expired`;
    await render(<AuthCallbackScreen />);
    expect(screen.getByText(authCopy.verifyLinkExpired)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(authCopy.backToSignIn));
    expect(mockRouter.replace).toHaveBeenCalledWith(routes.signIn);
    expect(mockRedirects).toHaveLength(0);
  });

  test('a denied or other error shows the used state (SPEC-001-T58)', async () => {
    mockUrl = `${BASE}?error=server_error`;
    await render(<AuthCallbackScreen />);
    expect(screen.getByText(authCopy.verifyLinkUsed)).toBeOnTheScreen();
  });

  test('no params and no session -> /sign-in; with a session -> / (SPEC-001-T58)', async () => {
    mockUrl = BASE;
    const first = await render(<AuthCallbackScreen />);
    expect(mockRedirects).toEqual([routes.signIn]);
    await first.unmount();

    mockRedirects.length = 0;
    mockAuth = { status: 'authenticated', session: {} };
    await render(<AuthCallbackScreen />);
    expect(mockRedirects).toEqual([routes.home]);
  });

  test('a URL that has not arrived yet waits, then falls through to /sign-in (SPEC-001-T58)', async () => {
    jest.useFakeTimers();
    mockUrl = null;
    await render(<AuthCallbackScreen />);
    expect(mockRedirects).toHaveLength(0);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockRedirects).toContain(routes.signIn);
  });

  test('the session status loading shows no redirect yet (SPEC-001-T58)', async () => {
    mockUrl = BASE;
    mockAuth = { status: 'loading', session: null };
    await render(<AuthCallbackScreen />);
    expect(mockRedirects).toHaveLength(0);
  });
});
