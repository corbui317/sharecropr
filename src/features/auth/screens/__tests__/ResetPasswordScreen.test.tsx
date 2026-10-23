import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

import { ResetPasswordScreen } from '../ResetPasswordScreen';

// SPEC-001-T47: the reset deep link exchanges the PKCE code exactly once before showing the form.

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Redirect: () => null,
    router: { replace: jest.fn(), push: jest.fn() },
    useLocalSearchParams: () => mockParams,
  };
});
let mockAuth: { status: string; session: object | null } = { status: 'unauthenticated', session: null };
jest.mock('@/features/auth/hooks/useAuthSession', () => ({ useAuthSession: () => mockAuth }));
let mockUrl: string | null = null;
jest.mock('expo-linking', () => ({ useLinkingURL: () => mockUrl }));
jest.mock('@/features/auth/lib/auth-service', () => ({ updatePassword: jest.fn() }));
jest.mock('@/features/auth/lib/code-exchange', () => ({ exchangeAuthCode: jest.fn() }));

type Fn = jest.Mock<(...a: unknown[]) => Promise<unknown>>;
const svc = jest.requireMock<{ updatePassword: Fn }>('@/features/auth/lib/auth-service');
const exchange = jest.requireMock<{ exchangeAuthCode: Fn }>('@/features/auth/lib/code-exchange');
const mockRouter = jest.requireMock<{ router: { replace: jest.Mock } }>('expo-router').router;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockUrl = null;
  mockAuth = { status: 'unauthenticated', session: null };
});

describe('ResetPasswordScreen', () => {
  test('?code= exchanges once, then shows the form; submit calls updatePassword (SPEC-001-T47)', async () => {
    mockParams = { code: 'abc' };
    exchange.exchangeAuthCode.mockResolvedValue({ error: null });
    svc.updatePassword.mockResolvedValue({ error: null });
    await render(<ResetPasswordScreen />);
    await act(async () => {});
    expect(exchange.exchangeAuthCode).toHaveBeenCalledTimes(1);
    expect(exchange.exchangeAuthCode).toHaveBeenCalledWith('abc');
    await fireEvent.changeText(screen.getByLabelText('New password'), 'a-long-enough-passphrase');
    await fireEvent.changeText(screen.getByLabelText('Confirm password'), 'a-long-enough-passphrase');
    await fireEvent.press(screen.getByText('Update password'));
    await act(async () => {});
    expect(svc.updatePassword).toHaveBeenCalledWith('a-long-enough-passphrase');
    expect(mockRouter.replace).toHaveBeenCalledWith(routes.signIn);
  });

  test('failed exchange -> request-a-new-link state, which routes to forgot-password (SPEC-001-T47)', async () => {
    mockParams = { code: 'used' };
    exchange.exchangeAuthCode.mockResolvedValue({ error: 'link_invalid' });
    await render(<ResetPasswordScreen />);
    await act(async () => {});
    expect(screen.getByText(authCopy.resetLinkInvalidTitle)).toBeOnTheScreen();
    expect(screen.queryByLabelText('New password')).toBeNull();
    await fireEvent.press(screen.getByText(authCopy.resetLinkRequestNew));
    expect(mockRouter.replace).toHaveBeenCalledWith(routes.forgotPassword);
  });

  test('?error_code=otp_expired -> invalid state, no exchange (SPEC-001-T47)', async () => {
    mockParams = { error: 'access_denied', error_code: 'otp_expired', code: 'abc' };
    await render(<ResetPasswordScreen />);
    await act(async () => {});
    expect(screen.getByText(authCopy.resetLinkInvalidTitle)).toBeOnTheScreen();
    expect(exchange.exchangeAuthCode).not.toHaveBeenCalled();
  });

  test('no code and no session -> invalid; no code with a session -> form (SPEC-001-T47)', async () => {
    const first = await render(<ResetPasswordScreen />);
    expect(screen.getByText(authCopy.resetLinkInvalidTitle)).toBeOnTheScreen();
    await first.unmount();

    mockAuth = { status: 'authenticated', session: {} };
    await render(<ResetPasswordScreen />);
    expect(screen.getByLabelText('New password')).toBeOnTheScreen();
  });

  test('a fragment otp_expired error shows the invalid state even with a session (SPEC-001-T47, SPEC-001-T58)', async () => {
    mockAuth = { status: 'authenticated', session: {} };
    mockUrl = 'sharecropr://reset-password#error=access_denied&error_code=otp_expired';
    await render(<ResetPasswordScreen />);
    await act(async () => {});
    expect(screen.getByText(authCopy.resetLinkInvalidTitle)).toBeOnTheScreen();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });
});
