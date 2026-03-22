export type DraftRecord = {
  docId: string;
  content: object;
  updatedAtMs: number;
};

const DB_NAME = 'anDrafts';
const DB_VERSION = 1;
const STORE = 'drafts';

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'docId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function getDraft(docId: string): Promise<DraftRecord | null> {
  if (!hasIndexedDb()) return null;
  const db = await openDb();
  try {
    return await new Promise<DraftRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.get(docId);
      req.onsuccess = () => {
        const v = req.result as DraftRecord | undefined;
        resolve(v ?? null);
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to read draft'));
    });
  } finally {
    db.close();
  }
}

export async function setDraft(docId: string, content: object): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put({ docId, content, updatedAtMs: Date.now() } satisfies DraftRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to write draft'));
      tx.onabort = () => reject(tx.error ?? new Error('Failed to write draft'));
    });
  } finally {
    db.close();
  }
}

export async function clearDraft(docId: string): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.delete(docId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to clear draft'));
      tx.onabort = () => reject(tx.error ?? new Error('Failed to clear draft'));
    });
  } finally {
    db.close();
  }
}
