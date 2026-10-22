import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

import { DeleteAccountScreen } from '../DeleteAccountScreen';

// SPEC-001-T53: one deletion intent sends one idempotency key, however many times it is retried.

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
}));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: jest.fn(() => `k${++n}`) };
});
jest.mock('@/features/auth/lib/auth-service', () => ({ requestAccountDeletion: jest.fn() }));

const mockRouter = jest.requireMock<{ router: { replace: jest.Mock } }>('expo-router').router;
const svc = jest.requireMock<{ requestAccountDeletion: jest.Mock<(a: unknown) => Promise<unknown>> }>(
  '@/features/auth/lib/auth-service',
);

async function typeDeleteAndPress() {
  await fireEvent.changeText(screen.getByLabelText(authCopy.deleteTypePrompt), 'delete');
  await fireEvent.press(screen.getByText(authCopy.deleteConfirm));
  await act(async () => {});
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DeleteAccountScreen', () => {
  test('a retried deletion sends the same key (SPEC-001-T53)', async () => {
    svc.requestAccountDeletion
      .mockResolvedValueOnce({ error: { message: 'FetchError: Network request failed' } })
      .mockResolvedValueOnce({ data: {}, error: null });
    await render(<DeleteAccountScreen />);
    await typeDeleteAndPress();
    await typeDeleteAndPress();
    const [first, second] = svc.requestAccountDeletion.mock.calls;
    expect(first?.[0]).toEqual({ idempotencyKey: expect.stringMatching(/^k\d+$/) });
    expect(second?.[0]).toEqual(first?.[0]);
    expect(mockRouter.replace).toHaveBeenCalledWith(routes.restoreAccount);
  });

  test('a new visit is a new intent (SPEC-001-T53)', async () => {
    svc.requestAccountDeletion.mockResolvedValue({ error: { message: 'x' } });
    const first = await render(<DeleteAccountScreen />);
    await typeDeleteAndPress();
    await first.unmount();
    await render(<DeleteAccountScreen />);
    await typeDeleteAndPress();
    const [a, b] = svc.requestAccountDeletion.mock.calls;
    expect((b?.[0] as { idempotencyKey: string }).idempotencyKey).not.toBe(
      (a?.[0] as { idempotencyKey: string }).idempotencyKey,
    );
  });
});
