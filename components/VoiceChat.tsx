'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject, type WheelEvent } from 'react';
import { Camera, DollarSign, Eye, EyeOff, Image as ImageIcon, MessageSquarePlus, Plus, Send, Trash2, X } from 'lucide-react';
import { useVoiceStore } from '@/lib/stores/useVoiceStore';
import { ModelConfig, ModelPricing, formatCost } from '@/lib/model-config';
import { authFetch } from '@/lib/auth-fetch';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  ragContext: string | null;
  modelId: string | null;
  position: number;
  createdAt: string;
  attachments?: ChatAttachment[];
};

type ChatAttachment = {
  id?: string;
  messageId?: string | null;
  conversationId?: string;
  kind: 'upload' | 'screenshot';
  mimeType: string;
  dataUrl: string;
  fileName?: string | null;
  createdAt?: string;
};

type ChatConversation = {
  id: string;
  title: string;
  modelId: string;
  systemPrompt: string;
  useRagContext: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
};

type ChatSettings = {
  currentConversationId: string;
  selectedModelId: string;
  systemPrompt: string;
  useRagContext: boolean;
};

type ConversationPayload = {
  conversation: ChatConversation;
  messages: ChatMessage[];
};

type ActiveTab = 'current' | 'history' | 'settings' | 'open';

type ModelPricingMap = Record<string, ModelPricing | undefined>;

type ModelSpend = {
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCost: number;
  imageCost: number;
};

