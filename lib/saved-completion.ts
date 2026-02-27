import { Node, mergeAttributes } from '@tiptap/core';

export interface SavedCompletionOptions {
  HTMLAttributes: Record<string, string>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    savedCompletion: {
      insertSavedCompletion: (content: string) => ReturnType;
    };
  }
}

export const SavedCompletion = Node.create<SavedCompletionOptions>({
  name: 'savedCompletion',

  group: 'inline',

  inline: true,

  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: element => {
          const data = element.getAttribute('data-content');
          if (data === null) return '';
          return decodeURIComponent(data);
        },
        renderHTML: attributes => {
          if (attributes.content === null || attributes.content === undefined) return {};
          return {
            'data-content': encodeURIComponent(String(attributes.content)),
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-saved-completion]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      'data-saved-completion': 'true',
      class: 'saved-completion-mark inline-flex items-center justify-center w-4 h-4 bg-zinc-800 border border-zinc-600 rounded cursor-pointer hover:bg-zinc-700 hover:border-zinc-500 transition-colors flex-shrink-0',
    }), ['span', { class: 'text-amber-400 text-[10px] leading-none' }, '★']];
  },

  addCommands() {
    return {
      insertSavedCompletion:
        (content: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { content },
          });
        },
    };
  },
});
