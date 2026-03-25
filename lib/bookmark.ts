import { Node, mergeAttributes } from '@tiptap/core';

export interface BookmarkOptions {
  HTMLAttributes: Record<string, string>;
}

export type BookmarkAttrs = {
  id: string;
  name: string;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookmark: {
      insertBookmark: (attrs: BookmarkAttrs) => ReturnType;
    };
  }
}

function decodeAttr(raw: string | null): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function encodeAttr(raw: unknown): string {
  try {
    return encodeURIComponent(String(raw ?? ''));
  } catch {
    return String(raw ?? '');
  }
}

export const Bookmark = Node.create<BookmarkOptions>({
  name: 'bookmark',

  group: 'inline',
  inline: true,
  atom: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-bookmark-id') ?? '',
        renderHTML: (attrs) => (attrs.id ? { 'data-bookmark-id': String(attrs.id) } : {}),
      },
      name: {
        default: '',
        parseHTML: (element) => decodeAttr(element.getAttribute('data-bookmark-name')),
        renderHTML: (attrs) => ({ 'data-bookmark-name': encodeAttr(attrs.name) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-bookmark-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const name = decodeAttr((HTMLAttributes as Record<string, string>)['data-bookmark-name'] ?? '');
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-bookmark': 'true',
        class: 'bookmark-mark',
        title: name ? `Tag: ${name}` : 'Tag',
      }),
      ['span', { class: 'bookmark-hash' }, '#'],
      ['span', { class: 'bookmark-name' }, name || 'tag'],
    ];
  },

  addCommands() {
    return {
      insertBookmark:
        (attrs: BookmarkAttrs) =>
        ({ commands }) => {
          const id = String(attrs?.id ?? '').trim();
          const name = String(attrs?.name ?? '').trim();
          if (!id || !name) return false;
          return commands.insertContent({ type: this.name, attrs: { id, name } });
        },
    };
  },
});
