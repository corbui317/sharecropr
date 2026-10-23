import { create } from 'zustand';

import {
  followReducer,
  INITIAL_FOLLOW_STATE,
  type FollowEffect,
  type FollowEvent,
  type FollowState,
} from '@/features/map/lib/followMode';

type FollowModeStore = FollowState & {
  /** Applies the event through the pure reducer and returns the side effect the caller must run. */
  dispatch: (event: FollowEvent) => FollowEffect;
};

export const useFollowModeStore = create<FollowModeStore>((set, get) => ({
  ...INITIAL_FOLLOW_STATE,
  dispatch: (event) => {
    const { following, gestureActive } = get();
    const current: FollowState = { following, gestureActive };
    const { state, effect } = followReducer(current, event);
    if (state !== current) set(state);
    return effect;
  },
}));
