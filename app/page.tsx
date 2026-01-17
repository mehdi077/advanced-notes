'use client';

import { useState, useEffect, useCallback } from 'react';
import { debounce } from 'lodash';
import TiptapEditor from '../components/TiptapEditor';
import VoiceChat from '../components/VoiceChat';
import { ArrowDown, AudioWaveform } from 'lucide-react';
import { useVoiceStore } from '@/lib/stores/useVoiceStore';

export default function Home() {
  const [content, setContent] = useState<object | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const DOC_ID = 'infinite-doc-v1';
  const { setIsModalOpen } = useVoiceStore();

  useEffect(() => {
    // Load from API on mount
    async function loadDoc() {
      try {
        const res = await fetch(`/api/doc?id=${DOC_ID}`);
        if (res.ok) {
          const data = await res.json();
          if (data) {
            setContent(data);
          }
        }
      } catch (e) {
        console.error('Failed to load doc', e);
      } finally {
        setIsLoading(false);
      }
    }
    loadDoc();
  }, []);

  // Debounced save function
  const saveContent = useCallback(
    debounce(async (newContent: object) => {
      try {
        await fetch('/api/doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: DOC_ID, content: newContent }),
        });
        console.log('Saved to server');
      } catch (e) {
        console.error('Failed to save doc', e);
      }
    }, 1000),
    [DOC_ID]
  );

  const handleUpdate = (newContent: object) => {
    saveContent(newContent);
  };

  const scrollToBottom = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth',
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-black text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <main className="min-h-screen w-full bg-black text-white relative">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-4">
          <h1 className="text-2xl text-gray-400">Infinite Document</h1>
          <button
            type="button"
            onClick={scrollToBottom}
            className="inline-flex items-center gap-2 self-start rounded border border-zinc-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <ArrowDown size={16} />
            Scroll to end
          </button>
        </div>
        <TiptapEditor initialContent={content} onContentUpdate={handleUpdate} />
      </div>

      {/* Floating Voice Button - positioned above editor content */}
      <button
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-6 right-6 md:bottom-8 md:right-8 w-14 h-14 md:w-16 md:h-16 rounded-full bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 shadow-lg hover:shadow-purple-500/50 transition-all duration-300 hover:scale-110 active:scale-95 z-[35] flex items-center justify-center group"
        title="Open Voice Assistant"
      >
        {/* Pulsing effect */}
        <span className="absolute inset-0 rounded-full bg-purple-500 opacity-75 animate-ping" />
        
        {/* Icon */}
        <AudioWaveform size={24} className="relative z-10 text-white group-hover:scale-110 transition-transform" />
      </button>

      {/* Voice Chat Modal */}
      <VoiceChat />
    </main>
  );
}
