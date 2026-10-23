/** Follow-mode transitions — SPEC-008 §5.1 (R04–R07), mobile-architecture §4.2. Pure: no React, no renderer. */
export const FOLLOW_ANIMATION_MS = 200; // R07
export type FollowState = Readonly<{ following: boolean; gestureActive: boolean }>;
export const INITIAL_FOLLOW_STATE: FollowState = { following: true, gestureActive: false };
export type FollowEvent =
  | { type: 'gestureStart' }
  | { type: 'gestureEnd' }
  | { type: 'locationFix' }
  | { type: 'recenter'; hasFix: boolean };
export type FollowEffect = 'none' | 'animateToUser';
export type FollowTransition = { state: FollowState; effect: FollowEffect };

const next = (s: FollowState, following: boolean, gestureActive: boolean): FollowState =>
  s.following === following && s.gestureActive === gestureActive ? s : { following, gestureActive };

export function followReducer(state: FollowState, event: FollowEvent): FollowTransition {
  switch (event.type) {
    case 'gestureStart': // R04: cleared at gesture START
      return { state: next(state, false, true), effect: 'none' };
    case 'gestureEnd':
      return { state: next(state, false, false), effect: 'none' };
    case 'locationFix': // R07; no camera move mid-gesture
      return { state, effect: state.following && !state.gestureActive ? 'animateToUser' : 'none' };
    case 'recenter': // a button tap: no finger is on the map, so it also clears a gesture whose end never arrived
      return { state: next(state, true, false), effect: event.hasFix ? 'animateToUser' : 'none' }; // R06
    default: {
      const _never: never = event;
      return _never;
    }
  }
}
