import { create } from 'zustand';

type FollowModeState = {
  following: boolean;
  setFollowing: (following: boolean) => void;
};

export const useFollowModeStore = create<FollowModeState>((set) => ({
  following: true,
  setFollowing: (following) => set({ following }),
}));
