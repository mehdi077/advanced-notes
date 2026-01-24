import { Node, mergeAttributes } from '@tiptap/core';

export interface AudioClipOptions {
  HTMLAttributes: Record<string, string>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    audioClip: {
      insertAudioClip: (segmentId: string) => ReturnType;
    };
  }
}

export const AudioClip = Node.create<AudioClipOptions>({
  name: 'audioClip',

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
      segmentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-segment-id'),
        renderHTML: attributes => {
          if (!attributes.segmentId) return {};
          return { 'data-segment-id': String(attributes.segmentId) };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-audio-clip]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-audio-clip': 'true',
        class:
          'audio-clip-node inline-flex items-center justify-center w-6 h-6 ml-1 bg-zinc-900 border border-zinc-700 rounded cursor-pointer hover:bg-zinc-800 hover:border-zinc-600 transition-colors align-middle select-none',
      }),
      ['span', { class: 'text-zinc-200 text-[11px] leading-none' }, '▶'],
    ];
  },

  addCommands() {
    return {
      insertAudioClip:
        (segmentId: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { segmentId },
          });
        },
    };
  },
});
