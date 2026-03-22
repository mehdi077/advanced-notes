export function extractLastWordFromTiptapJSON(doc: unknown): string | null {
  let lastWord: string | null = null;

  const stack: unknown[] = [doc];
  while (stack.length) {
    const v = stack.pop();
    if (!v) continue;

    if (typeof v === 'string') {
      const w = lastWordFromText(v);
      if (w) lastWord = w;
      continue;
    }

    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
      continue;
    }

    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.text === 'string') {
        const w = lastWordFromText(o.text);
        if (w) lastWord = w;
      }

      // Common TipTap/ProseMirror shapes: { content: [] }, { attrs: {} }, { marks: [] }
      // We push other values as well in case text is nested.
      for (const key of Object.keys(o)) {
        if (key === 'text') continue;
        stack.push(o[key]);
      }
    }
  }

  return lastWord;
}

function lastWordFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  const raw = parts[parts.length - 1] ?? '';
  const cleaned = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
  return cleaned || raw || null;
}
