import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { SecuritySettingsScreen } from '../SecuritySettingsScreen';

// SPEC-001-T53: retrying one email change reuses the key; editing the address mints a new one.

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
}));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: jest.fn(() => `k${++n}`) };
});
jest.mock('@/features/auth/hooks/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'u1', email: 'a@b.org' } }),
}));
jest.mock('@/features/auth/lib/auth-service', () => ({
  requestEmailChange: jest.fn(),
  updatePassword: jest.fn(),
}));

const svc = jest.requireMock<{
  requestEmailChange: jest.Mock<(email: string, key: string) => Promise<unknown>>;
}>('@/features/auth/lib/auth-service');

beforeEach(() => {
  jest.clearAllMocks();
});

async function press() {
  await fireEvent.press(screen.getByText('Request change'));
  await act(async () => {});
}

describe('SecuritySettingsScreen', () => {
  test('retrying one email change reuses the key; editing the address mints a new one (SPEC-001-T53)', async () => {
    svc.requestEmailChange.mockResolvedValue({ error: { message: 'network' } });
    await render(<SecuritySettingsScreen />);
    await fireEvent.changeText(screen.getByLabelText('New email'), 'one@example.org');
    await press();
    await press();
    const [first, second] = svc.requestEmailChange.mock.calls;
    expect(second?.[1]).toBe(first?.[1]);

    await fireEvent.changeText(screen.getByLabelText('New email'), 'two@example.org');
    await press();
    const third = svc.requestEmailChange.mock.calls[2];
    expect(third?.[1]).not.toBe(first?.[1]);
  });
});
