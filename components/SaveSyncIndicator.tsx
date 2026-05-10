'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSaveSyncStore, selectIsDirty } from '@/lib/stores/save-sync-store';
import { useUnlockStore } from '@/lib/stores/unlock-store';

type Kind = 'saved' | 'saving' | 'unsaved' | 'error' | 'offline' | 'locked';

export default function SaveSyncIndicator() {
  const unlockToken = useUnlockStore(s => s.unlockToken);
  const clearUnlockToken = useUnlockStore(s => s.clearUnlockToken);
  const docId = useSaveSyncStore(s => s.docId);
  const inFlightCount = useSaveSyncStore(s => s.inFlightCount);
  const lastSavedAtMs = useSaveSyncStore(s => s.lastSavedAtMs);
  const lastSavedWord = useSaveSyncStore(s => s.lastSavedWord);
  const lastError = useSaveSyncStore(s => s.lastError);
  const isDirty = useSaveSyncStore(s => selectIsDirty(s));
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  });

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const kind: Kind = useMemo(() => {
    if (!unlockToken) return 'locked';
    if (!isOnline) return 'offline';
    if (inFlightCount > 0) return 'saving';
    if (isDirty && lastError && (!lastSavedAtMs || lastError.atMs > lastSavedAtMs)) return 'error';
    if (isDirty) return 'unsaved';
    return 'saved';
  }, [unlockToken, isOnline, inFlightCount, isDirty, lastError, lastSavedAtMs]);

  const label = useMemo(() => {
    if (!docId) return '…';
    switch (kind) {
      case 'locked':
        return 'Locked';
      case 'offline':
        return 'Offline';
      case 'saving':
        return 'Saving…';
      case 'error':
        return 'Not saving';
      case 'unsaved':
        return 'Unsaved';
      case 'saved':
        return 'Saved';
    }
  }, [docId, kind]);

  const dotClass = useMemo(() => {
    switch (kind) {
      case 'saved':
        return 'bg-emerald-400';
      case 'saving':
        return 'bg-sky-400';
      case 'unsaved':
        return 'bg-amber-400';
      case 'offline':
      case 'locked':
      case 'error':
        return 'bg-rose-400';
    }
  }, [kind]);

  const title = useMemo(() => {
    const pieces: string[] = [];
    if (docId) pieces.push(`doc: ${docId}`);
    if (lastSavedAtMs) pieces.push(`last saved: ${new Date(lastSavedAtMs).toLocaleString()}`);
    if (lastSavedWord) pieces.push(`last word: ${lastSavedWord}`);
    if (lastError) {
      const status = lastError.status ? ` (${lastError.status})` : '';
      pieces.push(`last error${status}: ${lastError.message}`);
    }
    return pieces.join('\n');
  }, [docId, lastError, lastSavedAtMs, lastSavedWord]);

  return (
    <div
      className="fixed top-[calc(env(safe-area-inset-top)+0.5rem)] right-[calc(env(safe-area-inset-right)+0.5rem)] z-[2147483647]"
      aria-live="polite"
      aria-label="Save status"
    >
      <div
        className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[11px] text-zinc-200 backdrop-blur-sm"
        title={title}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        <span className="whitespace-nowrap">{label}</span>
        {kind === 'locked' && (
          <button
            type="button"
            onClick={clearUnlockToken}
            className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-zinc-100 transition-colors hover:bg-white/20"
          >
            Reconnect
          </button>
        )}
        {lastSavedWord && (kind === 'saved' || kind === 'unsaved' || kind === 'saving') && (
          <span className="ml-1 whitespace-nowrap rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-zinc-100">
            {lastSavedWord}
          </span>
        )}
      </div>
    </div>
  );
}
