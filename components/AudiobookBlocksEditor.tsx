'use client';

import { useEffect, useMemo, useState } from 'react';
import { debounce } from 'lodash';

type AudiobookBlock = {
  id: string;
  text: string;
  audioSegmentId?: string | null;
  audioText?: string | null;
};

type AudiobookDoc = {
  version: 1;
  blocks: AudiobookBlock[];
};

function makeId() {
  // Browser-safe id generator.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `b_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeDoc(input: unknown): AudiobookDoc {
  const fallback: AudiobookDoc = {
    version: 1,
    blocks: [{ id: makeId(), text: '' }],
  };

  if (!input || typeof input !== 'object') return fallback;
  const obj = input as { blocks?: unknown };
  if (!Array.isArray(obj.blocks)) return fallback;

  const blocks: AudiobookBlock[] = obj.blocks
    .map((b): AudiobookBlock | null => {
      if (!b || typeof b !== 'object') return null;
      const bb = b as { id?: unknown; text?: unknown; audioSegmentId?: unknown; audioText?: unknown };
      const id = typeof bb.id === 'string' && bb.id.trim() ? bb.id : makeId();
      const text = typeof bb.text === 'string' ? bb.text : '';
      const audioSegmentId = typeof bb.audioSegmentId === 'string' ? bb.audioSegmentId : null;
      const audioText = typeof bb.audioText === 'string' ? bb.audioText : null;
      return { id, text, audioSegmentId, audioText };
    })
    .filter((x): x is AudiobookBlock => Boolean(x));

  return {
    version: 1,
    blocks: blocks.length ? blocks : fallback.blocks,
  };
}

