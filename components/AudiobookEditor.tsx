'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { debounce } from 'lodash';
import { AudioSegmentMark } from '@/lib/audio-segment-mark';
import { AudioClip } from '@/lib/audio-clip';
import type { Editor } from '@tiptap/core';

interface AudiobookEditorProps {
  docId: string;
  initialContent: object | null;
  onContentUpdate: (content: object) => void;
}

function selectionHasAudioSegment(editor: Editor, from: number, to: number) {
  let has = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    if (node.marks.some(m => m.type.name === 'audioSegment')) {
      has = true;
    }
  });
  return has;
}

function removeSegmentFromEditor(editor: Editor, segmentId: string) {
  const { state } = editor;
  const markType = state.schema.marks.audioSegment;
  const tr = state.tr;

  // Remove highlight mark.
  if (markType) {
    state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      const has = node.marks.some(m => m.type === markType && m.attrs.segmentId === segmentId);
      if (has) {
        tr.removeMark(pos, pos + node.nodeSize, markType);
      }
    });
  }

  // Remove clip nodes (delete from the end to keep positions stable).
  const clipRanges: Array<{ from: number; to: number }> = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'audioClip' && node.attrs.segmentId === segmentId) {
      clipRanges.push({ from: pos, to: pos + node.nodeSize });
    }
  });
  clipRanges.sort((a, b) => b.from - a.from);
  for (const r of clipRanges) tr.delete(r.from, r.to);

  if (tr.docChanged) editor.view.dispatch(tr);
}