export default function VoiceChat() {
  const isOpen = useVoiceStore(s => s.isModalOpen);
  const setIsOpen = useVoiceStore(s => s.setIsModalOpen);

  const [activeTab, setActiveTab] = useState<ActiveTab>('current');
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [modelPricing, setModelPricing] = useState<ModelPricingMap>({});
  const [modelSpend, setModelSpend] = useState<ModelSpend[]>([]);
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [current, setCurrent] = useState<ConversationPayload | null>(null);
  const [openChat, setOpenChat] = useState<ConversationPayload | null>(null);
  const [history, setHistory] = useState<ChatConversation[]>([]);
  const [input, setInput] = useState('');
  const [openInput, setOpenInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [openAttachments, setOpenAttachments] = useState<ChatAttachment[]>([]);
  const [pendingScreenshot, setPendingScreenshot] = useState<ChatAttachment | null>(null);
  const [newModelId, setNewModelId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);

  const currentScrollRef = useRef<HTMLDivElement | null>(null);
  const openScrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bodyOverflowRef = useRef<string | null>(null);
  const bodyOverscrollRef = useRef<string | null>(null);
  const bodyPositionRef = useRef<string | null>(null);
  const bodyTopRef = useRef<string | null>(null);
  const bodyWidthRef = useRef<string | null>(null);
  const lockedScrollYRef = useRef(0);
  const fixedBodyForMobileRef = useRef(false);

  const activePayload = activeTab === 'open' ? openChat : current;
  const activeInput = activeTab === 'open' ? openInput : input;
  const activeAttachments = activeTab === 'open' ? openAttachments : attachments;
  const activeModel = models.find((m) => m.id === activePayload?.conversation.modelId);
  const activeSupportsVision = Boolean(activeModel?.supportsVision);

  const loadModels = useCallback(async () => {
    const res = await authFetch('/api/models');
    if (!res.ok) return;
    const data = (await res.json()) as { models?: ModelConfig[]; spend?: ModelSpend[] };
    const nextModels = Array.isArray(data.models) ? data.models : [];
    setModels(nextModels);
    setModelSpend(Array.isArray(data.spend) ? data.spend : []);
    const pricing: ModelPricingMap = {};
    for (const m of nextModels) {
      if (m.pricing) pricing[m.id] = m.pricing;
    }
    setModelPricing(pricing);
  }, []);

  const loadChatState = useCallback(async () => {
    const res = await authFetch('/api/chat/conversations');
    if (!res.ok) return;
    const data = (await res.json()) as {
      conversations?: ChatConversation[];
      current?: ConversationPayload | null;
      settings?: ChatSettings;
    };
    setHistory(Array.isArray(data.conversations) ? data.conversations : []);
    setCurrent(data.current ?? null);
    setSettings(data.settings ?? null);
  }, []);

  const loadAll = useCallback(async () => {
    setError(null);
    await Promise.all([loadModels(), loadChatState()]);
  }, [loadModels, loadChatState]);

  useEffect(() => {
    if (!isOpen) return;
    void loadAll();
  }, [isOpen, loadAll]);

  const lockDocumentScroll = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (bodyOverflowRef.current === null) {
      bodyOverflowRef.current = document.body.style.overflow;
      bodyOverscrollRef.current = document.body.style.overscrollBehavior;
      bodyPositionRef.current = document.body.style.position;
      bodyTopRef.current = document.body.style.top;
      bodyWidthRef.current = document.body.style.width;
      lockedScrollYRef.current = window.scrollY;
    }
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'contain';
    if (window.matchMedia('(max-width: 767px)').matches) {
      fixedBodyForMobileRef.current = true;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${lockedScrollYRef.current}px`;
      document.body.style.width = '100%';
    }
  }, []);

  const unlockDocumentScroll = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (bodyOverflowRef.current === null) return;
    document.body.style.overflow = bodyOverflowRef.current;
    document.body.style.overscrollBehavior = bodyOverscrollRef.current ?? '';
    document.body.style.position = bodyPositionRef.current ?? '';
    document.body.style.top = bodyTopRef.current ?? '';
    document.body.style.width = bodyWidthRef.current ?? '';
    if (fixedBodyForMobileRef.current) {
      window.scrollTo(0, lockedScrollYRef.current);
    }
    bodyOverflowRef.current = null;
    bodyOverscrollRef.current = null;
    bodyPositionRef.current = null;
    bodyTopRef.current = null;
    bodyWidthRef.current = null;
    fixedBodyForMobileRef.current = false;
  }, []);

  useEffect(() => {
    if (!isOpen) {
      unlockDocumentScroll();
      return;
    }

    const shouldLockForMobile = () => {
      if (typeof window === 'undefined') return false;
      return window.matchMedia('(max-width: 767px)').matches;
    };

    if (shouldLockForMobile()) lockDocumentScroll();

    return () => {
      unlockDocumentScroll();
    };
  }, [isOpen, lockDocumentScroll, unlockDocumentScroll]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined' || !window.visualViewport) return;

    const root = document.documentElement;
    const viewport = window.visualViewport;

    const updateViewportVars = () => {
      const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      root.style.setProperty('--chat-vvtop', `${viewport.offsetTop}px`);
      root.style.setProperty('--chat-keyboard-inset', `${keyboardInset}px`);
    };

    updateViewportVars();
    viewport.addEventListener('resize', updateViewportVars);
    viewport.addEventListener('scroll', updateViewportVars);

    return () => {
      viewport.removeEventListener('resize', updateViewportVars);
      viewport.removeEventListener('scroll', updateViewportVars);
      root.style.removeProperty('--chat-vvtop');
      root.style.removeProperty('--chat-keyboard-inset');
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'current') return;
    const raf = window.requestAnimationFrame(() => {
      if (currentScrollRef.current) {
        currentScrollRef.current.scrollTop = currentScrollRef.current.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [activeTab, current?.conversation.id, current?.messages.length, isOpen, isSending]);

  useEffect(() => {
    if (openScrollRef.current) openScrollRef.current.scrollTop = openScrollRef.current.scrollHeight;
  }, [openChat?.messages, isSending]);

  const saveSettings = useCallback(async (next: Partial<ChatSettings>) => {
    setSettingsDirty(true);
    try {
      const res = await authFetch('/api/chat/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = (await res.json().catch(() => ({}))) as ChatSettings | { error?: string };
      if (!res.ok) throw new Error('error' in data ? data.error || 'Failed to save settings' : 'Failed to save settings');
      setSettings(data as ChatSettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSettingsDirty(false);
    }
  }, []);

  const newChat = useCallback(async () => {
    setError(null);
    try {
      const res = await authFetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        conversation?: ChatConversation;
        messages?: ChatMessage[];
        conversations?: ChatConversation[];
        settings?: ChatSettings;
        error?: string;
      };
      if (!res.ok || !data.conversation) throw new Error(data.error || 'Failed to create chat');
      setCurrent({ conversation: data.conversation, messages: data.messages || [] });
      setHistory(data.conversations || []);
      setSettings(data.settings || null);
      setInput('');
      setActiveTab('current');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create chat');
    }
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await authFetch(`/api/chat/conversations?id=${encodeURIComponent(id)}`);
      const data = (await res.json()) as ConversationPayload | { error?: string };
      if (!res.ok || !('conversation' in data)) throw new Error('error' in data ? data.error || 'Failed to load chat' : 'Failed to load chat');
      setOpenChat(data);
      setOpenInput('');
      setActiveTab('open');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load chat');
    }
  }, []);

  const deleteConversation = useCallback(async (conversationId: string) => {
    setError(null);
    try {
      const res = await authFetch(`/api/chat/conversations?id=${encodeURIComponent(conversationId)}`, {
        method: 'DELETE',
      });
      const data = (await res.json().catch(() => ({}))) as {
        conversations?: ChatConversation[];
        current?: ConversationPayload | null;
        settings?: ChatSettings;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'Failed to delete chat');

      setHistory(Array.isArray(data.conversations) ? data.conversations : []);
      setCurrent(data.current ?? null);
      setSettings(data.settings ?? null);

      if (openChat?.conversation.id === conversationId) {
        setOpenChat(null);
        if (activeTab === 'open') setActiveTab('history');
      }

      if (current?.conversation.id === conversationId && activeTab === 'current') {
        setActiveTab('current');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete chat');
    }
  }, [activeTab, current?.conversation.id, openChat?.conversation.id]);

  const updateConversationModel = useCallback(async (payload: ConversationPayload, modelId: string) => {
    setError(null);
    const nextPayload = { ...payload, conversation: { ...payload.conversation, modelId } };
    if (payload.conversation.id === current?.conversation.id) setCurrent(nextPayload);
    if (payload.conversation.id === openChat?.conversation.id) setOpenChat(nextPayload);

    try {
      const res = await authFetch('/api/chat/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: payload.conversation.id, modelId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        conversation?: ChatConversation;
        messages?: ChatMessage[];
        conversations?: ChatConversation[];
        error?: string;
      };
      if (!res.ok || !data.conversation) throw new Error(data.error || 'Failed to update model');
      const refreshed = { conversation: data.conversation, messages: data.messages || payload.messages };
      if (payload.conversation.id === current?.conversation.id) setCurrent(refreshed);
      if (payload.conversation.id === openChat?.conversation.id) setOpenChat(refreshed);
      if (data.conversations) setHistory(data.conversations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update model');
    }
  }, [current?.conversation.id, openChat?.conversation.id]);

  const sendMessage = useCallback(async () => {
    const payload = activePayload;
    const text = activeInput.trim();
    const outgoingAttachments = activeTab === 'open' ? openAttachments : attachments;
    if (!payload || (!text && outgoingAttachments.length === 0) || isSending) return;

    setError(null);
    setIsSending(true);
    if (activeTab === 'open') setOpenInput('');
    else setInput('');
    if (activeTab === 'open') setOpenAttachments([]);
    else setAttachments([]);

    try {
      const res = await authFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: payload.conversation.id,
          message: text,
          modelId: payload.conversation.modelId,
          systemPrompt: settings?.systemPrompt ?? payload.conversation.systemPrompt,
          useRagContext: settings?.useRagContext === true,
          attachments: outgoingAttachments,
        }),
      });
      const data = (await res.json()) as {
        userMessage?: ChatMessage;
        message?: ChatMessage;
        conversation?: ChatConversation;
        error?: string;
      };
      if (!res.ok || !data.userMessage || !data.message || !data.conversation) {
        throw new Error(data.error || 'Failed to send message');
      }

      const nextPayload = {
        conversation: data.conversation,
        messages: [...payload.messages, data.userMessage, data.message],
      };
      if (activeTab === 'open') setOpenChat(nextPayload);
      else setCurrent(nextPayload);
      await loadChatState();
      await loadModels();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message');
      if (activeTab === 'open') setOpenInput(text);
      else setInput(text);
      if (activeTab === 'open') setOpenAttachments(outgoingAttachments);
      else setAttachments(outgoingAttachments);
    } finally {
      setIsSending(false);
    }
  }, [activeInput, activePayload, activeTab, attachments, isSending, loadChatState, loadModels, openAttachments, settings?.systemPrompt, settings?.useRagContext]);

  const addModel = useCallback(async () => {
    const id = newModelId.trim();
    if (!id) return;
    setError(null);
    try {
      const res = await authFetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: id, description: 'Custom OpenRouter model' }),
      });
      const data = (await res.json().catch(() => ({}))) as { models?: ModelConfig[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to add model');
      if (Array.isArray(data.models)) setModels(data.models);
      setNewModelId('');
      await saveSettings({ selectedModelId: id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add model');
    }
  }, [newModelId, saveSettings]);

  const modelOptions = useMemo(() => models.length ? models : [], [models]);

  const deleteModel = useCallback(async (modelId: string) => {
    if (models.length <= 1) {
      setError('Cannot delete the last model.');
      return;
    }

    setError(null);
    try {
      const res = await authFetch(`/api/models?id=${encodeURIComponent(modelId)}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as {
        models?: ModelConfig[];
        spend?: ModelSpend[];
        fallbackModelId?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'Failed to delete model');

      const nextModels = Array.isArray(data.models) ? data.models : [];
      setModels(nextModels);
      setModelSpend(Array.isArray(data.spend) ? data.spend : []);

      const fallback = data.fallbackModelId || nextModels[0]?.id || '';
      if (settings?.selectedModelId === modelId && fallback) {
        setSettings(s => s ? { ...s, selectedModelId: fallback } : s);
      }
      if (current?.conversation.modelId === modelId && fallback) {
        setCurrent(p => p ? { ...p, conversation: { ...p.conversation, modelId: fallback } } : p);
      }
      if (openChat?.conversation.modelId === modelId && fallback) {
        setOpenChat(p => p ? { ...p, conversation: { ...p.conversation, modelId: fallback } } : p);
      }
      await loadChatState();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete model');
    }
  }, [current?.conversation.modelId, loadChatState, models.length, openChat?.conversation.modelId, settings?.selectedModelId]);

  const stopDocumentScroll = useCallback((e: WheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  const modelLabel = useCallback((m: ModelConfig) => {
    const p = modelPricing[m.id] ?? m.pricing;
    const price = p ? `${formatCost(p.prompt)}/M in, ${formatCost(p.completion)}/M out` : '--/M';
    const vision = m.supportsVision ? 'Vision' : 'Text';
    return `${m.name} - ${price} - ${vision}`;
  }, [modelPricing]);

  const addActiveAttachments = useCallback((items: ChatAttachment[]) => {
    if (activeTab === 'open') setOpenAttachments(prev => [...prev, ...items]);
    else setAttachments(prev => [...prev, ...items]);
  }, [activeTab]);

  const removeActiveAttachment = useCallback((idx: number) => {
    if (activeTab === 'open') setOpenAttachments(prev => prev.filter((_, i) => i !== idx));
    else setAttachments(prev => prev.filter((_, i) => i !== idx));
  }, [activeTab]);

  const readFilesAsAttachments = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    const next = await Promise.all(imageFiles.map((file) => new Promise<ChatAttachment>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        kind: 'upload',
        mimeType: file.type,
        dataUrl: String(reader.result || ''),
        fileName: file.name,
      });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    })));
    addActiveAttachments(next.filter((a) => a.dataUrl.startsWith('data:image/')));
  }, [addActiveAttachments]);

  const captureScreenshot = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen capture is not supported in this browser.');
      return;
    }

    setIsOpen(false);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth || window.innerWidth, window.innerWidth);
      canvas.height = Math.min(video.videoHeight || window.innerHeight, window.innerHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not capture screen');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setPendingScreenshot({
        kind: 'screenshot',
        mimeType: 'image/png',
        dataUrl: canvas.toDataURL('image/png'),
        fileName: 'screen.png',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Screen capture cancelled');
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setIsOpen(true);
    }
  }, [setIsOpen]);

  const renderConversation = (payload: ConversationPayload | null, scrollRef: RefObject<HTMLDivElement | null>) => {
    if (!payload) return <div className="p-4 text-sm text-zinc-500">No chat loaded.</div>;
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-zinc-800 px-4 py-3">
          <label className="mb-1 block text-xs text-zinc-500">Model for this chat</label>
          <select
            value={payload.conversation.modelId}
            onChange={(e) => void updateConversationModel(payload, e.target.value)}
            className="w-full rounded-lg border border-zinc-700/80 bg-zinc-950/70 px-3 py-2 text-base text-white shadow-inner focus:border-cyan-500/70 focus:outline-none md:text-sm"
          >
            {modelOptions.map((m) => {
              return <option key={m.id} value={m.id}>{modelLabel(m)}</option>;
            })}
          </select>
        </div>

        <div ref={scrollRef} data-chat-scrollable="true" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 max-md:pb-36">
          {payload.messages.length === 0 && (
            <div className="text-sm text-zinc-500">Start a conversation. It stays saved in data.db.</div>
          )}
          {payload.messages.map((m) => (
            <div key={m.id} className={`flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className="px-1 text-[10px] text-zinc-500">{m.role === 'user' ? 'You' : 'Assistant'}</div>
              <div className={`max-w-[88%] whitespace-pre-wrap break-words rounded border px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'border-cyan-700/30 bg-cyan-950/50 text-cyan-50 shadow-sm'
                  : 'border-fuchsia-700/25 bg-zinc-950/80 text-zinc-100 shadow-sm'
              }`}>
                {m.content}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {m.attachments.map((a) => (
                      <img
                        key={a.id || a.dataUrl}
                        src={a.dataUrl}
                        alt={a.fileName || a.kind}
                        className="max-h-36 w-full rounded-md border border-zinc-700/60 object-cover"
                      />
                    ))}
                  </div>
                )}
              </div>
              {m.role === 'assistant' && m.ragContext && (
                <div className="max-w-[88%] whitespace-pre-wrap break-words rounded border border-violet-900/40 bg-violet-950/20 px-3 py-2 text-[11px] text-violet-200">
                  <div className="mb-1 text-zinc-400">Context used</div>
                  {m.ragContext}
                </div>
              )}
            </div>
          ))}
          {isSending && <div className="text-sm text-zinc-500">Assistant is typing...</div>}
        </div>

        <div className="border-t border-zinc-800/80 bg-zinc-950/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-xl transition-transform duration-200 max-md:fixed max-md:bottom-0 max-md:left-0 max-md:right-0 max-md:z-[100] max-md:translate-y-[calc(var(--chat-keyboard-inset,0px)*-1)] md:bg-zinc-950/40 md:backdrop-blur-none">
          {activeAttachments.length > 0 && (
            <div className="mb-3 flex gap-2 overflow-x-auto">
              {activeAttachments.map((a, idx) => (
                <div key={`${a.dataUrl}-${idx}`} className="relative h-16 w-16 shrink-0">
                  <img src={a.dataUrl} alt={a.fileName || a.kind} className="h-16 w-16 rounded-lg border border-zinc-700 object-cover" />
                  <button
                    type="button"
                    onClick={() => removeActiveAttachment(idx)}
                    className="absolute -right-1 -top-1 rounded-full bg-zinc-950 p-0.5 text-zinc-200 shadow"
                    title="Remove image"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              value={activeTab === 'open' ? openInput : input}
              onChange={(e) => activeTab === 'open' ? setOpenInput(e.target.value) : setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              rows={1}
              className="max-h-36 flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-base leading-6 text-white shadow-inner focus:border-cyan-500/70 focus:outline-none md:text-sm md:leading-5"
              placeholder={activeSupportsVision ? 'Type a message, attach images, or send just an image...' : 'Type a message...'}
              disabled={isSending}
            />
            {activeSupportsVision && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void readFilesAsAttachments(e.target.files);
                    e.currentTarget.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-200 transition-colors hover:bg-zinc-800"
                  title="Attach images"
                >
                  <ImageIcon size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => void captureScreenshot()}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-200 transition-colors hover:bg-zinc-800"
                  title="Capture screen"
                >
                  <Camera size={18} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={isSending || (!activeInput.trim() && activeAttachments.length === 0)}
              className="rounded-xl bg-cyan-600 px-3 py-2 text-white shadow-lg shadow-cyan-950/40 transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:shadow-none"
              title="Send"
            >
              <Send size={18} />
            </button>
          </div>
          <div className="mt-2 text-xs text-zinc-500">
            RAG is {settings?.useRagContext ? 'enabled' : 'disabled'} for outgoing messages.
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
    <div
      className={`fixed right-0 top-0 z-[70] h-full border-l border-zinc-800/80 bg-zinc-950/95 shadow-2xl shadow-black/40 backdrop-blur-xl transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      } w-full max-w-[30rem] overscroll-contain max-md:inset-x-0 max-md:top-0 max-md:h-[100lvh] max-md:max-w-none max-md:border-l-0 max-md:transition-transform md:h-full`}
      onWheel={stopDocumentScroll}
      onTouchMove={(e) => e.stopPropagation()}
      onMouseEnter={lockDocumentScroll}
      onMouseLeave={unlockDocumentScroll}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-zinc-800/80 bg-gradient-to-b from-zinc-900/90 to-zinc-950/90 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] md:pt-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-zinc-200">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10 text-cyan-200">
                <MessageSquarePlus size={18} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-100">Chat</div>
                <div className="truncate text-[11px] text-zinc-500">Saved conversations, models, and spend</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void newChat()}
                className="rounded-xl border border-zinc-700/80 bg-zinc-900/90 p-2 text-zinc-200 shadow-sm transition-colors hover:border-cyan-700/60 hover:bg-zinc-800"
                title="New chat"
              >
                <Plus size={16} />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-xl border border-zinc-700/80 bg-zinc-900/90 p-2 text-zinc-200 shadow-sm transition-colors hover:border-zinc-600 hover:bg-zinc-800"
                title="Close chat panel"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex gap-1 overflow-x-auto pb-0">
            {[
              ['current', 'Current chat'],
              ['history', 'History'],
              ['settings', 'Settings'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id as ActiveTab)}
                className={`shrink-0 rounded-t-xl border-x border-t px-3 py-2 text-xs transition-colors ${
                  activeTab === id
                    ? 'border-zinc-700 bg-zinc-950 text-white shadow-inner'
                    : 'border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
            {openChat && (
              <button
                type="button"
                onClick={() => setActiveTab('open')}
                className={`flex min-w-0 shrink-0 items-center gap-2 rounded-t-xl border-x border-t px-3 py-2 text-xs transition-colors ${
                  activeTab === 'open'
                    ? 'border-zinc-700 bg-zinc-950 text-white'
                    : 'border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
                title={openChat.conversation.title}
              >
                <span className="max-w-32 truncate">{openChat.conversation.title}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenChat(null);
                    if (activeTab === 'open') setActiveTab('history');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenChat(null);
                      if (activeTab === 'open') setActiveTab('history');
                    }
                  }}
                  className="rounded p-0.5 hover:bg-zinc-800"
                >
                  <X size={12} />
                </span>
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 rounded border border-red-500/30 bg-red-900/20 p-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'current' && renderConversation(current, currentScrollRef)}
          {activeTab === 'open' && renderConversation(openChat, openScrollRef)}

          {activeTab === 'history' && (
            <div data-chat-scrollable="true" className="h-full overflow-y-auto overscroll-contain p-4">
              <div className="flex flex-col gap-2">
                {history.length === 0 && <div className="text-sm text-zinc-500">No saved chats yet.</div>}
                {history.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
                  >
                    <button
                      type="button"
                      onClick={() => void loadConversation(c.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm text-zinc-200">{c.title}</div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-zinc-500">
                        <span className="truncate">{c.modelId}</span>
                        <span>{c.messageCount ?? 0} msgs</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete chat \"${c.title}\"? This removes its messages and attached images.`)) {
                          void deleteConversation(c.id);
                        }
                      }}
                      className="shrink-0 rounded-md p-2 text-zinc-500 transition-colors hover:bg-red-950/40 hover:text-red-300"
                      title={`Delete ${c.title}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div data-chat-scrollable="true" className="h-full overflow-y-auto overscroll-contain p-4">
              <div className="flex flex-col gap-5">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Default model for new chats</label>
                  <select
                    value={settings?.selectedModelId || ''}
                    onChange={(e) => {
                      const selectedModelId = e.target.value;
                      setSettings(s => s ? { ...s, selectedModelId } : s);
                      void saveSettings({ selectedModelId });
                    }}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-base text-white focus:border-cyan-500/70 focus:outline-none md:text-sm"
                  >
                    {modelOptions.map((m) => (
                      <option key={m.id} value={m.id}>{modelLabel(m)}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Add OpenRouter model</label>
                  <div className="flex gap-2">
                    <input
                      value={newModelId}
                      onChange={(e) => setNewModelId(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-base text-white focus:border-zinc-500 focus:outline-none md:text-sm"
                      placeholder="provider/model-id"
                    />
                    <button
                      type="button"
                      onClick={() => void addModel()}
                      disabled={!newModelId.trim()}
                      className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="mb-3 flex items-center gap-2 text-sm text-zinc-300">
                    <DollarSign size={15} />
                    OpenRouter spend
                  </div>
                  {modelSpend.length === 0 ? (
                    <div className="text-xs text-zinc-500">No tracked spend yet. New chat responses will add usage here when OpenRouter returns token usage.</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {modelSpend.map((s) => (
                        <div key={s.modelId} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-xs text-zinc-300">{s.modelId}</span>
                            <span className="text-xs font-semibold text-emerald-300">${Number(s.totalCost || 0).toFixed(6)}</span>
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-500">
                            {Number(s.promptTokens || 0).toLocaleString()} in / {Number(s.completionTokens || 0).toLocaleString()} out
                            {s.imageCost ? ` / $${Number(s.imageCost).toFixed(6)} images` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs text-zinc-500">System prompt</label>
                  <textarea
                    value={settings?.systemPrompt || ''}
                    onChange={(e) => {
                      const systemPrompt = e.target.value;
                      setSettings(s => s ? { ...s, systemPrompt } : s);
                      void saveSettings({ systemPrompt });
                    }}
                    rows={8}
                    className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-base text-white focus:border-zinc-500 focus:outline-none md:text-sm"
                  />
                </div>

                <div className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
                  <div>
                    <div className="text-sm text-zinc-300">Use RAG context</div>
                    <div className="text-xs text-zinc-500">Off by default. Stored in data.db.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const useRagContext = !(settings?.useRagContext ?? false);
                      setSettings(s => s ? { ...s, useRagContext } : s);
                      void saveSettings({ useRagContext });
                    }}
                    className={`h-6 w-10 rounded-full transition-colors ${settings?.useRagContext ? 'bg-blue-600' : 'bg-zinc-700'}`}
                    title={settings?.useRagContext ? 'RAG enabled' : 'RAG disabled'}
                  >
                    <div className={`h-4 w-4 rounded-full bg-white shadow-md transition-transform ${settings?.useRagContext ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="mb-2 text-sm text-zinc-300">Model capabilities</div>
                  <div data-chat-scrollable="true" className="flex max-h-52 flex-col gap-1 overflow-y-auto overscroll-contain">
                    {modelOptions.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900/70">
                        <span className="min-w-0 flex-1 truncate" title={m.id}>{m.name}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${m.supportsVision ? 'bg-cyan-500/10 text-cyan-200' : 'bg-zinc-800 text-zinc-500'}`}>
                            {m.supportsVision ? <Eye size={12} /> : <EyeOff size={12} />}
                            {m.supportsVision ? 'Vision' : 'Text'}
                          </span>
                          <button
                            type="button"
                            onClick={() => void deleteModel(m.id)}
                            disabled={modelOptions.length <= 1}
                            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-red-950/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
                            title={modelOptions.length <= 1 ? 'Cannot delete the last model' : `Delete ${m.name}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-zinc-500">
                  {settingsDirty ? 'Saving settings...' : 'Settings are saved to data.db.'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    {pendingScreenshot && (
      <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
        <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <div className="text-sm font-medium text-zinc-100">Use this screenshot?</div>
            <button
              type="button"
              onClick={() => setPendingScreenshot(null)}
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <X size={16} />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-auto p-3">
            <img src={pendingScreenshot.dataUrl} alt="Captured screen" className="w-full rounded-xl border border-zinc-800" />
          </div>
          <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
            <button
              type="button"
              onClick={() => setPendingScreenshot(null)}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                addActiveAttachments([pendingScreenshot]);
                setPendingScreenshot(null);
              }}
              className="rounded-lg bg-cyan-600 px-3 py-2 text-sm text-white hover:bg-cyan-500"
            >
              Attach
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
