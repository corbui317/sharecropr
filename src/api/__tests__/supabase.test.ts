import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  refreshSessionSingleFlight,
  signOutWithLocalFallback,
  startAutoRefresh,
  stopAutoRefresh,
} from '../supabase';

// SPEC-001-T18 (unit, R24): src/api exposes the lifecycle calls the boot hook drives (SCRUM-62),
// and concurrent refreshes collapse into one request.

type MockAuth = {
  startAutoRefresh: jest.Mock<() => Promise<void>>;
  stopAutoRefresh: jest.Mock<() => Promise<void>>;
  refreshSession: jest.Mock<() => Promise<{ data: { session: null } }>>;
  signOut: jest.Mock<(o?: { scope?: string }) => Promise<{ error: unknown }>>;
};

jest.mock('@supabase/supabase-js', () => {
  const auth = {
    startAutoRefresh: jest.fn(() => Promise.resolve()),
    stopAutoRefresh: jest.fn(() => Promise.resolve()),
    refreshSession: jest.fn(() => Promise.resolve({ data: { session: null } })),
    signOut: jest.fn(() => Promise.resolve({ error: null })),
  };
  return { createClient: () => ({ auth }), __auth: auth };
});

jest.mock('../secure-storage', () => ({
  chunkedSecureStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

const { chunkedSecureStorage: storage } = jest.requireMock<{
  chunkedSecureStorage: { removeItem: jest.Mock };
}>('../secure-storage');
const { __auth: auth } = jest.requireMock<{ __auth: MockAuth }>('@supabase/supabase-js');

describe('src/api/supabase lifecycle seam', () => {
  beforeEach(() => {
    auth.startAutoRefresh.mockClear();
    auth.stopAutoRefresh.mockClear();
    auth.refreshSession.mockClear();
  });

  test('startAutoRefresh delegates to supabase.auth.startAutoRefresh (SPEC-001-T18)', async () => {
    await startAutoRefresh();
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  test('stopAutoRefresh delegates to supabase.auth.stopAutoRefresh (SPEC-001-T18)', async () => {
    await stopAutoRefresh();
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });

  test('two concurrent refreshes make one refreshSession call (SPEC-001-T18)', async () => {
    await Promise.all([refreshSessionSingleFlight(), refreshSessionSingleFlight()]);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });
});

describe('signOutWithLocalFallback', () => {
  beforeEach(() => {
    auth.signOut.mockReset();
    auth.signOut.mockResolvedValue({ error: null });
    storage.removeItem.mockClear();
  });

  test('global sign-out succeeds: no local purge (SPEC-001-T19)', async () => {
    const res = await signOutWithLocalFallback();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(res).toEqual({ remoteRevoked: true });
  });

  test('global sign-out fails (offline, expired token): purges the stored session, then signs out locally (SPEC-001-T19)', async () => {
    auth.signOut.mockResolvedValueOnce({
      error: { name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 },
    });
    const res = await signOutWithLocalFallback();
    expect(storage.removeItem).toHaveBeenCalledWith('sc.auth.session');
    expect(auth.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    expect(storage.removeItem.mock.invocationCallOrder[0]).toBeLessThan(
      auth.signOut.mock.invocationCallOrder[1] as number,
    );
    expect(res).toEqual({ remoteRevoked: false });
  });

  test('global sign-out throws: same purge + local fallback (SPEC-001-T19)', async () => {
    auth.signOut.mockRejectedValueOnce(new Error('boom'));
    const res = await signOutWithLocalFallback();
    expect(storage.removeItem).toHaveBeenCalledWith('sc.auth.session');
    expect(auth.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    expect(res).toEqual({ remoteRevoked: false });
  });
});