export default function AudiobookBlocksEditor({
  docId,
  initialDoc,
}: {
  docId: string;
  initialDoc: unknown;
}) {
  const [doc, setDoc] = useState<AudiobookDoc>(() => normalizeDoc(initialDoc));
  const [busyBlockId, setBusyBlockId] = useState<string | null>(null);
  const [blockError, setBlockError] = useState<Record<string, string | null>>({});

  const saveDocDebounced = useMemo(() => {
    return debounce(async (next: AudiobookDoc) => {
      try {
        await fetch('/api/audiobooks/doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: docId, content: next }),
        });
      } catch {
        // ignore
      }
    }, 600);
  }, [docId]);

  useEffect(() => {
    return () => {
      saveDocDebounced.cancel();
    };
  }, [saveDocDebounced]);

  const updateDoc = (fn: (prev: AudiobookDoc) => AudiobookDoc) => {
    setDoc((prev) => {
      const next = fn(prev);
      saveDocDebounced(next);
      return next;
    });
  };

  const addBlockAfter = (afterId?: string) => {
    const newBlock: AudiobookBlock = { id: makeId(), text: '' };
    updateDoc((prev) => {
      if (!afterId) return { ...prev, blocks: [...prev.blocks, newBlock] };
      const idx = prev.blocks.findIndex((b) => b.id === afterId);
      if (idx === -1) return { ...prev, blocks: [...prev.blocks, newBlock] };
      const nextBlocks = [...prev.blocks.slice(0, idx + 1), newBlock, ...prev.blocks.slice(idx + 1)];
      return { ...prev, blocks: nextBlocks };
    });
  };

  const deleteBlock = async (blockId: string) => {
    const block = doc.blocks.find((b) => b.id === blockId);
    const segId = block?.audioSegmentId;

    updateDoc((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== blockId) }));
    setBlockError((prev) => {
      const next = { ...prev };
      delete next[blockId];
      return next;
    });

    // Best-effort cleanup of audio.
    if (segId) {
      try {
        await fetch(`/api/audiobooks/segments/${segId}`, { method: 'DELETE' });
      } catch {
        // ignore
      }
    }
  };

  const setText = (blockId: string, text: string) => {
    updateDoc((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, text } : b)),
    }));
  };

  const clearAudio = async (blockId: string) => {
    const block = doc.blocks.find((b) => b.id === blockId);
    const segId = block?.audioSegmentId;
    if (!segId) return;

    setBusyBlockId(blockId);
    setBlockError((p) => ({ ...p, [blockId]: null }));
    try {
      const res = await fetch(`/api/audiobooks/segments/${segId}`, { method: 'DELETE' });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to delete audio');

      updateDoc((prev) => ({
        ...prev,
        blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, audioSegmentId: null, audioText: null } : b)),
      }));
    } catch (e: unknown) {
      const msg =
        (typeof (e as { message?: unknown })?.message === 'string' && (e as { message: string }).message) ||
        'Failed to delete audio';
      setBlockError((p) => ({ ...p, [blockId]: msg }));
    } finally {
      setBusyBlockId(null);
    }
  };

  const generateAudioForBlock = async (blockId: string) => {
    const block = doc.blocks.find((b) => b.id === blockId);
    if (!block) return;
    const text = block.text.trim();
    if (!text) {
      setBlockError((p) => ({ ...p, [blockId]: 'Write some text first.' }));
      return;
    }

    setBusyBlockId(blockId);
    setBlockError((p) => ({ ...p, [blockId]: null }));

    try {
      // If regenerating, delete previous audio first (best-effort).
      if (block.audioSegmentId) {
        try {
          await fetch(`/api/audiobooks/segments/${block.audioSegmentId}`, { method: 'DELETE' });
        } catch {
          // ignore
        }
      }

      const res = await fetch('/api/audiobooks/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, text }),
      });

      const data = (await res.json()) as { segmentId?: string; error?: string };
      if (!res.ok || !data.segmentId) {
        throw new Error(data.error || 'Failed to generate audio');
      }

      updateDoc((prev) => ({
        ...prev,
        blocks: prev.blocks.map((b) =>
          b.id === blockId
            ? { ...b, audioSegmentId: data.segmentId!, audioText: text }
            : b
        ),
      }));
    } catch (e: unknown) {
      const msg =
        (typeof (e as { message?: unknown })?.message === 'string' && (e as { message: string }).message) ||
        'Failed to generate audio';
      setBlockError((p) => ({ ...p, [blockId]: msg }));
    } finally {
      setBusyBlockId(null);
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-sm text-zinc-400">Notebook blocks: each block can generate its own audio.</div>
        <button
          type="button"
          onClick={() => addBlockAfter()}
          className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          Add block
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {doc.blocks.map((b, i) => {
          const isBusy = busyBlockId === b.id;
          const err = blockError[b.id];
          const hasAudio = Boolean(b.audioSegmentId);
          const audioIsStale = hasAudio && (b.audioText ?? '').trim() !== b.text.trim();

          return (
            <div key={b.id} className="rounded-lg border border-zinc-800 bg-zinc-950">
              <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
                <div className="text-xs text-zinc-500">Block {i + 1}</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => addBlockAfter(b.id)}
                    className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
                  >
                    + Below
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteBlock(b.id)}
                    className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="p-3">
                <textarea
                  value={b.text}
                  onChange={(e) => setText(b.id, e.target.value)}
                  placeholder="Write or paste text…"
                  rows={6}
                  className="w-full resize-y rounded border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
                />

                <div className="mt-3 flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void generateAudioForBlock(b.id)}
                    className="w-full rounded-md border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-100 bg-zinc-950/40 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isBusy ? 'Generating…' : hasAudio ? 'Regenerate audio' : 'Generate audio'}
                  </button>

                  {err && (
                    <div className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">{err}</div>
                  )}

                  {hasAudio && (
                    <div className="rounded border border-zinc-800 bg-black px-3 py-3">
                      <div className="text-xs text-zinc-500 mb-2">Audio</div>
                      {audioIsStale && (
                        <div className="mb-2 text-xs text-amber-300">
                          The text changed since this audio was generated.
                        </div>
                      )}
                      <audio controls preload="none" src={`/api/audiobooks/audio/${b.audioSegmentId}`} className="w-full" />
                      <div className="mt-3">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void clearAudio(b.id)}
                          className="w-full rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Delete audio
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* bottom spacing for mobile */}
      <div className="h-[calc(env(safe-area-inset-bottom)+1rem)]" aria-hidden="true" />
    </div>
  );
}
