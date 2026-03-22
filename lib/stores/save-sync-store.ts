import { create } from 'zustand';

export type SaveSyncError = {
  atMs: number;
  message: string;
  status?: number;
};

type SaveSyncState = {
  docId: string | null;

  editSeq: number;
  lastEditAtMs: number | null;
  lastSavedEditSeq: number;

  inFlightCount: number;
  lastAttemptAtMs: number | null;
  lastSavedAtMs: number | null;
  lastSavedWord: string | null;
  lastSavedDocJson: object | null;
  lastError: SaveSyncError | null;

  setDocId: (docId: string) => void;
  markEdited: () => void;
  hydrateFromServer: (opts: { doc?: object | null; lastSavedWord?: string | null } | null) => void;
  saveStarted: () => void;
  saveSucceeded: (opts: { editSeq: number; lastSavedWord: string | null; doc: object }) => void;
  saveFailed: (opts: { message: string; status?: number }) => void;
  setError: (opts: { message: string; status?: number }) => void;
};

export const useSaveSyncStore = create<SaveSyncState>((set) => ({
  docId: null,

  editSeq: 0,
  lastEditAtMs: null,
  lastSavedEditSeq: 0,

  inFlightCount: 0,
  lastAttemptAtMs: null,
  lastSavedAtMs: null,
  lastSavedWord: null,
  lastSavedDocJson: null,
  lastError: null,

  setDocId: (docId) => set({ docId }),

  markEdited: () => {
    set(s => ({
      editSeq: s.editSeq + 1,
      lastEditAtMs: Date.now(),
    }));
  },

  hydrateFromServer: (opts) => {
    set(s => ({
      lastSavedEditSeq: s.editSeq,
      lastSavedAtMs: Date.now(),
      lastSavedWord: opts?.lastSavedWord ?? s.lastSavedWord,
      lastSavedDocJson: opts?.doc ?? s.lastSavedDocJson,
      lastError: null,
    }));
  },

  saveStarted: () => {
    const now = Date.now();
    set(s => ({
      inFlightCount: s.inFlightCount + 1,
      lastAttemptAtMs: now,
      // keep any previous error visible until we either succeed or a new error replaces it
      lastSavedEditSeq: s.lastSavedEditSeq,
    }));
  },

  saveSucceeded: ({ editSeq, lastSavedWord, doc }) => {
    const now = Date.now();
    set(s => {
      const nextInFlight = Math.max(0, s.inFlightCount - 1);
      const lastSavedEditSeq = Math.max(s.lastSavedEditSeq, editSeq);
      return {
        inFlightCount: nextInFlight,
        lastSavedAtMs: now,
        lastSavedWord,
        lastSavedDocJson: doc,
        lastSavedEditSeq,
        lastError: null,
      };
    });
  },

  saveFailed: ({ message, status }) => {
    const now = Date.now();
    set(s => ({
      inFlightCount: Math.max(0, s.inFlightCount - 1),
      lastError: { atMs: now, message, status },
    }));
  },

  setError: ({ message, status }) => {
    const now = Date.now();
    set({ lastError: { atMs: now, message, status } });
  },
}));

export function selectIsDirty(s: Pick<SaveSyncState, 'editSeq' | 'lastSavedEditSeq'>) {
  return s.editSeq !== s.lastSavedEditSeq;
}
