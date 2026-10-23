// SPEC-008-T04 (unit, R04, R05) · SPEC-008-T07 (unit, R07) · R06 · SCRUM-25
import { describe, expect, test } from '@jest/globals';

import {
  FOLLOW_ANIMATION_MS,
  followReducer,
  type FollowEvent,
  type FollowState,
} from '@/features/map/lib/followMode';

const s = (following: boolean, gestureActive: boolean): FollowState => ({ following, gestureActive });

describe('followReducer', () => {
  test('gesture start clears follow (SPEC-008-T04, R04)', () => {
    const r = followReducer(s(true, false), { type: 'gestureStart' });
    expect(r.state).toEqual(s(false, true));
    expect(r.effect).toBe('none');
  });

  test('repeated gesture start returns the same object (Android fires twice)', () => {
    const from = s(false, true);
    const r = followReducer(from, { type: 'gestureStart' });
    expect(r.state).toBe(from);
    expect(r.effect).toBe('none');
  });

  test('gesture end keeps follow off', () => {
    const r = followReducer(s(false, true), { type: 'gestureEnd' });
    expect(r.state).toEqual(s(false, false));
    expect(r.effect).toBe('none');
  });

  test('didChange with no prior willChange still clears follow', () => {
    const r = followReducer(s(true, false), { type: 'gestureEnd' });
    expect(r.state).toEqual(s(false, false));
    expect(r.effect).toBe('none');
  });

  test('a fix while following animates (R07)', () => {
    const from = s(true, false);
    const r = followReducer(from, { type: 'locationFix' });
    expect(r.state).toBe(from);
    expect(r.effect).toBe('animateToUser');
  });

  test('a fix while not following moves the avatar only (SPEC-008-T07)', () => {
    const from = s(false, false);
    const r = followReducer(from, { type: 'locationFix' });
    expect(r.state).toBe(from);
    expect(r.effect).toBe('none');
  });

  test.each([s(false, true), s(true, true)])('a fix during a gesture never animates %j (SCRUM-25 AC2)', (from) => {
    const r = followReducer(from, { type: 'locationFix' });
    expect(r.state).toBe(from);
    expect(r.effect).toBe('none');
  });

  test('recentre with a fix animates (R06)', () => {
    const r = followReducer(s(false, false), { type: 'recenter', hasFix: true });
    expect(r.state).toEqual(s(true, false));
    expect(r.effect).toBe('animateToUser');
  });

  test('recentre with no fix follows without animating', () => {
    const r = followReducer(s(false, false), { type: 'recenter', hasFix: false });
    expect(r.state).toEqual(s(true, false));
    expect(r.effect).toBe('none');
  });

  test('recentre clears a stuck gesture whose end never arrived', () => {
    const r = followReducer(s(false, true), { type: 'recenter', hasFix: true });
    expect(r.state).toEqual(s(true, false));
    expect(r.effect).toBe('animateToUser');
  });

  test('exhaustive: animation only ever fires with no gesture active (SCRUM-25 AC2)', () => {
    const states = [s(false, false), s(false, true), s(true, false), s(true, true)];
    const events: FollowEvent[] = [
      { type: 'gestureStart' },
      { type: 'gestureEnd' },
      { type: 'locationFix' },
      { type: 'recenter', hasFix: true },
      { type: 'recenter', hasFix: false },
    ];
    for (const from of states) {
      for (const event of events) {
        const { state, effect } = followReducer(from, event);
        if (effect === 'animateToUser') {
          expect(state.gestureActive).toBe(false);
          expect(from.gestureActive === false || event.type === 'recenter').toBe(true);
        }
      }
    }
  });

  test('follow animation lasts 200 ms (R07)', () => {
    expect(FOLLOW_ANIMATION_MS).toBe(200);
  });
});
