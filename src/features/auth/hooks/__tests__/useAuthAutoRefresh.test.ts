import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { startAutoRefresh, stopAutoRefresh } from '@/api/supabase';
import { useAuthAutoRefresh } from '@/features/auth/hooks/useAuthAutoRefresh';

// SPEC-001-T18 (unit, R24): AppState drives GoTrue auto-refresh — start on `active`, stop otherwise.
// The listener is this boot hook, not src/api (SCRUM-62; AGENTS.md Invariant 11).

jest.mock('@/api/supabase', () => ({
  startAutoRefresh: jest.fn(() => Promise.resolve()),
  stopAutoRefresh: jest.fn(() => Promise.resolve()),
}));

const start = jest.mocked(startAutoRefresh);
const stop = jest.mocked(stopAutoRefresh);
const remove = jest.fn();
let listener: ((state: AppStateStatus) => void) | undefined;

function setCurrentState(state: AppStateStatus) {
  // The RN jest preset mocks currentState as a jest.fn, not a string.
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true, writable: true });
}

function emit(state: AppStateStatus) {
  if (!listener) throw new Error('useAuthAutoRefresh did not subscribe to AppState "change"');
  listener(state);
}

describe('useAuthAutoRefresh', () => {
  beforeEach(() => {
    listener = undefined;
    start.mockClear();
    stop.mockClear();
    remove.mockClear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
      if (type === 'change') listener = handler;
      return { remove };
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('boots active: starts auto-refresh and subscribes to "change" (SPEC-001-T18)', async () => {
    setCurrentState('active');
    await renderHook(() => useAuthAutoRefresh());
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  test('boots in background: stops auto-refresh (SPEC-001-T18)', async () => {
    setCurrentState('background');
    await renderHook(() => useAuthAutoRefresh());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  test('boots unknown/inactive: leaves the SDK ticker alone (SPEC-001-T18)', async () => {
    setCurrentState('unknown');
    await renderHook(() => useAuthAutoRefresh());
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  test.each<AppStateStatus>(['background', 'inactive'])(
    'transition to %s calls stopAutoRefresh (SPEC-001-T18)',
    async (next) => {
      setCurrentState('active');
      await renderHook(() => useAuthAutoRefresh());
      start.mockClear();
      emit(next);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(start).not.toHaveBeenCalled();
    },
  );

  test('returning to active calls startAutoRefresh (SPEC-001-T18)', async () => {
    setCurrentState('active');
    await renderHook(() => useAuthAutoRefresh());
    emit('background');
    start.mockClear();
    emit('active');
    expect(start).toHaveBeenCalledTimes(1);
  });

  test('unmount removes the listener exactly once (SPEC-001-T18)', async () => {
    setCurrentState('active');
    const { unmount } = await renderHook(() => useAuthAutoRefresh());
    expect(remove).not.toHaveBeenCalled();
    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
