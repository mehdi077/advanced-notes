'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';
import { SendableParagraph, registerSendCallback, unregisterSendCallback } from '@/lib/sendable-paragraph';
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

  const sentEditor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    content: { type: 'doc', content: [] },
    editable: false,
  });

  const writingEditor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ paragraph: false }),
      SendableParagraph,
    ],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editable: true,
    onUpdate: ({ editor }) => {
      onWritingUpdate(editor.getJSON());
    },
  });

  // Sync sentContent prop into editor once available after initial load
  useEffect(() => {
    if (!sentEditor || sentInitialized.current) return;
    if (sentContent) {
      sentEditor.commands.setContent(sentContent);
      sentInitialized.current = true;
    }
  }, [sentEditor, sentContent]);

  // Sync writingContent prop into editor once available after initial load
  useEffect(() => {
    if (!writingEditor || writingInitialized.current) return;
    if (writingContent) {
      writingEditor.commands.setContent(writingContent);
      writingInitialized.current = true;
    }
  }, [writingEditor, writingContent]);

  // Register the send callback in the module-level registry keyed by writingEditor
  useEffect(() => {
    if (!writingEditor || !sentEditor) return;

    registerSendCallback(writingEditor, async (text: string) => {
      try {
        const res = await authFetch('/api/openclaw-webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) return false;

        const currentJson = sentEditor.getJSON();
        const existing = Array.isArray(currentJson.content) ? currentJson.content : [];
        const updated = {
          type: 'doc',
          content: [...existing, { type: 'paragraph', content: [{ type: 'text', text }] }],
        };
        sentEditor.commands.setContent(updated);
        onSentUpdate(updated);
        return true;
      } catch {
        return false;
      }
    });

    return () => {
      unregisterSendCallback(writingEditor);
    };
  }, [writingEditor, sentEditor, onSentUpdate]);

  return (
    <div className="journal-container">
      {/* Sent area — read-only, faded */}
      <div
        className="journal-sent-area"
        style={{ opacity: 0.5, pointerEvents: 'none', userSelect: 'none' }}
      >
        <EditorContent editor={sentEditor} className="journal-editor-content" />
      </div>

      {/* Separator — indented, doesn't touch edges */}
      <div className="journal-separator" aria-hidden="true">
        <div className="journal-separator-line" />
      </div>

      {/* Writing area — editable */}
      <div className="journal-writing-area">
        <EditorContent editor={writingEditor} className="journal-editor-content" />
      </div>
    </div>
  );
}
