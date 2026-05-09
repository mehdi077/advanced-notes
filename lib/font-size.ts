import { Extension } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

function getTextStyleAttrs(mark: Mark | undefined): Record<string, unknown> {
  return mark ? { ...(mark.attrs as Record<string, unknown>) } : {};
}

function hasMeaningfulAttrs(attrs: Record<string, unknown>): boolean {
  return Object.values(attrs).some(value => value !== null && value !== undefined && value !== '');
}

function updateFontSize(size: string | null, { state, dispatch }: CommandProps): boolean {
  const type = state.schema.marks.textStyle;
  if (!type) return false;

  const { selection } = state;
  const tr = state.tr;

  if (selection.empty) {
    const marks = state.storedMarks ?? selection.$from.marks();
    const existing = marks.find(mark => mark.type === type);
    const attrs = getTextStyleAttrs(existing);
    attrs.fontSize = size;

    if (hasMeaningfulAttrs(attrs)) {
      tr.addStoredMark(type.create(attrs));
    } else if (existing) {
      tr.removeStoredMark(type);
    }

    if (dispatch) dispatch(tr);
    return true;
  }

  for (const range of selection.ranges) {
    const from = range.$from.pos;
    const to = range.$to.pos;

    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return;

      const markStart = Math.max(pos, from);
      const markEnd = Math.min(pos + node.nodeSize, to);
      const existing = node.marks.find(mark => mark.type === type);
      const attrs = getTextStyleAttrs(existing);
      attrs.fontSize = size;

      tr.removeMark(markStart, markEnd, type);
      if (hasMeaningfulAttrs(attrs)) {
        tr.addMark(markStart, markEnd, type.create(attrs));
      }
    });
  }

  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}

export const FontSize = Extension.create({
  name: 'fontSize',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => {
              const raw = (element as HTMLElement).style?.fontSize;
              return raw || null;
            },
            renderHTML: (attributes) => {
              const fontSize = attributes.fontSize as string | null | undefined;
              if (!fontSize) return {};
              return { style: `font-size: ${fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        (props) => {
          return updateFontSize(size, props);
        },
      unsetFontSize:
        () =>
        (props) => {
          return updateFontSize(null, props);
        },
    };
  },
});