export default function AudiobookEditor({ docId, initialContent, onContentUpdate }: AudiobookEditorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const lastSelectionRef = useRef<{ from: number; to: number; text: string } | null>(null);
  const [audioPopup, setAudioPopup] = useState<{ isOpen: boolean; segmentId: string | null }>({
    isOpen: false,
    segmentId: null,
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const canGenerate = Boolean(lastSelectionRef.current?.text);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, AudioSegmentMark, AudioClip],
    content: initialContent || '<p></p>',
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none text-white',
      },
    },
    onUpdate: ({ editor }) => {
      onContentUpdate(editor.getJSON());
    },
  });

  // Track selection for enabling the generate button.
  useEffect(() => {
    if (!editor) return;

    const update = () => {
      const sel = editor.state.selection;
      if (sel.empty) {
        setHasSelection(false);
        return;
      }
      const text = editor.state.doc.textBetween(sel.from, sel.to, '\n');
      const t = text.trim();
      if (t) {
        lastSelectionRef.current = { from: sel.from, to: sel.to, text: t };
        setHasSelection(true);
      } else {
        setHasSelection(false);
      }
    };

    update();
    editor.on('selectionUpdate', update);
    return () => {
      editor.off('selectionUpdate', update);
    };
  }, [editor]);

  // Handle clicks on audio clip markers.
  useEffect(() => {
    if (!editor) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const marker = target.closest('[data-audio-clip]');
      if (!marker) return;
      e.preventDefault();
      const id = marker.getAttribute('data-segment-id');
      if (id) {
        setAudioPopup({ isOpen: true, segmentId: id });
      }
    };

    editor.view.dom.addEventListener('click', handleClick);
    return () => {
      editor.view.dom.removeEventListener('click', handleClick);
    };
  }, [editor]);

  const generateAudio = async () => {
    if (!editor || isGenerating) return;
    const sel = editor.state.selection;
    const fallback = lastSelectionRef.current;
    const from = sel.empty ? fallback?.from : sel.from;
    const to = sel.empty ? fallback?.to : sel.to;
    const text = sel.empty ? fallback?.text : editor.state.doc.textBetween(sel.from, sel.to, '\n').trim();
    if (typeof from !== 'number' || typeof to !== 'number' || !text) return;

    if (selectionHasAudioSegment(editor, from, to)) {
      setError('Selection already contains generated audio.');
      return;
    }

    setError(null);
    setIsGenerating(true);
    try {
      const res = await fetch('/api/audiobooks/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, text }),
      });

      const data = (await res.json()) as { segmentId?: string; error?: string };
      if (!res.ok || !data.segmentId) {
        throw new Error(data.error || 'Failed to generate audio');
      }

      const segmentId = data.segmentId;

      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setMark('audioSegment', { segmentId })
        .insertContentAt(to, { type: 'audioClip', attrs: { segmentId } })
        .run();
    } catch (e: unknown) {
      const message = (typeof (e as { message?: unknown })?.message === 'string' && (e as { message: string }).message) || 'Failed to generate audio';
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteAudio = async (segmentId: string) => {
    if (!editor) return;

    try {
      const res = await fetch(`/api/audiobooks/segments/${segmentId}`, { method: 'DELETE' });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to delete');

      removeSegmentFromEditor(editor, segmentId);
      setAudioPopup({ isOpen: false, segmentId: null });
    } catch (e: unknown) {
      const message = (typeof (e as { message?: unknown })?.message === 'string' && (e as { message: string }).message) || 'Failed to delete';
      setError(message);
    }
  };

  // Prevent leaking object URLs etc (we only use server URLs, but keep audio stopped on close).
  useEffect(() => {
    if (!audioPopup.isOpen && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [audioPopup.isOpen]);

  // Debounce clearing error when user keeps editing.
  const clearErrorDebounced = useMemo(() => debounce(() => setError(null), 1500), []);
  useEffect(() => {
    if (!editor) return;
    const handler = () => clearErrorDebounced();
    editor.on('update', handler);
    return () => {
      editor.off('update', handler);
      clearErrorDebounced.cancel();
    };
  }, [editor, clearErrorDebounced]);

  if (!editor) {
    return <div className="text-zinc-400">Loading editor…</div>;
  }

  return (
    <div className="w-full relative">
      {/* Desktop helper row */}
      <div className="hidden md:flex items-center justify-between gap-3 mb-3">
        <div className="text-sm text-zinc-400">
          Select text → generate audio. Generated segments are highlighted and get a ▶ marker.
        </div>
        <button
          type="button"
          disabled={!canGenerate || isGenerating}
          onMouseDown={(e) => e.preventDefault()}
          onClick={generateAudio}
          className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
          title={hasSelection ? 'Generate audio for selected text' : canGenerate ? 'Generate audio for last selection' : 'Select some text first'}
        >
          {isGenerating ? 'Generating…' : 'Generate audio'}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div>
      )}

      <div className="audiobook-editor-area rounded border border-zinc-800 bg-black">
        <EditorContent editor={editor} />
      </div>

      {/* Mobile bottom action bar */}
      <div className="md:hidden fixed inset-x-0 bottom-0 z-[60] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 bg-black/70 backdrop-blur border-t border-zinc-800" contentEditable={false}>
        <div className="mx-auto max-w-2xl flex items-center justify-between gap-3">
          <div className="text-xs text-zinc-400">
            {hasSelection ? 'Selection ready' : canGenerate ? 'Last selection ready' : 'Select text to generate audio'}
          </div>
          <button
            type="button"
            disabled={!canGenerate || isGenerating}
            onMouseDown={(e) => e.preventDefault()}
            onClick={generateAudio}
            className="rounded-md border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-100 bg-zinc-950/40 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed min-w-[140px]"
          >
            {isGenerating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Spacer so last lines aren't covered by the mobile bar */}
      <div className="md:hidden h-[calc(env(safe-area-inset-bottom)+4.75rem)]" aria-hidden="true" />

      {audioPopup.isOpen && audioPopup.segmentId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <div className="text-sm text-zinc-200">Audio segment</div>
              <button
                type="button"
                onClick={() => setAudioPopup({ isOpen: false, segmentId: null })}
                className="rounded px-2 py-1 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
              >
                Close
              </button>
            </div>
            <div className="p-4 space-y-3">
              <audio
                ref={audioRef}
                controls
                preload="none"
                src={`/api/audiobooks/audio/${audioPopup.segmentId}`}
                className="w-full"
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-zinc-500 break-all">{audioPopup.segmentId}</div>
                <button
                  type="button"
                  onClick={() => deleteAudio(audioPopup.segmentId!)}
                  className="rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900 w-full sm:w-auto"
                >
                  Delete generation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
