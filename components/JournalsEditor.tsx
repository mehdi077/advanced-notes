'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';

export const SENT_DOC_ID = 'openclaw-journals-sent';
export const WRITING_DOC_ID = 'openclaw-journals-writing';

interface JournalsEditorProps {
  sentContent: object | null;
  writingContent: object | null;
  onSentUpdate: (content: object) => void;
  onWritingUpdate: (content: object) => void;
}

export default function JournalsEditor({
  sentContent,
  writingContent,
  onSentUpdate,
  onWritingUpdate,
}: JournalsEditorProps) {
  const sentInitialized = useRef(false);
  const writingInitialized = useRef(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Tracked as state so button re-enables correctly after content changes
  const [hasContent, setHasContent] = useState(false);

  // Ref so the Ctrl+Enter listener always calls the latest version
  const handleSendRef = useRef<() => Promise<void>>(async () => {});

  const sentEditor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    content: { type: 'doc', content: [] },
    editable: false,
  });

  const writingEditor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editable: true,
    onUpdate: ({ editor }) => {
      onWritingUpdate(editor.getJSON());
      setHasContent(editor.getText().trim().length > 0);
    },
  });

  useEffect(() => {
    if (!sentEditor || sentInitialized.current) return;
    if (sentContent) {
      sentEditor.commands.setContent(sentContent);
      sentInitialized.current = true;
    }
  }, [sentEditor, sentContent]);

  useEffect(() => {
    if (!writingEditor || writingInitialized.current) return;
    if (writingContent) {
      writingEditor.commands.setContent(writingContent);
      setHasContent(writingEditor.getText().trim().length > 0);
      writingInitialized.current = true;
    }
  }, [writingEditor, writingContent]);

  const handleSend = useCallback(async () => {
    if (!writingEditor || !sentEditor || isSending) return;
    const text = writingEditor.getText({ blockSeparator: '\n' }).trim();
    if (!text) return;

    setSendError(null);
    setIsSending(true);
    try {
      const res = await authFetch('/api/openclaw-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        setSendError(msg || 'Send failed');
        return;
      }

      // Move all writing nodes to sent editor
      const writingJson = writingEditor.getJSON();
      const newNodes = Array.isArray(writingJson.content) ? writingJson.content : [];
      const sentJson = sentEditor.getJSON();
      const existing = Array.isArray(sentJson.content) ? sentJson.content : [];
      const updated = { type: 'doc', content: [...existing, ...newNodes] };
      sentEditor.commands.setContent(updated);
      onSentUpdate(updated);

      // Clear writing area
      const empty = { type: 'doc', content: [{ type: 'paragraph' }] };
      writingEditor.commands.setContent(empty);
      onWritingUpdate(empty);
      setHasContent(false);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setIsSending(false);
    }
  }, [writingEditor, sentEditor, isSending, onSentUpdate, onWritingUpdate]);

  // Keep ref in sync so keyboard listener is never stale
  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  // Ctrl+Enter keyboard shortcut (desktop)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        void handleSendRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="journal-container">
      {/* Sent area — read-only, faded */}
      <div
        className="journal-sent-area"
        style={{ opacity: 0.5, pointerEvents: 'none', userSelect: 'none' }}
      >
        <EditorContent editor={sentEditor} className="journal-editor-content" />
      </div>

      {/* Separator with send button on the right */}
      <div className="journal-separator">
        <div className="journal-separator-line" />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={isSending || !hasContent}
          className="journal-send-btn"
          title="Send to OpenClaw (Ctrl+Enter)"
        >
          {isSending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          <span>{isSending ? 'Sending…' : 'Send'}</span>
        </button>
      </div>

      {sendError && (
        <p className="text-xs text-red-400 mb-2 px-1">{sendError}</p>
      )}

      {/* Writing area — editable */}
      <div className="journal-writing-area">
        <EditorContent editor={writingEditor} className="journal-editor-content" />
      </div>
    </div>
  );
}
