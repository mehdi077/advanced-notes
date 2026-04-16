'use client';

import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';

export type SendCallback = (text: string) => Promise<boolean>;

// Module-level registry: keyed by editor instance so multiple editors don't conflict
const callbackRegistry = new WeakMap<Editor, SendCallback>();

export function registerSendCallback(editor: Editor, cb: SendCallback): void {
  callbackRegistry.set(editor, cb);
}

export function unregisterSendCallback(editor: Editor): void {
  callbackRegistry.delete(editor);
}

function SendableParagraphView({ node, editor, deleteNode }: NodeViewProps) {
  const [isSending, setIsSending] = useState(false);
  const text = node.textContent.trim();

  const handleSend = async () => {
    if (!text || isSending) return;
    const cb = callbackRegistry.get(editor);
    if (!cb) return;
    setIsSending(true);
    try {
      const success = await cb(text);
      if (success) deleteNode();
    } finally {
      setIsSending(false);
    }
  };

  return (
    <NodeViewWrapper as="div" className="relative group paragraph-send-wrapper">
      <NodeViewContent as="div" />
      {text ? (
        <button
          type="button"
          contentEditable={false}
          onClick={handleSend}
          disabled={isSending}
          className="send-para-btn"
          title="Send to OpenClaw"
        >
          {isSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        </button>
      ) : null}
    </NodeViewWrapper>
  );
}

export const SendableParagraph = Node.create({
  name: 'paragraph',
  priority: 1000,

  group: 'block',
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'p' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SendableParagraphView);
  },
});
