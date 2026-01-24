'use client';

import { useEffect, useState } from 'react';
import AudiobookBlocksEditor from '@/components/AudiobookBlocksEditor';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

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
        <div className="sticky top-0 z-[50] -mx-3 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3 bg-black/80 backdrop-blur border-b border-zinc-800 md:static md:mx-0 md:px-0 md:pt-0 md:pb-4 md:bg-transparent md:border-0">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1 rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
            >
              <ChevronLeft size={16} />
              Back
            </Link>
            <h1 className="text-lg md:text-2xl text-zinc-200">Audiobooks</h1>
          </div>
          <p className="mt-2 text-sm text-zinc-500">Paste/write text, generate per-section audio, and replay it later.</p>
        </div>

        <AudiobookBlocksEditor docId={DOC_ID} initialDoc={content} />
      </div>
    </main>
  );
}
