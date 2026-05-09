import { create } from 'zustand';

const STORAGE_KEY = 'advanced-notes.unlockToken';

type UnlockState = {
  unlockToken: string | null;
  setUnlockToken: (token: string | null) => void;
  clearUnlockToken: () => void;
};

function readStoredUnlockToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredUnlockToken(token: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Some browsers can block localStorage; the in-memory token still works.
  }
}

export const useUnlockStore = create<UnlockState>((set) => ({
  unlockToken: readStoredUnlockToken(),
  setUnlockToken: (token) => {
    writeStoredUnlockToken(token);
    set({ unlockToken: token });
  },
  clearUnlockToken: () => {
    writeStoredUnlockToken(null);
    set({ unlockToken: null });
  },
}));
