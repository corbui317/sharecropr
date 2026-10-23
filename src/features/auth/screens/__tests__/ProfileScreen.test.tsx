import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

import { ProfileScreen } from '../ProfileScreen';

// SPEC-001-T55: Sign out goes through signOutAndRedirect; a failure stays put and says so.

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('@/features/auth/hooks/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'u1', email: 'a@b.org' } }),
}));
jest.mock('@/features/auth/lib/auth-service', () => ({ signOut: jest.fn() }));

const mockSignOut = jest.requireMock<{ signOut: jest.Mock<() => Promise<void>> }>(
  '@/features/auth/lib/auth-service',
).signOut;
const mockRouter = jest.requireMock<{ router: { replace: jest.Mock } }>('expo-router').router;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProfileScreen', () => {
  test('Sign out replaces to sign-in (SPEC-001-T55)', async () => {
    mockSignOut.mockResolvedValueOnce();
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: authCopy.signOut }));
    await act(async () => {});
    expect(mockRouter.replace).toHaveBeenCalledWith(routes.signIn);
    expect(screen.queryByText(authCopy.signOutFailed)).toBeNull();
  });

  test('a failed sign-out shows inline copy and does not navigate (SPEC-001-T55)', async () => {
    mockSignOut.mockRejectedValueOnce(new Error('x'));
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: authCopy.signOut }));
    await act(async () => {});
    expect(screen.getByText(authCopy.signOutFailed)).toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
