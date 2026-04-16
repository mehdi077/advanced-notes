'use client';

import { useEffect, useMemo, useState } from 'react';
import { debounce } from 'lodash';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import JournalsEditor, { SENT_DOC_ID, WRITING_DOC_ID } from '@/components/JournalsEditor';
import { authFetch } from '@/lib/auth-fetch';

export default function OpenclawJournalsPage() {
  const [sentContent, setSentContent] = useState<object | null>(null);
  const [writingContent, setWritingContent] = useState<object | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadDocs() {
      try {
        const [sentRes, writingRes] = await Promise.all([
          authFetch(`/api/doc?id=${SENT_DOC_ID}`),
          authFetch(`/api/doc?id=${WRITING_DOC_ID}`),
        ]);
        if (sentRes.ok) {
          const data = await sentRes.json();
          if (data) setSentContent(data as object);
        }
        if (writingRes.ok) {
          const data = await writingRes.json();
          if (data) setWritingContent(data as object);
        }
      } catch (e) {
        console.error('Failed to load journal docs', e);
      } finally {
        setIsLoading(false);
      }
    }
    loadDocs();
  }, []);

  const saveSent = useMemo(
    () =>
      debounce(async (content: object) => {
        await authFetch('/api/doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: SENT_DOC_ID, content }),
        }).catch(console.error);
      }, 500),
    [],
  );

  const saveWriting = useMemo(
    () =>
      debounce(async (content: object) => {
        await authFetch('/api/doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: WRITING_DOC_ID, content }),
        }).catch(console.error);
      }, 1000),
    [],
  );

  useEffect(() => {
    return () => {
      saveSent.cancel();
      saveWriting.cancel();
    };
  }, [saveSent, saveWriting]);

  const handleSentUpdate = (content: object) => {
    setSentContent(content);
    saveSent(content);
  };

  const handleWritingUpdate = (content: object) => {
    setWritingContent(content);
    saveWriting(content);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-black text-white flex items-center justify-center">
        Loading…
      </div>
    );
  }

  return (
    <main className="min-h-screen w-full bg-black text-white">
      <div className="container mx-auto px-4 py-6 md:py-10 max-w-3xl">
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded border border-zinc-800 px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
          >
            <ChevronLeft size={15} />
            Back
          </Link>
        </div>

        <JournalsEditor
          sentContent={sentContent}
          writingContent={writingContent}
          onSentUpdate={handleSentUpdate}
          onWritingUpdate={handleWritingUpdate}
        />
      </div>
    </main>
  );
}
