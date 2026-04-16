'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { debounce } from 'lodash';
import Link from 'next/link';
import { ArrowDown, ChevronLeft, ChevronRight, Home } from 'lucide-react';
import JournalsEditor, { SENT_DOC_ID, WRITING_DOC_ID } from '@/components/JournalsEditor';
import { authFetch } from '@/lib/auth-fetch';
import SaveSyncIndicator from '@/components/SaveSyncIndicator';
import { useSaveSyncStore } from '@/lib/stores/save-sync-store';
import { useUnlockStore } from '@/lib/stores/unlock-store';
import { getDraft, setDraft, clearDraft } from '@/lib/draft-storage';
import { extractLastWordFromTiptapJSON } from '@/lib/tiptap-text';

function safeJsonStringify(v: unknown): string {
  try { return JSON.stringify(v); } catch { return ''; }
}

export default function OpenclawJournalsPage() {
  const [sentContent, setSentContent] = useState<object | null>(null);
  const [writingContent, setWritingContent] = useState<object | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const latestWritingRef = useRef<object | null>(null);
  const unlockToken = useUnlockStore(s => s.unlockToken);

  // Register journals as active doc for SaveSyncIndicator
  useEffect(() => {
    useSaveSyncStore.getState().setDocId(WRITING_DOC_ID);
  }, []);

  // Load both docs on mount, with draft recovery for writing doc
  useEffect(() => {
    async function load() {
      try {
        const draftPromise = getDraft(WRITING_DOC_ID).catch(() => null);
        const [sentRes, writingRes] = await Promise.all([
          authFetch(`/api/doc?id=${SENT_DOC_ID}`),
          authFetch(`/api/doc?id=${WRITING_DOC_ID}`),
        ]);

        if (sentRes.ok) {
          const data = (await sentRes.json()) as object | null;
          if (data) setSentContent(data);
        }

        const draft = await draftPromise;

        if (writingRes.ok) {
          const serverDoc = (await writingRes.json()) as object | null;

          useSaveSyncStore.getState().hydrateFromServer({
            doc: serverDoc,
            lastSavedWord: extractLastWordFromTiptapJSON(serverDoc),
          });

          const draftContent = draft?.content ?? null;
          const hasDraft = Boolean(draftContent);
          const same =
            hasDraft &&
            serverDoc &&
            safeJsonStringify(serverDoc) === safeJsonStringify(draftContent);

          if (same) await clearDraft(WRITING_DOC_ID).catch(() => {});

          const initial = hasDraft && !same ? (draftContent as object) : serverDoc;
          setWritingContent(initial);
          latestWritingRef.current = initial;

          if (hasDraft && !same) useSaveSyncStore.getState().markEdited();
        } else {
          const msg = await writingRes.text().catch(() => '');
          useSaveSyncStore.getState().setError({
            message: msg || writingRes.statusText || 'Failed to load document',
            status: writingRes.status,
          });
          if (draft?.content) {
            setWritingContent(draft.content);
            latestWritingRef.current = draft.content;
            useSaveSyncStore.getState().markEdited();
          }
        }
      } catch (e) {
        console.error('Failed to load journal docs', e);
        useSaveSyncStore.getState().setError({ message: e instanceof Error ? e.message : String(e) });
        const draft = await getDraft(WRITING_DOC_ID).catch(() => null);
        if (draft?.content) {
          setWritingContent(draft.content);
          latestWritingRef.current = draft.content;
          useSaveSyncStore.getState().markEdited();
        }
      } finally {
        setIsLoading(false);
      }
    }
    void load();
  }, []);

  // Draft persistence (fast, IndexedDB)
  const persistDraft = useMemo(
    () =>
      debounce(async (content: object) => {
        await setDraft(WRITING_DOC_ID, content).catch(() => {});
      }, 250),
    [],
  );

  // Server save for writing doc (with SaveSyncStore tracking)
  const saveWriting = useMemo(
    () =>
      debounce(async (content: object) => {
        const editSeq = useSaveSyncStore.getState().editSeq;
        useSaveSyncStore.getState().saveStarted();
        try {
          const res = await authFetch('/api/doc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: WRITING_DOC_ID, content }),
          });
          if (!res.ok) {
            const msg = await res.text().catch(() => '');
            useSaveSyncStore.getState().saveFailed({ message: msg || res.statusText || 'Save failed', status: res.status });
            return;
          }
          useSaveSyncStore.getState().saveSucceeded({
            editSeq,
            lastSavedWord: extractLastWordFromTiptapJSON(content),
            doc: content,
          });
          await clearDraft(WRITING_DOC_ID).catch(() => {});
        } catch (e) {
          useSaveSyncStore.getState().saveFailed({ message: e instanceof Error ? e.message : String(e) });
        }
      }, 1000),
    [],
  );

  // Simple debounced save for sent doc (no status tracking needed)
  const saveSent = useMemo(
    () =>
      debounce(async (content: object) => {
        await authFetch('/api/doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: SENT_DOC_ID, content }),
        }).catch(console.error);
      }, 500),
    [],
  );

  // Immediate save (runs on unlock/online/focus/visibility — same pattern as home)
  const tryImmediateSave = useCallback(async () => {
    const s = useSaveSyncStore.getState();
    if (s.inFlightCount > 0) return;
    if (s.editSeq === s.lastSavedEditSeq) return;
    if (!latestWritingRef.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (!useUnlockStore.getState().unlockToken) return;

    const content = latestWritingRef.current;
    const editSeq = s.editSeq;
    useSaveSyncStore.getState().saveStarted();
    try {
      const res = await authFetch('/api/doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: WRITING_DOC_ID, content }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        useSaveSyncStore.getState().saveFailed({ message: msg || res.statusText || 'Save failed', status: res.status });
        return;
      }
      useSaveSyncStore.getState().saveSucceeded({
        editSeq,
        lastSavedWord: extractLastWordFromTiptapJSON(content),
        doc: content,
      });
      await clearDraft(WRITING_DOC_ID).catch(() => {});
    } catch (e) {
      useSaveSyncStore.getState().saveFailed({ message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    if (!unlockToken) return;
    void tryImmediateSave();
  }, [unlockToken, tryImmediateSave]);

  useEffect(() => {
    const onOnline = () => void tryImmediateSave();
    const onFocus = () => void tryImmediateSave();
    const onVisibility = () => { if (document.visibilityState === 'visible') void tryImmediateSave(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tryImmediateSave]);

  useEffect(() => {
    return () => {
      persistDraft.cancel();
      saveWriting.cancel();
      saveSent.cancel();
    };
  }, [persistDraft, saveWriting, saveSent]);

  const handleSentUpdate = (content: object) => {
    setSentContent(content);
    saveSent(content);
  };

  const handleWritingUpdate = (content: object) => {
    useSaveSyncStore.getState().markEdited();
    latestWritingRef.current = content;
    persistDraft(content);
    saveWriting(content);
  };

  const scrollToBottom = () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-black text-white flex items-center justify-center">
        Loading…
      </div>
    );
  }

  return (
    <main className="min-h-screen w-full bg-black text-white relative">
      <SaveSyncIndicator />

      {/* Left panel */}
      <div
        className={`fixed top-0 left-0 h-full bg-zinc-900 border-r border-zinc-800 transition-all duration-300 ease-in-out z-[60] ${
          isPanelOpen ? 'w-64' : 'w-0'
        } overflow-hidden`}
      >
        <div className="p-4 flex flex-col gap-5 w-64 h-full overflow-y-auto">
          <h2 className="text-base font-semibold text-zinc-400 border-b border-zinc-700 pb-2">
            Journals
          </h2>

          <div className="flex flex-col gap-2 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
            <span className="text-xs text-zinc-500 uppercase tracking-wide">Navigate</span>
            <Link
              href="/"
              className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded text-white font-medium transition-colors cursor-pointer text-sm"
            >
              <Home size={16} />
              Home
            </Link>
          </div>
        </div>
      </div>

      {/* Panel toggle button */}
      <button
        type="button"
        onClick={() => setIsPanelOpen(o => !o)}
        title="Toggle panel"
        className={`fixed top-8 z-[60] p-2 bg-zinc-800 rounded-r-md text-white transition-all duration-300 cursor-pointer hover:bg-zinc-700 ${
          isPanelOpen ? 'left-64' : 'left-0'
        }`}
      >
        {isPanelOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>

      {/* Mobile overlay */}
      {isPanelOpen && (
        <div
          className="sidebar-overlay md:hidden"
          onClick={() => setIsPanelOpen(false)}
        />
      )}

      <div className="container mx-auto px-4 py-6 md:py-10 max-w-3xl">
        <JournalsEditor
          sentContent={sentContent}
          writingContent={writingContent}
          onSentUpdate={handleSentUpdate}
          onWritingUpdate={handleWritingUpdate}
        />
      </div>

      {/* Scroll to bottom */}
      <button
        type="button"
        onClick={scrollToBottom}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] right-6 md:bottom-8 md:right-8 w-12 h-12 md:w-14 md:h-14 rounded-full bg-zinc-800 hover:bg-zinc-700 shadow-lg transition-colors z-[35] flex items-center justify-center border border-zinc-700"
        title="Scroll to bottom"
      >
        <ArrowDown size={20} className="text-white" />
      </button>
    </main>
  );
}
