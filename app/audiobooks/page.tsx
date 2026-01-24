'use client';

import { useEffect, useMemo, useState } from 'react';
import { debounce } from 'lodash';
import AudiobookEditor from '@/components/AudiobookEditor';

export default function AudiobooksPage() {
  const DOC_ID = 'audiobook-doc-v1';
  const [content, setContent] = useState<object | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadDoc() {
      try {
        const res = await fetch(`/api/audiobooks/doc?id=${DOC_ID}`);
        if (res.ok) {
          const data = await res.json();
          if (data) setContent(data);
        }
      } catch (e) {
        console.error('Failed to load audiobook doc', e);
      } finally {
        setIsLoading(false);
      }
    }
    loadDoc();
  }, []);

  const saveContent = useMemo(() => {
    return debounce(async (newContent: object) => {
      try {
        await fetch('/api/audiobooks/doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: DOC_ID, content: newContent }),
        });
      } catch (e) {
        console.error('Failed to save audiobook doc', e);
      }
    }, 800);
  }, []);

  useEffect(() => {
    return () => saveContent.cancel();
  }, [saveContent]);

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-black text-white flex items-center justify-center">
        Loading…
      </div>
    );
  }

  return (
    <main className="min-h-screen w-full bg-black text-white">
      <div className="container mx-auto px-3 py-4 md:px-4 md:py-8">
        <div className="mb-3 md:mb-4">
          <h1 className="text-xl md:text-2xl text-zinc-200">Audiobooks</h1>
          <p className="text-sm text-zinc-500">Paste/write text, generate per-section audio, and replay it later.</p>
        </div>

        <AudiobookEditor
          docId={DOC_ID}
          initialContent={content}
          onContentUpdate={(c) => saveContent(c)}
        />
      </div>
    </main>
  );
}
