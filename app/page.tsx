'use client';

import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { debounce } from 'lodash';
import TiptapEditor from '../components/TiptapEditor';
import VoiceChat from '../components/VoiceChat';
import { ArrowDown, ChevronDown, Plus, Settings2, Trash2, X } from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import SaveSyncIndicator from '@/components/SaveSyncIndicator';
import { useSaveSyncStore } from '@/lib/stores/save-sync-store';
import { extractLastWordFromTiptapJSON } from '@/lib/tiptap-text';
import { clearDraft, getDraft, setDraft } from '@/lib/draft-storage';
import { useUnlockStore } from '@/lib/stores/unlock-store';

// Disable browser scroll restoration at module load time so it doesn't fight
// our auto-jump. Needs to happen before React mounts.
if (typeof window !== 'undefined') history.scrollRestoration = 'manual';

const DOC_ID = 'infinite-doc-v1';
const DEFAULT_JUMP_BUTTON_COLOR = '#3b82f6';

type BookmarkInfo = { id: string; name: string };
type JumpButton = { id: string; label: string; bookmarkId: string | null; color: string; autoJump: boolean };

function extractBookmarksFromDocJson(doc: unknown): BookmarkInfo[] {
  const out: BookmarkInfo[] = [];

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: unknown; attrs?: unknown; content?: unknown };
    if (n.type === 'bookmark') {
      const attrs = (n.attrs ?? {}) as { id?: unknown; name?: unknown };
      const id = typeof attrs.id === 'string' ? attrs.id : '';
      const name = typeof attrs.name === 'string' ? attrs.name : '';
      if (id) out.push({ id, name });
    }
    const children = (n.content ?? null) as unknown;
    if (Array.isArray(children)) {
      for (const c of children) walk(c);
    }
  };

  walk(doc);
  const seen = new Set<string>();
  return out.filter((b) => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

function textColorForBg(hex: string): string {
  if (!isHexColor(hex)) return '#ffffff';
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? '#0b0b0b' : '#ffffff';
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

export default function Home() {
  const [content, setContent] = useState<object | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const unlockToken = useUnlockStore(s => s.unlockToken);
  const latestContentRef = useRef<object | null>(null);

  const [jumpButtons, setJumpButtons] = useState<JumpButton[]>([]);
  const [jumpButtonsError, setJumpButtonsError] = useState<string | null>(null);
  const [availableBookmarks, setAvailableBookmarks] = useState<BookmarkInfo[]>([]);
  const [jumpButtonsVisible, setJumpButtonsVisible] = useState(true);
  const [isJumpButtonModalOpen, setIsJumpButtonModalOpen] = useState(false);
  const [jumpButtonDraft, setJumpButtonDraft] = useState<JumpButton | null>(null);
  const [isJumpButtonDraftNew, setIsJumpButtonDraftNew] = useState(false);

  const refreshAvailableBookmarks = useCallback(() => {
    const doc = (latestContentRef.current ?? content) as unknown;
    setAvailableBookmarks(extractBookmarksFromDocJson(doc));
  }, [content]);

  const loadJumpButtons = useCallback(async () => {
    setJumpButtonsError(null);
    try {
      const res = await authFetch(`/api/nav-buttons?docId=${encodeURIComponent(DOC_ID)}`);
      if (!res.ok) throw new Error((await res.text().catch(() => '')) || res.statusText);
      const data = (await res.json().catch(() => ({}))) as { buttons?: unknown };
      const raw = Array.isArray(data.buttons) ? (data.buttons as unknown[]) : [];
      const next: JumpButton[] = raw
        .map((v) => v as Partial<JumpButton>)
        .filter((b) => typeof b.id === 'string' && typeof b.label === 'string')
        .map((b) => ({
          id: String(b.id),
          label: String(b.label),
          bookmarkId: typeof b.bookmarkId === 'string' ? b.bookmarkId : null,
          color: isHexColor(b.color) ? String(b.color) : DEFAULT_JUMP_BUTTON_COLOR,
          autoJump: b.autoJump === true,
        }));
      setJumpButtons(next);
    } catch (e: unknown) {
      const msg = (typeof (e as { message?: unknown })?.message === 'string' && (e as { message: string }).message) || 'Failed to load jump buttons';
      setJumpButtonsError(msg);
    }
  }, []);

  const saveJumpButtons = useCallback(async (next: JumpButton[]) => {
    setJumpButtons(next);
    setJumpButtonsError(null);
    try {
      const res = await authFetch('/api/nav-buttons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: DOC_ID, buttons: next }),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => '')) || res.statusText);
      const data = (await res.json().catch(() => ({}))) as { buttons?: unknown };
      if (Array.isArray(data.buttons)) {
        setJumpButtons(data.buttons as JumpButton[]);
      }
    } catch (e: unknown) {
      const msg = (typeof (e as { message?: unknown })?.message === 'string' && (e as { message: string }).message) || 'Failed to save jump buttons';
      setJumpButtonsError(msg);
    }
  }, []);

  useEffect(() => {
    void loadJumpButtons();
  }, [loadJumpButtons]);

  useEffect(() => {
    if (isLoading) return;
    const autoBtn = jumpButtons.find(b => b.autoJump && b.bookmarkId);
    if (!autoBtn?.bookmarkId) return;

    const bookmarkId = autoBtn.bookmarkId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;

    const tryScroll = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-bookmark-id="${cssEscape(bookmarkId)}"]`) as HTMLElement | null;
      if (el) {
        const rect = el.getBoundingClientRect();
        const top = window.scrollY + rect.top - window.innerHeight / 2 + rect.height / 2;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        return;
      }
      if (++attempts < 40) timer = setTimeout(tryScroll, 150);
    };

    timer = setTimeout(tryScroll, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isLoading, jumpButtons]);

  const scrollToBookmark = (bookmarkId: string | null) => {
    if (!bookmarkId) return;
    const el = document.querySelector(`[data-bookmark-id="${cssEscape(bookmarkId)}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const openNewJumpButton = () => {
    const doc = (latestContentRef.current ?? content) as unknown;
    const current = extractBookmarksFromDocJson(doc);
    setAvailableBookmarks(current);
    const first = current[0]?.id ?? null;
    setJumpButtonDraft({
      id: makeId(),
      label: `Jump ${jumpButtons.length + 1}`,
      bookmarkId: first,
      color: DEFAULT_JUMP_BUTTON_COLOR,
      autoJump: false,
    });
    setIsJumpButtonDraftNew(true);
    setIsJumpButtonModalOpen(true);
  };

  const openEditJumpButton = (id: string) => {
    refreshAvailableBookmarks();
    const found = jumpButtons.find((b) => b.id === id);
    if (!found) return;
    setJumpButtonDraft({ ...found });
    setIsJumpButtonDraftNew(false);
    setIsJumpButtonModalOpen(true);
  };

  const closeJumpButtonModal = () => {
    setIsJumpButtonModalOpen(false);
    setJumpButtonDraft(null);
    setIsJumpButtonDraftNew(false);
  };

  const saveJumpButtonDraft = async () => {
    if (!jumpButtonDraft) return;
    const label = jumpButtonDraft.label.trim();
    if (!label) return;

    const updated = { ...jumpButtonDraft, label };
    const next = (isJumpButtonDraftNew
      ? [...jumpButtons, updated]
      : jumpButtons.map((b) => (b.id === updated.id ? updated : b))
    ).map((b) => b.id !== updated.id && updated.autoJump ? { ...b, autoJump: false } : b);

    await saveJumpButtons(next);
    closeJumpButtonModal();
  };

  const deleteJumpButtonDraft = async () => {
    if (!jumpButtonDraft) return;
    const next = jumpButtons.filter((b) => b.id !== jumpButtonDraft.id);
    await saveJumpButtons(next);
    closeJumpButtonModal();
  };

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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-3">
          <h1 className="text-2xl text-gray-400">Infinite Document</h1>
          <div className="flex items-center gap-2 self-start">
            <button
              type="button"
              onClick={scrollToBottom}
              className="inline-flex items-center gap-2 rounded border border-zinc-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              <ArrowDown size={16} />
              Scroll to end
            </button>
            <button
              type="button"
              onClick={openNewJumpButton}
              className="inline-flex items-center justify-center rounded border border-zinc-700 w-10 h-10 text-gray-300 transition-colors hover:bg-zinc-800 hover:text-white"
              title="Add jump button"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>

        {jumpButtons.length === 0 && jumpButtonsError && (
          <div className="mb-4 text-xs text-red-300 border border-red-700/40 bg-red-950/20 rounded px-3 py-2">
            {jumpButtonsError}
          </div>
        )}

        {/* Jump buttons (scrollable) */}
        {jumpButtons.length > 0 && (
          <div className="mb-4">
            {/* Toggle */}
            <button
              type="button"
              onClick={() => setJumpButtonsVisible(v => !v)}
              className="mb-1.5 inline-flex w-1/2 items-center justify-center gap-1.5 rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <ChevronDown
                size={13}
                className={`transition-transform duration-300 ${jumpButtonsVisible ? 'rotate-0' : '-rotate-90'}`}
              />
              Jump buttons
            </button>
            {/* Animated slide container */}
            <div
              style={{
                display: 'grid',
                gridTemplateRows: jumpButtonsVisible ? '1fr' : '0fr',
                transition: 'grid-template-rows 0.25s ease',
              }}
            >
              <div className="overflow-hidden">
                <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 -mx-1 px-1 pt-0.5">
                  {jumpButtons.map((b) => {
                    const hasTarget = b.bookmarkId && availableBookmarks.some((t) => t.id === b.bookmarkId);
                    const bg = isHexColor(b.color) ? b.color : DEFAULT_JUMP_BUTTON_COLOR;
                    const fg = textColorForBg(bg);
                    return (
                      <div key={b.id} className="shrink-0 inline-flex rounded overflow-hidden border border-zinc-700">
                        <button
                          type="button"
                          onClick={() => scrollToBookmark(b.bookmarkId)}
                          className="px-3 py-2 text-sm font-medium whitespace-nowrap"
                          style={{
                            backgroundColor: bg,
                            color: fg,
                            opacity: hasTarget ? 1 : 0.55,
                          }}
                          title={hasTarget ? `Jump to tag` : 'Tag missing (reconfigure)'}
                        >
                          {b.label}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditJumpButton(b.id)}
                          className="px-2 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-l border-zinc-700 transition-colors"
                          title="Configure"
                        >
                          <Settings2 size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {jumpButtonsError && (
              <div className="mt-2 text-xs text-red-300 border border-red-700/40 bg-red-950/20 rounded px-3 py-2">
                {jumpButtonsError}
              </div>
            )}
          </div>
        )}

        <TiptapEditor initialContent={content} onContentUpdate={handleUpdate} />
      </div>

      {/* Voice Chat Modal */}
      <VoiceChat />

      {/* Jump button config modal */}
      {isJumpButtonModalOpen && jumpButtonDraft && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[120]" onClick={closeJumpButtonModal} />
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                <div className="text-sm text-zinc-200 font-medium">
                  {isJumpButtonDraftNew ? 'Add jump button' : 'Edit jump button'}
                </div>
                <button
                  type="button"
                  onClick={closeJumpButtonModal}
                  className="p-2 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="px-4 py-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-zinc-400">Button label</label>
                  <input
                    value={jumpButtonDraft.label}
                    onChange={(e) => setJumpButtonDraft((d) => (d ? { ...d, label: e.target.value } : d))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                    placeholder="e.g. Intro, Summary, TODOs…"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-zinc-400">Tag</label>
                  <select
                    value={jumpButtonDraft.bookmarkId ?? ''}
                    onChange={(e) =>
                      setJumpButtonDraft((d) => (d ? { ...d, bookmarkId: e.target.value ? e.target.value : null } : d))
                    }
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                  >
                    <option value="">Select a tag…</option>
                    {availableBookmarks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name || t.id}
                      </option>
                    ))}
                  </select>
                  {availableBookmarks.length === 0 && (
                    <div className="text-[11px] text-zinc-500">
                      No tags yet. Add one from the editor right panel → <span className="font-medium">Tags</span> →{' '}
                      <span className="font-medium">Insert</span>.
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-zinc-400">Color</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={isHexColor(jumpButtonDraft.color) ? jumpButtonDraft.color : DEFAULT_JUMP_BUTTON_COLOR}
                        onChange={(e) => setJumpButtonDraft((d) => (d ? { ...d, color: e.target.value } : d))}
                        className="w-10 h-10 bg-transparent border border-zinc-700 rounded"
                        title="Pick color"
                      />
                      <input
                        value={jumpButtonDraft.color}
                        onChange={(e) => setJumpButtonDraft((d) => (d ? { ...d, color: e.target.value } : d))}
                        className="w-28 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 font-mono"
                        placeholder="#3b82f6"
                      />
                    </div>
                  </div>

                  <div className="flex-1 flex items-end justify-end">
                    <div className="inline-flex rounded overflow-hidden border border-zinc-700">
                      <div
                        className="px-3 py-2 text-sm font-medium"
                        style={{
                          backgroundColor: isHexColor(jumpButtonDraft.color) ? jumpButtonDraft.color : DEFAULT_JUMP_BUTTON_COLOR,
                          color: textColorForBg(isHexColor(jumpButtonDraft.color) ? jumpButtonDraft.color : DEFAULT_JUMP_BUTTON_COLOR),
                        }}
                      >
                        Preview
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-800/40 px-3 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-zinc-200 font-medium">Auto-jump on page start</span>
                    <span className="text-xs text-zinc-500">Scrolls here automatically on every visit</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setJumpButtonDraft((d) => (d ? { ...d, autoJump: !d.autoJump } : d))}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${jumpButtonDraft.autoJump ? 'bg-blue-600' : 'bg-zinc-700'}`}
                    title={jumpButtonDraft.autoJump ? 'Disable auto-jump' : 'Enable auto-jump'}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${jumpButtonDraft.autoJump ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>

              <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => { void deleteJumpButtonDraft(); }}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-red-300 hover:text-red-200 transition-colors"
                  title="Delete this button"
                  disabled={isJumpButtonDraftNew}
                >
                  <Trash2 size={16} />
                  Delete
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeJumpButtonModal}
                    className="px-3 py-2 rounded border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => { void saveJumpButtonDraft(); }}
                    className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                    disabled={!jumpButtonDraft.label.trim()}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
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
