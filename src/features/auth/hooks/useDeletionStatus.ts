import { useCallback, useEffect, useState } from 'react';

import { getDeletionStatus, type DeletionStatus } from '@/features/auth/lib/auth-service';
import { TIMED_OUT, withTimeout } from '@/features/auth/lib/with-timeout';

export const DELETION_STATUS_TIMEOUT_MS = 8000;

export type DeletionStatusState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; status: DeletionStatus }
  | { kind: 'unreachable' }
  | { kind: 'error' };

const IDLE = { kind: 'idle' } as const;
const LOADING = { kind: 'loading' } as const;

/**
 * Deletion status for ONE user (SPEC-001 R47, T46). The result is keyed on (userId, attempt) and
 * derived during render, so a render for a new user can never see the previous user's, or the
 * signed-out, answer. Resetting state in an effect is too late: a child <Redirect> navigates in its
 * own effect, which React runs before the parent's.
 */
export function useDeletionStatus(userId: string | null): {
  state: DeletionStatusState;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{
    userId: string;
    attempt: number;
    state: DeletionStatusState;
  } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void withTimeout(getDeletionStatus(), DELETION_STATUS_TIMEOUT_MS)
      .then(
        (res): DeletionStatusState =>
          res === TIMED_OUT
            ? { kind: 'unreachable' }
            : res.ok
              ? { kind: 'ready', status: res.status }
              : { kind: res.reason },
        (): DeletionStatusState => ({ kind: 'error' }),
      )
      .then((state) => {
        if (active) setSettled({ userId, attempt, state });
      });
    return () => {
      active = false;
    };
  }, [userId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!userId) return { state: IDLE, retry };
  if (!settled || settled.userId !== userId || settled.attempt !== attempt) {
    return { state: LOADING, retry };
  }
  return { state: settled.state, retry };
}
