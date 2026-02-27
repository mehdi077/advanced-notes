import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
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
        ({ chain }) => {
          return chain().setMark('textStyle', { fontSize: size }).run();
        },
      unsetFontSize:
        () =>
        ({ chain }) => {
          const c = chain().setMark('textStyle', { fontSize: null });
          // removeEmptyTextStyle is provided by the TextStyle extension.
          const maybeRemoveEmpty = (c as unknown as { removeEmptyTextStyle?: () => typeof c }).removeEmptyTextStyle;
          return (maybeRemoveEmpty ? maybeRemoveEmpty.call(c) : c).run();
        },
    };
  },
});
