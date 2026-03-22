'use client';

import { useRef, useState, useEffect, useMemo } from 'react';
import { debounce } from 'lodash';
import TiptapEditor from '../components/TiptapEditor';
import VoiceChat from '../components/VoiceChat';
import { ArrowDown, MessageSquare } from 'lucide-react';
import { useVoiceStore } from '@/lib/stores/useVoiceStore';
import { authFetch } from '@/lib/auth-fetch';
import SaveSyncIndicator from '@/components/SaveSyncIndicator';
import { useSaveSyncStore } from '@/lib/stores/save-sync-store';
import { extractLastWordFromTiptapJSON } from '@/lib/tiptap-text';
import { clearDraft, getDraft, setDraft } from '@/lib/draft-storage';
import { useUnlockStore } from '@/lib/stores/unlock-store';

const DOC_ID = 'infinite-doc-v1';

export default function Home() {
  const [content, setContent] = useState<object | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { setIsModalOpen } = useVoiceStore();
  const unlockToken = useUnlockStore(s => s.unlockToken);
  const latestContentRef = useRef<object | null>(null);

  useEffect(() => {
    useSaveSyncStore.getState().setDocId(DOC_ID);
  }, []);

  useEffect(() => {
    // Load from API on mount
    async function loadDoc() {
      try {
        const draftPromise = getDraft(DOC_ID).catch(() => null);

        const res = await authFetch(`/api/doc?id=${DOC_ID}`);
        const draft = await draftPromise;

        if (res.ok) {
          const serverDoc = (await res.json()) as object | null;
          const serverContent = serverDoc ?? null;

          useSaveSyncStore.getState().hydrateFromServer({
            doc: serverContent,
            lastSavedWord: extractLastWordFromTiptapJSON(serverContent),
          });

          const draftContent = draft?.content ?? null;
          const hasDraft = Boolean(draftContent);
          const same =
            hasDraft &&
            serverContent &&
            safeJsonStringify(serverContent) === safeJsonStringify(draftContent);

          if (same) {
            await clearDraft(DOC_ID).catch(() => {
              // ignore
            });
          }

          const initial = hasDraft && !same ? (draftContent as object) : serverContent;
          setContent(initial);
          latestContentRef.current = initial;

          if (hasDraft && !same) {
            useSaveSyncStore.getState().markEdited();
          }
        } else {
          const msg = await res.text().catch(() => '');
          useSaveSyncStore.getState().setError({
            message: msg || res.statusText || 'Failed to load document',
            status: res.status,
          });

          if (draft?.content) {
            setContent(draft.content);
            latestContentRef.current = draft.content;
            useSaveSyncStore.getState().markEdited();
          }
        }
      } catch (e) {
        console.error('Failed to load doc', e);
        useSaveSyncStore.getState().setError({
          message: e instanceof Error ? e.message : String(e),
        });

        const draft = await getDraft(DOC_ID).catch(() => null);
        if (draft?.content) {
          setContent(draft.content);
          latestContentRef.current = draft.content;
          useSaveSyncStore.getState().markEdited();
        }
      } finally {
        setIsLoading(false);
      }
    }
    loadDoc();
  }, []);

  const persistDraft = useMemo(() => {
    return debounce(async (newContent: object) => {
      await setDraft(DOC_ID, newContent).catch(() => {
        // ignore
      });
    }, 250);
  }, []);

  // Debounced save function
  const saveContent = useMemo(() => {
    return debounce(async (newContent: object) => {
      const editSeq = useSaveSyncStore.getState().editSeq;
      useSaveSyncStore.getState().saveStarted();
      try {
        const res = await authFetch('/api/doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: DOC_ID, content: newContent }),
        });
        if (!res.ok) {
          const msg = await res.text().catch(() => '');
          useSaveSyncStore.getState().saveFailed({
            message: msg || res.statusText || 'Save failed',
            status: res.status,
          });
          return;
        }

        useSaveSyncStore.getState().saveSucceeded({
          editSeq,
          lastSavedWord: extractLastWordFromTiptapJSON(newContent),
          doc: newContent,
        });

        await clearDraft(DOC_ID).catch(() => {
          // ignore
        });
      } catch (e) {
        console.error('Failed to save doc', e);
        useSaveSyncStore.getState().saveFailed({
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      saveContent.cancel();
      persistDraft.cancel();
    };
  }, [saveContent, persistDraft]);

  const handleUpdate = (newContent: object) => {
    useSaveSyncStore.getState().markEdited();
    latestContentRef.current = newContent;
    persistDraft(newContent);
    saveContent(newContent);
  };

  const tryImmediateSave = useMemo(() => {
    return async () => {
      const s = useSaveSyncStore.getState();
      if (s.inFlightCount > 0) return;
      if (s.editSeq === s.lastSavedEditSeq) return;
      if (!latestContentRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (!useUnlockStore.getState().unlockToken) return;

      const contentToSave = latestContentRef.current;
      const editSeq = useSaveSyncStore.getState().editSeq;
      useSaveSyncStore.getState().saveStarted();

      try {
        const res = await authFetch('/api/doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: DOC_ID, content: contentToSave }),
        });

        if (!res.ok) {
          const msg = await res.text().catch(() => '');
          useSaveSyncStore.getState().saveFailed({
            message: msg || res.statusText || 'Save failed',
            status: res.status,
          });
          return;
        }

        useSaveSyncStore.getState().saveSucceeded({
          editSeq,
          lastSavedWord: extractLastWordFromTiptapJSON(contentToSave),
          doc: contentToSave,
        });

        await clearDraft(DOC_ID).catch(() => {
          // ignore
        });
      } catch (e) {
        useSaveSyncStore.getState().saveFailed({
          message: e instanceof Error ? e.message : String(e),
        });
      }
    };
  }, []);

  useEffect(() => {
    if (!unlockToken) return;
    void tryImmediateSave();
  }, [unlockToken, tryImmediateSave]);

  useEffect(() => {
    const onOnline = () => {
      void tryImmediateSave();
    };
    const onFocus = () => {
      void tryImmediateSave();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tryImmediateSave();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tryImmediateSave]);

  const scrollToBottom = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth',
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-black text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <main className="min-h-screen w-full bg-black text-white relative">
      <SaveSyncIndicator />
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-4">
          <h1 className="text-2xl text-gray-400">Infinite Document</h1>
          <button
            type="button"
            onClick={scrollToBottom}
            className="inline-flex items-center gap-2 self-start rounded border border-zinc-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <ArrowDown size={16} />
            Scroll to end
          </button>
        </div>
        <TiptapEditor initialContent={content} onContentUpdate={handleUpdate} />
      </div>

      {/* Floating Voice Button - positioned above editor content */}
      <button
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] right-6 md:bottom-8 md:right-8 w-14 h-14 md:w-16 md:h-16 rounded-full bg-purple-600 hover:bg-purple-700 shadow-lg transition-colors z-[35] flex items-center justify-center"
        title="Open Chat"
      >
        <MessageSquare size={24} className="text-white" />
      </button>

      {/* Voice Chat Modal */}
      <VoiceChat />
    </main>
  );
}

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}
