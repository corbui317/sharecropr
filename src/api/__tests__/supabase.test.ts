import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { refreshSessionSingleFlight, startAutoRefresh, stopAutoRefresh } from '../supabase';

// SPEC-001-T18 (unit, R24): src/api exposes the lifecycle calls the boot hook drives (SCRUM-62),
// and concurrent refreshes collapse into one request.

type MockAuth = {
  startAutoRefresh: jest.Mock<() => Promise<void>>;
  stopAutoRefresh: jest.Mock<() => Promise<void>>;
  refreshSession: jest.Mock<() => Promise<{ data: { session: null } }>>;
};

jest.mock('@supabase/supabase-js', () => {
  const auth = {
    startAutoRefresh: jest.fn(() => Promise.resolve()),
    stopAutoRefresh: jest.fn(() => Promise.resolve()),
    refreshSession: jest.fn(() => Promise.resolve({ data: { session: null } })),
  };
  return { createClient: () => ({ auth }), __auth: auth };
});

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
