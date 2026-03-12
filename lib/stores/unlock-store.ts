import { create } from 'zustand';

type UnlockState = {
  unlockToken: string | null;
  setUnlockToken: (token: string | null) => void;
  clearUnlockToken: () => void;
};

export const useUnlockStore = create<UnlockState>((set) => ({
  unlockToken: null,
  setUnlockToken: (token) => set({ unlockToken: token }),
  clearUnlockToken: () => set({ unlockToken: null }),
}));
