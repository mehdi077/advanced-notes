'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useVoiceStore } from '@/lib/stores/useVoiceStore';
import { X, Send } from 'lucide-react';
import { AVAILABLE_MODELS, DEFAULT_MODEL, ModelId, ModelPricing, formatCost } from '@/lib/model-config';

export default function VoiceChat() {
  const { isModalOpen, setIsModalOpen } = useVoiceStore();

  const STORAGE_CHAT_SELECTED_MODEL_KEY = 'helm.chat.selectedModel';
  const STORAGE_CUSTOM_MODELS_KEY = 'helm.customModels';
  const STORAGE_EMBEDDING_MODEL_KEY = 'helm.embeddingModelId';

  type ChatRole = 'user' | 'assistant';
  interface ChatMessage {
    role: ChatRole;
    content: string;
    ragContext?: string | null;
  }

  interface ModelPricingMap {
    [modelId: string]: ModelPricing;
  }

  const [selectedModel, setSelectedModel] = useState<ModelId>(DEFAULT_MODEL);
  const [customModelIds, setCustomModelIds] = useState<string[]>([]);
  const [useRagContext, setUseRagContext] = useState(true);
  const [embeddingModelId, setEmbeddingModelId] = useState('qwen/qwen3-embedding-8b');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [modelPricing, setModelPricing] = useState<ModelPricingMap>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const allModels = useMemo(() => {
    const builtInIds = new Set(AVAILABLE_MODELS.map(m => m.id));
    const custom = customModelIds
      .map(s => s.trim())
      .filter(Boolean)
      .filter(id => !builtInIds.has(id as ModelId))
      .map((id) => ({ id: id as ModelId, name: id, description: 'Custom OpenRouter model' }));
    return [...AVAILABLE_MODELS, ...custom];
  }, [customModelIds]);

  useEffect(() => {
    if (!isModalOpen) return;
    setError(null);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [isModalOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const rawCustom = window.localStorage.getItem(STORAGE_CUSTOM_MODELS_KEY);
    if (rawCustom) {
      try {
        const parsed: unknown = JSON.parse(rawCustom);
        if (Array.isArray(parsed)) {
          setCustomModelIds(parsed.filter((v): v is string => typeof v === 'string').map(s => s.trim()).filter(Boolean));
        }
      } catch {
        // ignore
      }
    }
    const rawSelected = window.localStorage.getItem(STORAGE_CHAT_SELECTED_MODEL_KEY);
    const selected = rawSelected?.trim();
    if (selected) setSelectedModel(selected as ModelId);

    const rawEmbeddingModel = window.localStorage.getItem(STORAGE_EMBEDDING_MODEL_KEY);
    const em = rawEmbeddingModel?.trim();
    if (em) setEmbeddingModelId(em);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_CHAT_SELECTED_MODEL_KEY, String(selectedModel));
  }, [selectedModel]);

  useEffect(() => {
    // Fetch OpenRouter pricing (best-effort)
    const fetchPricing = async () => {
      try {
        const res = await fetch('/api/models');
        if (!res.ok) return;
        const data = (await res.json()) as { models?: Array<{ id: string; pricing: ModelPricing }> };
        const map: ModelPricingMap = {};
        for (const m of data.models || []) {
          map[m.id] = m.pricing;
        }
        setModelPricing(map);
      } catch {
        // ignore
      }
    };
    void fetchPricing();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSending]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setMessages([]);
    setInput('');
    setError(null);
    setIsSending(false);
  }, [setIsModalOpen]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isSending) return;

    setError(null);
    setIsSending(true);

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: selectedModel,
          useRagContext,
          embeddingModelId,
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = (await res.json()) as
        | { message?: { role: 'assistant'; content: string }; ragContext?: string | null; error?: string }
        | { error: string };

      if (!res.ok) {
        throw new Error(('error' in data && data.error) || 'Failed to send message');
      }

      const assistant = 'message' in data ? data.message : undefined;
      if (!assistant?.content) throw new Error('Empty response');

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: assistant.content, ragContext: 'ragContext' in data ? data.ragContext ?? null : null },
      ]);
    } catch (e: unknown) {
      const msg = (typeof (e as { message?: unknown })?.message === 'string' && (e as { message: string }).message) || 'Failed to send message';
      setError(msg);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  }, [input, isSending, messages, selectedModel, useRagContext, embeddingModelId]);

  if (!isModalOpen) return null;

  return (
    <>
      {/* Backdrop blur */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={closeModal} />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center p-0 md:p-4">
        <div className="relative bg-zinc-900 rounded-none md:rounded-2xl shadow-2xl border border-zinc-800 w-full md:max-w-3xl h-[100dvh] md:h-auto md:max-h-[80vh] flex flex-col overflow-hidden">
          
          {/* Close button */}
          <button
            onClick={closeModal}
            className="absolute top-[calc(env(safe-area-inset-top)+0.75rem)] right-3 md:top-4 md:right-4 z-10 p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white"
          >
            <X size={18} className="md:w-5 md:h-5" />
          </button>

          {/* Header */}
          <div className="px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 md:px-6 md:py-4 border-b border-zinc-800 flex-shrink-0">
            <h2 className="text-lg md:text-xl font-semibold text-white pr-10">Chat</h2>

            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs text-zinc-400 mb-1">Model</label>
                  <select
                    value={String(selectedModel)}
                    onChange={(e) => setSelectedModel(e.target.value as ModelId)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                  >
                    {allModels.map((m) => {
                      const p = modelPricing[m.id];
                      const suffix = p ? ` (${formatCost(p.prompt)}/M in, ${formatCost(p.completion)}/M out)` : '';
                      return (
                        <option key={m.id} value={m.id}>
                          {m.name}{suffix}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="flex items-center justify-between md:justify-start gap-2">
                  <span className="text-xs text-zinc-400">RAG</span>
                  <button
                    type="button"
                    onClick={() => setUseRagContext((v) => !v)}
                    className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${useRagContext ? 'bg-blue-600' : 'bg-zinc-700'}`}
                    title={useRagContext ? 'RAG context enabled' : 'RAG context disabled'}
                  >
                    <div
                      className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${useRagContext ? 'translate-x-5' : 'translate-x-1'}`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mx-4 mt-3 md:mx-6 md:mt-4 bg-red-900/20 border border-red-500/30 rounded-lg p-2 md:p-3 flex-shrink-0">
              <p className="text-xs md:text-sm text-red-300">{error}</p>
            </div>
          )}

          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 md:px-6 md:py-4 space-y-3"
            >
              {messages.length === 0 && (
                <div className="text-sm text-zinc-500">Ask anything. Closing this popup clears the conversation.</div>
              )}

              {messages.map((m, idx) => (
                <div key={idx} className={`flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className="text-[10px] text-zinc-500 px-1">{m.role === 'user' ? 'You' : 'Assistant'}</div>
                  <div
                    className={`max-w-[90%] md:max-w-[85%] px-3 py-2 rounded-lg text-sm border whitespace-pre-wrap break-words ${
                      m.role === 'user'
                        ? 'bg-cyan-900/30 text-cyan-100 border-cyan-800/30'
                        : 'bg-purple-900/30 text-purple-100 border-purple-800/30'
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.role === 'assistant' && m.ragContext && (
                    <div className="max-w-[90%] md:max-w-[85%] px-3 py-2 rounded-lg text-[11px] border border-violet-900/40 bg-violet-950/20 text-violet-200">
                      <div className="text-zinc-400 mb-1">Context used</div>
                      <div className="whitespace-pre-wrap break-words">{m.ragContext}</div>
                    </div>
                  )}
                </div>
              ))}

              {isSending && (
                <div className="text-sm text-zinc-500">Assistant is typing…</div>
              )}
            </div>

            <div className="border-t border-zinc-800 px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:p-4">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                  placeholder="Type a message…"
                  disabled={isSending}
                />
                <button
                  type="button"
                  onClick={() => { void sendMessage(); }}
                  disabled={isSending || !input.trim()}
                  className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white transition-colors"
                  title="Send"
                >
                  <Send size={18} />
                </button>
              </div>
              <div className="mt-2 text-xs text-zinc-500">
                {useRagContext ? 'RAG is enabled: each user message pulls relevant context.' : 'RAG is disabled.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
