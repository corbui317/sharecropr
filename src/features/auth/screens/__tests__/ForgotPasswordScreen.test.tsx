import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { authCopy } from '@/features/auth/lib/copy';

import { ForgotPasswordScreen } from '../ForgotPasswordScreen';

// SPEC-001-T57 (§8.3, R29, §8.2 Offline, Invariant 10).

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
let mockOffline = false;
jest.mock('@/features/auth/hooks/useIsOffline', () => ({ useIsOffline: () => mockOffline }));
jest.mock('@/features/auth/lib/auth-service', () => ({ requestPasswordReset: jest.fn() }));

const mockReset = jest.requireMock<{
  requestPasswordReset: jest.Mock<(e: string) => Promise<{ error: string | null }>>;
}>('@/features/auth/lib/auth-service').requestPasswordReset;

beforeEach(() => {
  jest.clearAllMocks();
  mockOffline = false;
});

async function submit() {
  await render(<ForgotPasswordScreen />);
  await fireEvent.changeText(screen.getByLabelText('Email'), 'a@b.org');
  await fireEvent.press(screen.getByRole('button', { name: 'Send reset link' }));
  await act(async () => {});
}

describe('ForgotPasswordScreen', () => {
  test('success shows the standard success screen (SPEC-001-T57)', async () => {
    mockReset.mockResolvedValueOnce({ error: null });
    await submit();
    expect(screen.getByText(authCopy.resetSuccess('a@b.org'))).toBeOnTheScreen();
  });

  test.each([
    ['rate_limited'],
    ['unknown'], // stands in for an SMTP 500, which GoTrue raises only for existing accounts
  ])('%s shows the identical success screen, never rate-limit copy (R29) (SPEC-001-T57)', async (code) => {
    mockReset.mockResolvedValueOnce({ error: code });
    await submit();
    expect(screen.getByText(authCopy.resetSuccess('a@b.org'))).toBeOnTheScreen();
    expect(screen.queryByText(authCopy.rateLimitedGeneric)).toBeNull();
    expect(screen.queryByText(authCopy.signInRateLimited)).toBeNull();
  });

  test('network failure shows inline copy, stays on the form, and re-enables the button (SPEC-001-T57)', async () => {
    mockReset.mockResolvedValueOnce({ error: 'network' });
    await submit();
    expect(screen.getByText(authCopy.network)).toBeOnTheScreen();
    expect(screen.queryByText(authCopy.resetSuccess('a@b.org'))).toBeNull();
    expect(screen.getByRole('button', { name: 'Send reset link' }).props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
  });

  test('a rejected call shows network copy and does not spin forever (SPEC-001-T57)', async () => {
    mockReset.mockRejectedValueOnce(new Error('boom'));
    await submit();
    expect(screen.getByText(authCopy.network)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Send reset link' }).props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
  });

  test('offline: banner, submit disabled, nothing sent (SPEC-001-T57)', async () => {
    mockOffline = true;
    await render(<ForgotPasswordScreen />);
    expect(screen.getByText(authCopy.offlineReset)).toBeOnTheScreen();
    const button = screen.getByRole('button', { name: 'Send reset link' });
    expect(button.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.press(button);
    await act(async () => {});
    expect(mockReset).not.toHaveBeenCalled();
  });
});
