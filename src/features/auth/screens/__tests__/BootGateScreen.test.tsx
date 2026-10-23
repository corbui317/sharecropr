import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { DeletionStatusResult } from '@/features/auth/lib/auth-service';
import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

import { BootGateScreen } from '../BootGateScreen';

// SPEC-001-T46 (and the component slice of T37): the boot gate waits for THIS user's deletion status.

const mockRedirects: unknown[] = [];
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Redirect: ({ href }: { href: unknown }) => {
      mockRedirects.push(href);
      return null;
    },
    router: { replace: jest.fn(), push: jest.fn() },
    useLocalSearchParams: jest.fn(() => ({})),
  };
});

type AuthState = {
  status: string;
  session: object | null;
  user: { id: string } | null;
  isEmailVerified: boolean;
};
let mockAuth: AuthState = { status: 'loading', session: null, user: null, isEmailVerified: false };
jest.mock('@/features/auth/hooks/useAuthSession', () => ({ useAuthSession: () => mockAuth }));
jest.mock('@/features/auth/lib/auth-service', () => ({
  getDeletionStatus: jest.fn(),
  signOut: jest.fn(() => Promise.resolve()),
}));
const mockGet = jest.requireMock<{ getDeletionStatus: jest.Mock<() => Promise<DeletionStatusResult>> }>(
  '@/features/auth/lib/auth-service',
).getDeletionStatus;

function defer<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const signedIn = (verified: boolean): AuthState => ({
  status: 'authenticated',
  session: {},
  user: { id: 'u1' },
  isEmailVerified: verified,
});

beforeEach(() => {
  mockRedirects.length = 0;
  mockGet.mockReset();
  mockAuth = { status: 'loading', session: null, user: null, isEmailVerified: false };
});

describe('BootGateScreen', () => {
  test("session arriving after the first render waits for this user's status, then restores, never via /map (SPEC-001-T46, SPEC-001-T37)", async () => {
    const d = defer<DeletionStatusResult>();
    mockGet.mockReturnValueOnce(d.promise);
    const { rerender } = await render(<BootGateScreen />);
    mockAuth = signedIn(true);
    await rerender(<BootGateScreen />);
    expect(mockRedirects).toHaveLength(0);
    await act(async () => {
      d.resolve({ ok: true, status: { pending: true } });
    });
    expect(mockRedirects).toContain(routes.restoreAccount);
    expect(mockRedirects).not.toContain(routes.map);
  });

  test.each([
    [true, routes.map],
    [false, routes.verifyEmail],
  ])('not pending -> redirect by verification (verified=%s) (SPEC-001-T46)', async (verified, href) => {
    mockAuth = signedIn(verified);
    mockGet.mockResolvedValueOnce({ ok: true, status: { pending: false } });
    await render(<BootGateScreen />);
    await act(async () => {});
    expect(mockRedirects).toEqual([href]);
  });

  test('server error -> retry screen, not a spinner; Try again refetches and proceeds (SPEC-001-T46)', async () => {
    mockAuth = signedIn(true);
    mockGet.mockResolvedValueOnce({ ok: false, reason: 'error' });
    await render(<BootGateScreen />);
    await act(async () => {});
    expect(screen.getByText('Try again')).toBeOnTheScreen();
    mockGet.mockResolvedValueOnce({ ok: true, status: { pending: false } });
    await fireEvent.press(screen.getByText('Try again'));
    await act(async () => {});
    expect(mockRedirects).toContain(routes.map);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test('unreachable -> opens normally (SPEC-001-T46)', async () => {
    mockAuth = signedIn(true);
    mockGet.mockResolvedValueOnce({ ok: false, reason: 'unreachable' });
    await render(<BootGateScreen />);
    await act(async () => {});
    expect(mockRedirects).toEqual([routes.map]);
  });

  test('no session -> /sign-in, no status fetch (SPEC-001-T46)', async () => {
    mockAuth = { status: 'unauthenticated', session: null, user: null, isEmailVerified: false };
    await render(<BootGateScreen />);
    expect(mockRedirects).toEqual([routes.signIn]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('status error: a failed Sign out shows inline copy and stays (SPEC-001-T55)', async () => {
    mockAuth = signedIn(true);
    mockGet.mockResolvedValueOnce({ ok: false, reason: 'error' });
    const auth = jest.requireMock<{ signOut: jest.Mock<() => Promise<void>> }>(
      '@/features/auth/lib/auth-service',
    );
    auth.signOut.mockRejectedValueOnce(new Error('x'));
    await render(<BootGateScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByText('Sign out'));
    await act(async () => {});
    expect(screen.getByText(authCopy.signOutFailed)).toBeOnTheScreen();
    const nav = jest.requireMock<{ router: { replace: jest.Mock } }>('expo-router').router;
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
