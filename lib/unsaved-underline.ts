import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from 'prosemirror-model';

import { useSaveSyncStore } from '@/lib/stores/save-sync-store';
import { useUnlockStore } from '@/lib/stores/unlock-store';

export const UnsavedUnderlinePluginKey = new PluginKey('anUnsavedUnderline');

function shouldShowUnsavedUnderline(): boolean {
  const unlockToken = useUnlockStore.getState().unlockToken;
  const { editSeq, lastSavedEditSeq, lastError } = useSaveSyncStore.getState();
  if (editSeq === lastSavedEditSeq) return false;

  const locked = !unlockToken || lastError?.status === 401;
  const offline =
    typeof navigator !== 'undefined' &&
    (navigator.onLine === false ||
      Boolean(
        lastError &&
          !lastError.status &&
          /failed to fetch|network|offline|load failed/i.test(lastError.message),
      ));

  return locked || offline;
}

function buildDecorations(state: EditorState): DecorationSet {
  if (!shouldShowUnsavedUnderline()) return DecorationSet.empty;

  const { lastSavedDocJson } = useSaveSyncStore.getState();
  if (!lastSavedDocJson) return DecorationSet.empty;

  let savedDoc: PMNode;
  try {
    const json = lastSavedDocJson as Parameters<typeof state.schema.nodeFromJSON>[0];
    savedDoc = state.schema.nodeFromJSON(json);
  } catch {
    return DecorationSet.empty;
  }

  const currentDoc = state.doc;
  const start = savedDoc.content.findDiffStart(currentDoc.content, 0);
  if (start == null) return DecorationSet.empty;

  const end = savedDoc.content.findDiffEnd(currentDoc.content, savedDoc.content.size, currentDoc.content.size);
  const to = Math.max(start, Math.min(currentDoc.content.size, end?.b ?? currentDoc.content.size));
  if (to <= start) return DecorationSet.empty;

  const decos: Decoration[] = [];
  currentDoc.nodesBetween(start, to, (node: PMNode, pos: number) => {
    if (!node.isText || typeof node.text !== 'string' || node.text.length === 0) return;

    const nodeFrom = Math.max(start, pos);
    const nodeTo = Math.min(to, pos + node.nodeSize);
    if (nodeTo <= nodeFrom) return;

    const localStart = nodeFrom - pos;
    const localEnd = nodeTo - pos;
    const slice = node.text.slice(localStart, localEnd);

    const re = /[\p{L}\p{N}]+/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(slice))) {
      const a = nodeFrom + m.index;
      const b = a + m[0].length;
      if (b > a) decos.push(Decoration.inline(a, b, { class: 'an-unsaved-underline' }));
    }
  });

  if (!decos.length) return DecorationSet.empty;
  return DecorationSet.create(currentDoc, decos);
}

export const UnsavedUnderline = Extension.create({
  name: 'unsavedUnderline',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: UnsavedUnderlinePluginKey,
        state: {
          init: (_, state) => buildDecorations(state),
          apply: (tr, prev: DecorationSet, _oldState, newState) => {
            const meta = tr.getMeta(UnsavedUnderlinePluginKey) as { recompute?: boolean } | undefined;
            if (tr.docChanged || meta?.recompute) return buildDecorations(newState);
            return prev;
          },
        },
        props: {
          decorations(state) {
            return UnsavedUnderlinePluginKey.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});
