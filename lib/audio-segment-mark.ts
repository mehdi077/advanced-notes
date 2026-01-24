import { Mark, mergeAttributes } from '@tiptap/core';

export interface AudioSegmentMarkOptions {
  HTMLAttributes: Record<string, string>;
}

export const AudioSegmentMark = Mark.create<AudioSegmentMarkOptions>({
  name: 'audioSegment',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      segmentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-audio-segment-id'),
        renderHTML: attributes => {
          if (!attributes.segmentId) return {};
          return { 'data-audio-segment-id': String(attributes.segmentId) };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-audio-segment-id]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'audio-segment',
      }),
      0,
    ];
  },
});
