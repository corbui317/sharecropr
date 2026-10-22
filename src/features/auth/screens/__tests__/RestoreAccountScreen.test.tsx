import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

import { RestoreAccountScreen } from '../RestoreAccountScreen';

// SPEC-001-T46 (retry, no blank screen), T51 (restore navigates only on success), T53 (same key on retry).

jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Redirect: () => null,
    router: { replace: jest.fn(), push: jest.fn() },
    useLocalSearchParams: jest.fn(() => ({})),
  };
});
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: jest.fn(() => `k${++n}`) };
});
jest.mock('@/features/auth/hooks/useAuthSession', () => ({
  useAuthSession: () => ({
    status: 'authenticated',
    session: {},
    user: { id: 'u1' },
    isEmailVerified: true,
  }),
}));
jest.mock('@/features/auth/lib/auth-service', () => ({
  getDeletionStatus: jest.fn(),
  cancelAccountDeletion: jest.fn(),
  signOut: jest.fn(() => Promise.resolve()),
}));

type Fn = jest.Mock<(...a: unknown[]) => Promise<unknown>>;
const svc = jest.requireMock<{ getDeletionStatus: Fn; cancelAccountDeletion: Fn }>(
  '@/features/auth/lib/auth-service',
);
const mockRouter = jest.requireMock<{ router: { replace: jest.Mock } }>('expo-router').router;

beforeEach(() => {
  jest.clearAllMocks();
  svc.getDeletionStatus.mockResolvedValue({
    ok: true,
    status: { pending: true, requested_at: '2026-10-01T00:00:00Z', scheduled_at: '2026-10-31T00:00:00Z' },
  });
});

async function renderPending() {
  await render(<RestoreAccountScreen />);
  await act(async () => {});
}

describe('RestoreAccountScreen', () => {
  test('status error renders an actionable retry, not a blank screen (SPEC-001-T46)', async () => {
    svc.getDeletionStatus.mockResolvedValueOnce({ ok: false, reason: 'error' });
    await renderPending();
    expect(screen.getByText(authCopy.tryAgain)).toBeOnTheScreen();
    expect(screen.getByText(authCopy.accountStatusTitle)).toBeOnTheScreen();
  });

  test('cancel failure keeps the screen and shows the error; no navigation (SPEC-001-T51)', async () => {
    svc.cancelAccountDeletion.mockResolvedValueOnce({ ok: false, reason: 'failed' });
    await renderPending();
    await fireEvent.press(screen.getByText(authCopy.restoreKeep));
    await act(async () => {});
    expect(screen.getByText(authCopy.restoreFailed)).toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('retrying the restore sends the same idempotency key (SPEC-001-T53)', async () => {
    svc.cancelAccountDeletion
      .mockResolvedValueOnce({ ok: false, reason: 'failed' })
      .mockResolvedValueOnce({ ok: true });
    await renderPending();
    await fireEvent.press(screen.getByText(authCopy.restoreKeep));
    await act(async () => {});
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText(authCopy.restoreKeep));
    await act(async () => {});
    const [first, second] = svc.cancelAccountDeletion.mock.calls;
    expect(first?.[0]).toMatch(/^k\d+$/);
    expect(second?.[0]).toBe(first?.[0]);
    expect(mockRouter.replace).toHaveBeenCalledWith(routes.map);
  });

  test('invalid_transition shows the grace-elapsed state (SPEC-001-T51)', async () => {
    svc.cancelAccountDeletion.mockResolvedValueOnce({ ok: false, reason: 'grace_elapsed' });
    await renderPending();
    await fireEvent.press(screen.getByText(authCopy.restoreKeep));
    await act(async () => {});
    expect(screen.getByText(authCopy.graceElapsed)).toBeOnTheScreen();
  });

  test('success navigates to the map (SPEC-001-T51)', async () => {
    svc.cancelAccountDeletion.mockResolvedValueOnce({ ok: true });
    await renderPending();
    await fireEvent.press(screen.getByText(authCopy.restoreKeep));
    await act(async () => {});
    expect(mockRouter.replace).toHaveBeenCalledWith(routes.map);
  });
});
