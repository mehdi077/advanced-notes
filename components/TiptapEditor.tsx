'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { debounce } from 'lodash';
import { ChevronDown, ChevronRight, ChevronLeft, Bold, Strikethrough, Highlighter, Palette, Sparkles, Loader2, DollarSign, RefreshCw, Check, X, ChevronsRight, RotateCcw, Split, Star, MessageSquare, Play, Pause, SkipBack, SkipForward, Database, Plus, Minus, BookOpen, Tag, ArrowUp, ChartNoAxesCombined, BookmarkPlus, NotebookPen, CircleAlert } from 'lucide-react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { useVoiceStore } from '@/lib/stores/useVoiceStore';
import { DEFAULT_MODEL, ModelConfig, ModelId, ModelPricing, formatCost } from '@/lib/model-config';
import { CompletionMark } from '@/lib/completion-mark';
import { SavedCompletion } from '@/lib/saved-completion';
import { Bookmark } from '@/lib/bookmark';
import { UnsavedUnderline, UnsavedUnderlinePluginKey } from '@/lib/unsaved-underline';
import { FontSize } from '@/lib/font-size';
import Link from 'next/link';
import { authFetch } from '@/lib/auth-fetch';
import { useSaveSyncStore } from '@/lib/stores/save-sync-store';
import { useUnlockStore } from '@/lib/stores/unlock-store';
import PinAttemptLog from '@/components/PinAttemptLog';
import PinResetForm from '@/components/PinResetForm';

interface TiptapEditorProps {
  initialContent: object | null;
  onContentUpdate: (content: object) => void;
}

const DEFAULT_PROMPT = 'Provide a two sentence long completion to this text:';
const DEFAULT_REGEN_PROMPT_TEMPLATE = `This is the already generated text:
{{ATTEMPTS}}

Now generate a drastically  different path to the completion for the next attempt, very far deferent from the ones that are shown in the attempts above.
{{ORIGINAL_PROMPT}}`;
const DEFAULT_FOCUS_PROMPT = 'If I had to change the color of one or more words in this text so later I just see that colored word and I know what phrase is about, what should I color?';
const FOCUS_COLORS = [
  { color: '#facc15', label: 'Yellow' },
  { color: '#4ade80', label: 'Green' },
  { color: '#60a5fa', label: 'Blue' },
  { color: '#f472b6', label: 'Pink' },
  { color: '#fb923c', label: 'Orange' },
  { color: '#a78bfa', label: 'Purple' },
];
const TEXT_COLORS = [
  { color: '#ffffff', label: 'White' },
  { color: '#ef4444', label: 'Red' },
  { color: '#3b82f6', label: 'Blue' },
  { color: '#22c55e', label: 'Green' },
  { color: '#eab308', label: 'Yellow' },
  { color: '#a855f7', label: 'Purple' },
];
const DEFAULT_FOCUS_COLOR_RULES: Record<string, string> = {
  '#facc15': 'the What',
  '#4ade80': 'the where',
};
const LEFT_SIDEBAR_TAB_STORAGE_KEY = 'helm.leftSidebarTab';

const SILENT_WAV_DATA_URL =
  'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

const DEFAULT_EMBEDDING_MODEL_ID = 'qwen/qwen3-embedding-8b';
const STORAGE_EMBEDDING_MODEL_KEY = 'helm.embeddingModelId';

interface CompletionState {
  isActive: boolean;
  words: string[];
  selectedCount: number;
  range: { from: number; to: number } | null;
}

interface AttemptHistory {
  attempts: string[];  // Array of previous completion attempts
}

interface BalanceInfo {
  balance: number;
  totalCredits: number;
  totalUsage: number;
}

interface ModelPricingMap {
  [modelId: string]: ModelPricing;
}

interface AutocompleteRequestPreview {
  model: string;
  useRagContext: boolean;
  embeddingModelId?: string;
  ragContext: string | null;
  ragChunksRetrieved?: number;
  ragChunksAvailable?: number;
  promptText: string;
  inputText: string;
  systemPrompt: string;
  userMessage: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
}

interface FocusHighlight {
  text: string;
  color: string;
}

interface FocusTextNode {
  text: string;
  from: number;
  to: number;
  colors: string[];
}

interface FocusTextContext {
  text: string;
  flatStart: number;
  flatEnd: number;
  textNodes: FocusTextNode[];
}

const TiptapEditor = ({ initialContent, onContentUpdate }: TiptapEditorProps) => {
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [leftSidebarTab, setLeftSidebarTabState] = useState<'assistant' | 'tools'>(() => {
    if (typeof window === 'undefined') return 'assistant';
    return window.localStorage.getItem(LEFT_SIDEBAR_TAB_STORAGE_KEY) === 'tools' ? 'tools' : 'assistant';
  });
  const setIsModalOpen = useVoiceStore(s => s.setIsModalOpen);
  const isChatModalOpen = useVoiceStore(s => s.isModalOpen);
  const [selectedModel, setSelectedModel] = useState<ModelId>(DEFAULT_MODEL);
  const [allModels, setAllModels] = useState<ModelConfig[]>([]);
  const [isAddModelOpen, setIsAddModelOpen] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newModelError, setNewModelError] = useState<string | null>(null);
  const newModelInputRef = useRef<HTMLInputElement | null>(null);
  const [isAutoCompleting, setIsAutoCompleting] = useState(false);
  const [isFocusHighlighting, setIsFocusHighlighting] = useState(false);
  const [autoCompleteError, setAutoCompleteError] = useState<string | null>(null);
  const [focusHighlightError, setFocusHighlightError] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_PROMPT);
  const [regenPromptTemplate, setRegenPromptTemplate] = useState(DEFAULT_REGEN_PROMPT_TEMPLATE);
  const [focusPrompt, setFocusPrompt] = useState(DEFAULT_FOCUS_PROMPT);
  const [focusColorRules, setFocusColorRules] = useState<Record<string, string>>(DEFAULT_FOCUS_COLOR_RULES);
  const [selectedFocusColor, setSelectedFocusColor] = useState(FOCUS_COLORS[0].color);
  const [isTextColorPaletteOpen, setIsTextColorPaletteOpen] = useState(false);
  const [fabButtonsVisible, setFabButtonsVisible] = useState(() => {
    try { return localStorage.getItem('fabButtonsVisible') !== 'false'; } catch { return true; }
  });
  const [didSaveMentalNote, setDidSaveMentalNote] = useState(false);
  const [isMentalNoteModeOpen, setIsMentalNoteModeOpen] = useState(false);
  const [isMentalReminderOpen, setIsMentalReminderOpen] = useState(false);
  const [mentalReminderDate, setMentalReminderDate] = useState('');
  const [mentalReminderTime, setMentalReminderTime] = useState('');
  const [mentalNoteSelectionError, setMentalNoteSelectionError] = useState(false);
  const [mentalReminderNow, setMentalReminderNow] = useState(() => new Date());
  const [attemptHistory, setAttemptHistory] = useState<AttemptHistory>({ attempts: [] });
  const [completion, setCompletion] = useState<CompletionState>({
    isActive: false,
    words: [],
    selectedCount: 0,
    range: null,
  });
  const completionTextRef = useRef<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  // Force re-render on editor updates to reflect active states in toolbar
  const [, forceUpdate] = useState({});
  
  // Balance and pricing state
  const [balanceInfo, setBalanceInfo] = useState<BalanceInfo | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [groqBalanceInfo, setGroqBalanceInfo] = useState<BalanceInfo | null>(null);
  const [isLoadingGroqBalance, setIsLoadingGroqBalance] = useState(false);
  const [modelPricing, setModelPricing] = useState<ModelPricingMap>({});
  const [lastGenerationCost, setLastGenerationCost] = useState<number | null>(null);
  const [promptsLoaded, setPromptsLoaded] = useState(false);

  // RAG embedding state
  const [ragStatus, setRagStatus] = useState<{ embeddingModelId: string; availableEmbeddingModels: string[]; percentage: number; totalChunks: number; embeddedChunks: number; needsUpdate: boolean } | null>(null);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [embeddingError, setEmbeddingError] = useState<string | null>(null);
  const [embeddingModelId, setEmbeddingModelId] = useState<string>(DEFAULT_EMBEDDING_MODEL_ID);
  const [isAddEmbeddingModelOpen, setIsAddEmbeddingModelOpen] = useState(false);
  const [newEmbeddingModelId, setNewEmbeddingModelId] = useState('');
  const [embeddingModelError, setEmbeddingModelError] = useState<string | null>(null);

  const [useRagContext, setUseRagContext] = useState(true);
  const useRagContextRef = useRef(true);
  const [lastRequestPreview, setLastRequestPreview] = useState<AutocompleteRequestPreview | null>(null);

  const [ragTopK, setRagTopK] = useState<number>(3);
  const [ragTopKDraft, setRagTopKDraft] = useState<string>('3');
  const [ragTopKLoaded, setRagTopKLoaded] = useState(false);
  const [ragTopKDirty, setRagTopKDirty] = useState(false);

  useEffect(() => {
    useRagContextRef.current = useRagContext;
  }, [useRagContext]);

  const toggleUseRagContext = useCallback(() => {
    const next = !useRagContextRef.current;
    useRagContextRef.current = next;
    setUseRagContext(next);

    // Persist in data.db
    void authFetch('/api/editor-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ useRagContext: next }),
    }).catch(() => {
      // ignore
    });
  }, []);

  const lastSystemPromptParts = useMemo(() => {
    if (!lastRequestPreview) return null;
    const s = lastRequestPreview.systemPrompt;
    const start = '---RELEVANT CONTEXT---';
    const end = '---END CONTEXT---';
    const startIdx = s.indexOf(start);
    const endIdx = s.indexOf(end);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      return { before: s, context: null as string | null, after: '' };
    }
    const before = s.slice(0, startIdx).trimEnd();
    const context = s.slice(startIdx + start.length, endIdx).trim();
    const after = s.slice(endIdx + end.length).trimStart();
    return { before, context, after };
  }, [lastRequestPreview]);

  // TTS playback state for generated ghost text
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [isTtsLoading, setIsTtsLoading] = useState(false);
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsCurrentTime, setTtsCurrentTime] = useState(0);
  const [ttsDuration, setTtsDuration] = useState(0);
  const [ttsPlaybackRate, setTtsPlaybackRate] = useState(1);
  const [autoGenerateTts, setAutoGenerateTts] = useState(true);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortControllerRef = useRef<AbortController | null>(null);
  const ttsUnlockedRef = useRef(false);
  const ttsAutoplayRequestedRef = useRef(false);
  
  // Saved completion popup state
  const [savedCompletionPopup, setSavedCompletionPopup] = useState<{ isOpen: boolean; pos: number | null; content: string }>({
    isOpen: false,
    pos: null,
    content: ''
  });
  
  // Editor styling controls (desktop only - mobile uses hardcoded values)
  const [lineHeight] = useState(1.6);
  const [horizontalPadding] = useState(2); // in rem
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768;
    }
    return false;
  });
  
  // Refs for direct DOM manipulation to avoid re-renders during scroll/resize
  const fabContainerRef = useRef<HTMLDivElement>(null);
  const leftToggleRef = useRef<HTMLButtonElement>(null);
  const statusIndicatorRef = useRef<HTMLDivElement>(null);
  const mobileKeyboardScrollAnchorRef = useRef(0);
  const mobileKeyboardScrollSuppressUntilRef = useRef(0);
  const mobileKeyboardPendingAnchorRef = useRef(0);
  const mobileKeyboardPendingAtRef = useRef(0);
  
  // Track if component is mounted (for portal SSR safety)
  const [isMounted, setIsMounted] = useState(false);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Set mounted state for portal SSR safety
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isAddModelOpen) return;
    setNewModelError(null);
    const t = window.setTimeout(() => newModelInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [isAddModelOpen]);

  useEffect(() => {
    if (!isMentalReminderOpen) return;
    setMentalReminderNow(new Date());
    const id = window.setInterval(() => setMentalReminderNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [isMentalReminderOpen]);

  const selectEditorModel = useCallback((id: ModelId) => {
    setSelectedModel(id);
    void authFetch('/api/editor-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedModelId: id }),
    }).catch(() => {
      // ignore
    });
  }, []);

  const addOpenRouterModel = useCallback(async () => {
    const id = newModelId.trim();
    if (!id) {
      setNewModelError('Model id is required');
      return;
    }

    try {
      const response = await authFetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: id, description: 'Custom OpenRouter model' }),
      });
      const data = (await response.json().catch(() => ({}))) as { models?: ModelConfig[]; error?: string };
      if (!response.ok) {
        setNewModelError(data.error || 'Failed to add model');
        return;
      }
      if (Array.isArray(data.models)) setAllModels(data.models);
      selectEditorModel(id);
      setIsAddModelOpen(false);
      setNewModelId('');
      setNewModelError(null);
    } catch (e) {
      setNewModelError(e instanceof Error ? e.message : 'Failed to add model');
    }
  }, [newModelId, selectEditorModel]);

  // Handle Visual Viewport updates for sticky positioning
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const viewport = window.visualViewport;
    
    const updatePositions = () => {
      // Use offsetTop to keep elements pinned to the top of the visual viewport
      // This handles the case where the layout viewport scrolls or the keyboard
      // pushes content but we want these controls to stay "sticky" to the glass
      const topOffset = viewport.offsetTop;
      const baseTop = 32;

      if (leftToggleRef.current) {
        leftToggleRef.current.style.top = `${topOffset + baseTop}px`;
      }

      // Update Status Indicator (Completion Bar)
      if (statusIndicatorRef.current) {
        statusIndicatorRef.current.style.top = `${topOffset + 16}px`;
      }

      if (fabContainerRef.current) {
        // For the FAB, we want it top-aligned now, not bottom-aligned
        const fabTop = topOffset + 80; // 80px from top of visual viewport
        fabContainerRef.current.style.top = `${fabTop}px`;
        // Reset bottom to auto to override any previous styles if switching modes
        fabContainerRef.current.style.bottom = 'auto';
      }
    };

    viewport.addEventListener('resize', updatePositions);
    viewport.addEventListener('scroll', updatePositions);
    
    // Initial call
    updatePositions();
    
    return () => {
      viewport.removeEventListener('resize', updatePositions);
      viewport.removeEventListener('scroll', updatePositions);
    };
  }, [isMounted]);

  // We also need to update position when component updates or portal mounts
  useEffect(() => {
    if (typeof window !== 'undefined' && window.visualViewport) {
      const viewport = window.visualViewport;
      const topOffset = viewport.offsetTop;
      const baseTop = 32;
      if (leftToggleRef.current) {
        leftToggleRef.current.style.top = `${topOffset + baseTop}px`;
      }

      if (statusIndicatorRef.current) {
        statusIndicatorRef.current.style.top = `${topOffset + 16}px`;
      }
      
      if (fabContainerRef.current) {
        const fabTop = topOffset + 80;
        fabContainerRef.current.style.top = `${fabTop}px`;
        fabContainerRef.current.style.bottom = 'auto';
      }
    }
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TextStyle,
      FontSize,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      CompletionMark,
      SavedCompletion,
      Bookmark,
      UnsavedUnderline,
    ],
    content: initialContent || '<p>> </p>',
    onUpdate: ({ editor }) => {
      onContentUpdate(editor.getJSON());
    },
    onSelectionUpdate: () => {
       forceUpdate({});
    },
    onTransaction: () => {
       forceUpdate({});
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-screen text-white',
      },
    },
  });

  const underlineLastSavedAtMs = useSaveSyncStore(s => s.lastSavedAtMs);
  const underlineLastErrorAtMs = useSaveSyncStore(s => s.lastError?.atMs ?? null);
  const underlineLastErrorStatus = useSaveSyncStore(s => s.lastError?.status ?? null);

  const unlockToken = useUnlockStore(s => s.unlockToken);

  useEffect(() => {
    if (!editor || typeof window === 'undefined') return;

    const isMobileViewport = () => window.matchMedia('(max-width: 767px)').matches;

    const recordPossibleFocusAnchor = () => {
      if (!isMobileViewport()) return;
      mobileKeyboardPendingAnchorRef.current = window.scrollY;
      mobileKeyboardPendingAtRef.current = Date.now();
    };

    const activateScrollAnchor = () => {
      if (!isMobileViewport()) return;
      const now = Date.now();
      const hasRecentPointerAnchor = now - mobileKeyboardPendingAtRef.current < 1200;
      mobileKeyboardScrollAnchorRef.current = hasRecentPointerAnchor
        ? mobileKeyboardPendingAnchorRef.current
        : window.scrollY;
      mobileKeyboardScrollSuppressUntilRef.current = now + 700;
    };

    const cancelScrollAnchor = () => {
      mobileKeyboardScrollSuppressUntilRef.current = 0;
    };

    const restoreAnchoredScroll = () => {
      if (!isMobileViewport()) return;
      if (Date.now() > mobileKeyboardScrollSuppressUntilRef.current) return;

      const target = mobileKeyboardScrollAnchorRef.current;
      if (Math.abs(window.scrollY - target) > 1) {
        window.scrollTo(window.scrollX, target);
      }
    };

    const restoreForAFewFrames = () => {
      restoreAnchoredScroll();
      let frames = 0;
      const tick = () => {
        frames += 1;
        restoreAnchoredScroll();
        if (frames < 8 && Date.now() <= mobileKeyboardScrollSuppressUntilRef.current) {
          window.requestAnimationFrame(tick);
        }
      };
      window.requestAnimationFrame(tick);
    };

    const activateAndRestoreForAFewFrames = () => {
      activateScrollAnchor();
      restoreForAFewFrames();
    };

    const editorEl = editor.view.dom;
    const viewport = window.visualViewport;

    editorEl.addEventListener('pointerdown', recordPossibleFocusAnchor, { passive: true });
    editorEl.addEventListener('touchstart', recordPossibleFocusAnchor, { passive: true });
    editorEl.addEventListener('touchmove', cancelScrollAnchor, { passive: true });
    editorEl.addEventListener('wheel', cancelScrollAnchor, { passive: true });
    editorEl.addEventListener('focusin', activateAndRestoreForAFewFrames);
    editorEl.addEventListener('focusout', activateAndRestoreForAFewFrames);
    viewport?.addEventListener('resize', restoreForAFewFrames);
    viewport?.addEventListener('scroll', restoreForAFewFrames);
    window.addEventListener('touchmove', cancelScrollAnchor, { passive: true });
    window.addEventListener('wheel', cancelScrollAnchor, { passive: true });

    return () => {
      editorEl.removeEventListener('pointerdown', recordPossibleFocusAnchor);
      editorEl.removeEventListener('touchstart', recordPossibleFocusAnchor);
      editorEl.removeEventListener('touchmove', cancelScrollAnchor);
      editorEl.removeEventListener('wheel', cancelScrollAnchor);
      editorEl.removeEventListener('focusin', activateAndRestoreForAFewFrames);
      editorEl.removeEventListener('focusout', activateAndRestoreForAFewFrames);
      viewport?.removeEventListener('resize', restoreForAFewFrames);
      viewport?.removeEventListener('scroll', restoreForAFewFrames);
      window.removeEventListener('touchmove', cancelScrollAnchor);
      window.removeEventListener('wheel', cancelScrollAnchor);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(UnsavedUnderlinePluginKey, { recompute: true }));
  }, [editor, unlockToken, underlineLastSavedAtMs, underlineLastErrorAtMs, underlineLastErrorStatus]);

  useEffect(() => {
    if (!editor) return;

    const onConnectivityChange = () => {
      editor.view.dispatch(editor.state.tr.setMeta(UnsavedUnderlinePluginKey, { recompute: true }));
    };

    window.addEventListener('online', onConnectivityChange);
    window.addEventListener('offline', onConnectivityChange);
    return () => {
      window.removeEventListener('online', onConnectivityChange);
      window.removeEventListener('offline', onConnectivityChange);
    };
  }, [editor]);

  // Get effective values (mobile uses hardcoded tight values)
  const effectiveLineHeight = isMobile ? 1.0 : lineHeight;
  const effectiveHorizontalPadding = isMobile ? 0.15 : horizontalPadding;

  // Update editor styles when controls change
  useEffect(() => {
    if (editor) {
      // On mobile, don't apply inline styles - let CSS handle it
      const styleAttr = isMobile 
        ? '' 
        : `line-height: ${effectiveLineHeight}; padding: 2rem ${effectiveHorizontalPadding}rem;`;
      
      editor.setOptions({
        editorProps: {
          attributes: {
            class: `prose prose-invert max-w-none focus:outline-none min-h-screen text-white ${isMobile ? 'mobile-editor' : ''}`,
            style: styleAttr,
          },
        },
      });
    }
  }, [editor, effectiveLineHeight, effectiveHorizontalPadding, isMobile]);

  // Fetch balance from OpenRouter
  const fetchBalance = useCallback(async () => {
    setIsLoadingBalance(true);
    try {
      const response = await authFetch('/api/balance');
      if (response.ok) {
        const data = await response.json();
        setBalanceInfo(data);
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    } finally {
      setIsLoadingBalance(false);
    }
  }, []);

  const fetchGroqBalance = useCallback(async () => {
    setIsLoadingGroqBalance(true);
    try {
      const response = await authFetch('/api/groq-balance');
      if (response.ok) {
        const data = await response.json();
        setGroqBalanceInfo(data);
      }
    } catch (error) {
      console.error('Failed to fetch Groq balance:', error);
    } finally {
      setIsLoadingGroqBalance(false);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const response = await authFetch('/api/models');
      if (response.ok) {
        const data = (await response.json()) as { models?: ModelConfig[] };
        if (Array.isArray(data.models)) setAllModels(data.models);
        const pricingMap: ModelPricingMap = {};
        for (const model of data.models || []) {
          if (model.pricing) pricingMap[model.id] = model.pricing;
        }
        setModelPricing(pricingMap);
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  }, []);

  // Fetch prompts from database
  const fetchPrompts = useCallback(async () => {
    try {
      const response = await authFetch('/api/prompts');
      if (response.ok) {
        const data = await response.json();
        setCustomPrompt(data.customPrompt);
        setRegenPromptTemplate(data.regenPromptTemplate);
        if (typeof data.focusPrompt === 'string') {
          setFocusPrompt(data.focusPrompt);
        }
        if (typeof data.focusColorRules === 'string') {
          try {
            const parsed = JSON.parse(data.focusColorRules) as Record<string, unknown>;
            const nextRules = { ...DEFAULT_FOCUS_COLOR_RULES };
            for (const { color } of FOCUS_COLORS) {
              if (typeof parsed[color] === 'string') nextRules[color] = parsed[color] as string;
            }
            setFocusColorRules(nextRules);
          } catch {
            setFocusColorRules(DEFAULT_FOCUS_COLOR_RULES);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch prompts:', error);
    } finally {
      setPromptsLoaded(true);
    }
  }, []);

  const fetchEditorSettings = useCallback(async () => {
    try {
      const response = await authFetch('/api/editor-settings');
      if (!response.ok) return;
      const data = (await response.json()) as { useRagContext?: unknown; completionAudio?: unknown; selectedModelId?: unknown };

      if (typeof data.useRagContext === 'boolean') {
        useRagContextRef.current = data.useRagContext;
        setUseRagContext(data.useRagContext);
      }

      if (typeof data.completionAudio === 'boolean') {
        setAutoGenerateTts(data.completionAudio);
      }

      if (typeof data.selectedModelId === 'string' && data.selectedModelId.trim()) {
        setSelectedModel(data.selectedModelId.trim());
      }
    } catch {
      // ignore
    }
  }, []);

  const savePrompts = useMemo(() => {
    return debounce(async (prompt: string, regenTemplate: string, nextFocusPrompt: string, nextFocusColorRules: Record<string, string>) => {
      try {
        await authFetch('/api/prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPrompt: prompt,
            regenPromptTemplate: regenTemplate,
            focusPrompt: nextFocusPrompt,
            focusColorRules: JSON.stringify(nextFocusColorRules),
          }),
        });
      } catch (error) {
        console.error('Failed to save prompts:', error);
      }
    }, 1000);
  }, []);

  const fetchRagTopK = useCallback(async () => {
    try {
      const response = await authFetch('/api/rag-topk');
      if (!response.ok) return;
      const data = (await response.json()) as { topK?: unknown };
      const raw = data?.topK;
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n >= 1) {
        const v = Math.min(50, Math.max(1, Math.trunc(n)));
        setRagTopK(v);
        setRagTopKDraft(String(v));
      } else {
        setRagTopK(3);
        setRagTopKDraft('3');
      }
    } catch {
      // ignore
    } finally {
      setRagTopKLoaded(true);
    }
  }, []);

  const saveRagTopK = useMemo(() => {
    return debounce(async (topK: number) => {
      try {
        const response = await authFetch('/api/rag-topk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topK }),
        });
        if (!response.ok) return;
        const data = (await response.json().catch(() => ({}))) as { topK?: unknown };
        const raw = data?.topK;
        const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
        if (Number.isFinite(n) && n >= 1) {
          const v = Math.min(50, Math.max(1, Math.trunc(n)));
          setRagTopK(v);
          setRagTopKDraft(String(v));
          setRagTopKDirty(false);
        }
      } catch {
        // ignore
      }
    }, 600);
  }, []);

  useEffect(() => {
    return () => {
      savePrompts.cancel();
      saveRagTopK.cancel();
    };
  }, [savePrompts, saveRagTopK]);

  useEffect(() => {
    if (ragTopKLoaded && ragTopKDirty) {
      saveRagTopK(ragTopK);
    }
  }, [ragTopK, ragTopKLoaded, ragTopKDirty, saveRagTopK]);

  // Fetch RAG embedding status
  const fetchRagStatus = useCallback(async (modelOverride?: string) => {
    const modelId = modelOverride || embeddingModelId;
    try {
      const response = await authFetch(`/api/embeddings?modelId=${encodeURIComponent(modelId)}`);
      if (response.ok) {
        const data = await response.json();
        setRagStatus(data as { embeddingModelId: string; availableEmbeddingModels: string[]; percentage: number; totalChunks: number; embeddedChunks: number; needsUpdate: boolean });
      }
    } catch (error) {
      console.error('Failed to fetch RAG status:', error);
    }
  }, [embeddingModelId]);

  // Embed document chunks
  const embedDocument = useCallback(async () => {
    setIsEmbedding(true);
    setEmbeddingError(null);
    try {
      const response = await authFetch(`/api/embeddings?modelId=${encodeURIComponent(embeddingModelId)}`, { method: 'POST' });
      if (response.ok) {
        await fetchRagStatus(embeddingModelId);
      } else {
        const data = await response.json();
        setEmbeddingError(data.error || 'Failed to embed');
      }
    } catch {
      setEmbeddingError('Failed to embed document');
    } finally {
      setIsEmbedding(false);
    }
  }, [fetchRagStatus, embeddingModelId]);

  const registerEmbeddingModel = useCallback(async () => {
    const id = newEmbeddingModelId.trim();
    if (!id) {
      setEmbeddingModelError('Model id is required');
      return;
    }
    setEmbeddingModelError(null);
    try {
      const response = await authFetch('/api/embeddings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: id }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error((data as { error?: string }).error || 'Failed to add model');
      }
      setEmbeddingModelId(id);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_EMBEDDING_MODEL_KEY, id);
      }
      setIsAddEmbeddingModelOpen(false);
      setNewEmbeddingModelId('');
      await fetchRagStatus(id);
    } catch (e: unknown) {
      const msg =
        (typeof (e as { message?: unknown })?.message === 'string' && (e as { message: string }).message) ||
        'Failed to add model';
      setEmbeddingModelError(msg);
    }
  }, [newEmbeddingModelId, fetchRagStatus]);

  const deleteEmbeddingsForModel = useCallback(async () => {
    const ok = typeof window === 'undefined' ? false : window.confirm(`Delete all embeddings for model:\n\n${embeddingModelId}\n\nThis cannot be undone.`);
    if (!ok) return;
    setEmbeddingError(null);
    try {
      const response = await authFetch(`/api/embeddings?modelId=${encodeURIComponent(embeddingModelId)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error || 'Failed to delete embeddings');
      }
      await fetchRagStatus(embeddingModelId);
    } catch (e: unknown) {
      const msg =
        (typeof (e as { message?: unknown })?.message === 'string' && (e as { message: string }).message) ||
        'Failed to delete embeddings';
      setEmbeddingError(msg);
    }
  }, [embeddingModelId, fetchRagStatus]);

  const cleanupTtsAudio = useCallback(() => {
    if (ttsAbortControllerRef.current) {
      ttsAbortControllerRef.current.abort();
      ttsAbortControllerRef.current = null;
    }

    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = '';
    }

    if (ttsAudioUrl) {
      URL.revokeObjectURL(ttsAudioUrl);
    }

    setTtsAudioUrl(null);
    setIsTtsLoading(false);
    setIsTtsPlaying(false);
    setTtsError(null);
  }, [ttsAudioUrl]);

  const toggleCompletionAudio = useCallback(() => {
    setAutoGenerateTts((v) => {
      const next = !v;
      if (!next) cleanupTtsAudio();

      // Persist in data.db
      void authFetch('/api/editor-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completionAudio: next }),
      }).catch(() => {
        // ignore
      });

      return next;
    });
  }, [cleanupTtsAudio]);

  const unlockTtsAudio = useCallback(async () => {
    if (ttsUnlockedRef.current) return;
    try {
      const silentAudio = new Audio(SILENT_WAV_DATA_URL);
      silentAudio.muted = true;
      silentAudio.volume = 0;
      silentAudio.setAttribute('playsinline', 'true');
      await silentAudio.play();
      silentAudio.pause();
      silentAudio.currentTime = 0;
      ttsUnlockedRef.current = true;
    } catch {
      // Best-effort unlock; some browsers may still block autoplay.
    }
  }, []);

  const generateTtsForCompletion = useCallback(async (text: string) => {
    if (!text || !text.trim()) return;

    cleanupTtsAudio();
    setIsTtsLoading(true);
    setTtsError(null);
    setIsTtsPlaying(false);

    const controller = new AbortController();
    ttsAbortControllerRef.current = controller;

    try {
      const response = await authFetch('/api/generation-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to generate audio');
      }

      const contentType = response.headers.get('Content-Type') || 'audio/wav';
      const buffer = await response.arrayBuffer();

      if (!buffer || buffer.byteLength === 0) {
        throw new Error('Received empty audio');
      }

      const blob = new Blob([buffer], { type: contentType });
      const url = URL.createObjectURL(blob);

      setTtsCurrentTime(0);
      setTtsDuration(0);
      ttsAutoplayRequestedRef.current = true;
      setTtsAudioUrl(url);
    } catch (error: unknown) {
      const name = (error as { name?: unknown })?.name;
      if (name === 'AbortError') return;
      const message =
        (typeof (error as { message?: unknown })?.message === 'string' && (error as { message: string }).message) ||
        'Failed to generate audio';
      setTtsError(message);
    } finally {
      setIsTtsLoading(false);
      if (ttsAbortControllerRef.current === controller) {
        ttsAbortControllerRef.current = null;
      }
    }
  }, [cleanupTtsAudio]);

  useEffect(() => {
    const audio = ttsAudioRef.current;
    if (!audio || !ttsAudioUrl || !completion.isActive) return;

    audio.playbackRate = ttsPlaybackRate;
    audio.currentTime = 0;

    if (!ttsAutoplayRequestedRef.current) return;
    ttsAutoplayRequestedRef.current = false;

    const attemptPlay = async () => {
      try {
        await audio.play();
        setIsTtsPlaying(true);
        setTtsError(null);
      } catch {
        setIsTtsPlaying(false);
        setTtsError('Autoplay blocked. Press play to listen.');
      }
    };

    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      void attemptPlay();
      return;
    }

    const onCanPlay = () => {
      void attemptPlay();
    };

    audio.addEventListener('canplay', onCanPlay, { once: true });
    return () => {
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, [ttsAudioUrl, ttsPlaybackRate, completion.isActive]);

  const toggleTtsPlayback = useCallback(async () => {
    if (!ttsAudioRef.current || !ttsAudioUrl) return;

    if (isTtsPlaying) {
      ttsAudioRef.current.pause();
      setIsTtsPlaying(false);
      return;
    }

    try {
      ttsAudioRef.current.playbackRate = ttsPlaybackRate;
      await ttsAudioRef.current.play();
      setIsTtsPlaying(true);
      setTtsError(null);
    } catch {
      setTtsError('Playback failed. Please try again.');
    }
  }, [isTtsPlaying, ttsAudioUrl, ttsPlaybackRate]);

  const cycleTtsPlaybackRate = useCallback(() => {
    const rates = [1, 1.5, 2, 2.5];
    const idx = rates.indexOf(ttsPlaybackRate);
    const next = rates[(idx + 1) % rates.length];
    setTtsPlaybackRate(next);
    if (ttsAudioRef.current) {
      ttsAudioRef.current.playbackRate = next;
    }
  }, [ttsPlaybackRate]);

  const skipTtsBackward = useCallback(() => {
    if (!ttsAudioRef.current) return;
    ttsAudioRef.current.currentTime = Math.max(0, ttsAudioRef.current.currentTime - 5);
  }, []);

  const skipTtsForward = useCallback(() => {
    if (!ttsAudioRef.current) return;
    ttsAudioRef.current.currentTime = Math.min(ttsAudioRef.current.duration || 0, ttsAudioRef.current.currentTime + 5);
  }, []);

  const handleTtsSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!ttsAudioRef.current) return;
    const time = parseFloat(e.target.value);
    ttsAudioRef.current.currentTime = time;
    setTtsCurrentTime(time);
  }, []);

  // Fetch balance, pricing, and prompts on mount
  useEffect(() => {
    fetchBalance();
    fetchGroqBalance();
    fetchModels();
    fetchPrompts();
    fetchEditorSettings();
    fetchRagStatus();
    fetchRagTopK();
  }, [fetchBalance, fetchGroqBalance, fetchModels, fetchPrompts, fetchEditorSettings, fetchRagStatus, fetchRagTopK]);

  // Load selected embedding model from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(STORAGE_EMBEDDING_MODEL_KEY);
    if (saved && saved.trim()) {
      setEmbeddingModelId(saved.trim());
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_EMBEDDING_MODEL_KEY, embeddingModelId);
  }, [embeddingModelId]);

  useEffect(() => {
    // refresh status when the selected embedding model changes
    void fetchRagStatus(embeddingModelId);
  }, [embeddingModelId, fetchRagStatus]);

  useEffect(() => {
    const audio = ttsAudioRef.current;
    return () => {
      if (ttsAbortControllerRef.current) {
        ttsAbortControllerRef.current.abort();
      }
      audio?.pause();
    };
  }, []);

  useEffect(() => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.playbackRate = ttsPlaybackRate;
    }
  }, [ttsPlaybackRate]);

  // Save prompts when they change (after initial load)
  useEffect(() => {
    if (promptsLoaded) {
      savePrompts(customPrompt, regenPromptTemplate, focusPrompt, focusColorRules);
    }
  }, [customPrompt, regenPromptTemplate, focusPrompt, focusColorRules, promptsLoaded, savePrompts]);

  // Build regeneration prompt from template
  const buildRegenPrompt = useCallback((attempts: string[]) => {
    const attemptsText = attempts
      .map((attempt, idx) => `Attempt ${idx + 1}: ${attempt}`)
      .join('\n');

    return regenPromptTemplate
      .replace('{{ATTEMPTS}}', attemptsText)
      .replace('{{ORIGINAL_PROMPT}}', customPrompt);
  }, [regenPromptTemplate, customPrompt]);

  const getTextForCompletion = useCallback(() => {
    if (!editor) return '';

    const cursorPos = editor.state.selection.anchor;
    let textUpToCursor = editor.state.doc.textBetween(0, cursorPos, '\n', '\n');

    // Trim trailing spaces to treat "word " same as "word"
    textUpToCursor = textUpToCursor.trimEnd();

    // If there's no meaningful content (just the cursor prompt or empty), return a prompt
    if (!textUpToCursor || textUpToCursor.trim() === '>>' || textUpToCursor.trim().length < 3) {
      return 'Begin';
    }

    // Find the last period or newline
    const lastPeriod = textUpToCursor.lastIndexOf('.');
    const lastNewline = textUpToCursor.lastIndexOf('\n');
    const lastBreak = Math.max(lastPeriod, lastNewline);

    // Get text from last break to cursor, or all text if no break found
    const textForCompletion = lastBreak >= 0
      ? textUpToCursor.slice(lastBreak + 1).trim()
      : textUpToCursor.trim();

    // If text is empty after trimming, use "Begin"
    if (!textForCompletion || textForCompletion.length < 3) {
      return 'Begin';
    }

    return textForCompletion;
  }, [editor]);

  const getFocusTextContext = useCallback((): FocusTextContext | null => {
    if (!editor) return null;

    const cursorPos = editor.state.selection.anchor;
    const text = getTextForCompletion();
    if (!text || text === 'Begin') return null;

    const textUpToCursor = editor.state.doc.textBetween(0, cursorPos, '\n', '\n').trimEnd();
    if (!textUpToCursor.includes(text)) return null;

    const textNodes: FocusTextNode[] = [];
    editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
      if (!node.isText || !node.text) return true;
      if (pos >= cursorPos) return false;
      const clippedText = node.text.slice(0, Math.max(0, Math.min(node.text.length, cursorPos - pos)));
      if (clippedText) {
        const colors = node.marks
          .map(mark => mark.type.name === 'textStyle' && typeof mark.attrs.color === 'string' ? mark.attrs.color.toLowerCase() : null)
          .filter((color): color is string => color !== null);
        textNodes.push({ text: clippedText, from: pos, to: pos + clippedText.length, colors });
      }
      return true;
    });

    const flatText = textNodes.map(node => node.text).join('');
    const flatStart = flatText.lastIndexOf(text);
    if (flatStart < 0) return null;

    return {
      text,
      flatStart,
      flatEnd: flatStart + text.length,
      textNodes,
    };
  }, [editor, getTextForCompletion]);

  const mapFocusContextRangeToDocRanges = useCallback((context: FocusTextContext, fromOffset: number, toOffset: number) => {
    const ranges: Array<{ from: number; to: number }> = [];
    let cursor = 0;
    for (const node of context.textNodes) {
      const nodeStart = cursor;
      const nodeEnd = cursor + node.text.length;
      cursor = nodeEnd;
      if (nodeEnd <= fromOffset || nodeStart >= toOffset) continue;
      const from = node.from + Math.max(0, fromOffset - nodeStart);
      const to = node.from + Math.min(node.text.length, toOffset - nodeStart);
      if (from < to) ranges.push({ from, to });
    }
    return ranges;
  }, []);

  const hasFocusTextColor = useCallback((context: FocusTextContext) => {
    let cursor = 0;
    for (const node of context.textNodes) {
      const nodeStart = cursor;
      const nodeEnd = cursor + node.text.length;
      cursor = nodeEnd;
      if (nodeEnd <= context.flatStart || nodeStart >= context.flatEnd) continue;
      if (node.colors.length > 0) return true;
    }
    return false;
  }, []);

  const clearFocusTextColor = useCallback((context: FocusTextContext) => {
    if (!editor) return 0;
    const ranges = mapFocusContextRangeToDocRanges(context, context.flatStart, context.flatEnd);
    if (ranges.length === 0) return 0;

    const originalSelection = editor.state.selection;
    let chain = editor.chain().focus();
    for (const range of ranges) {
      chain = chain.setTextSelection({ from: range.from, to: range.to }).unsetColor();
    }
    chain.setTextSelection(originalSelection.from).run();
    return ranges.length;
  }, [editor, mapFocusContextRangeToDocRanges]);

  const applyFocusHighlights = useCallback((highlights: FocusHighlight[]) => {
    const context = getFocusTextContext();
    if (!editor || !context || highlights.length === 0) return 0;

    const ranges: Array<{ from: number; to: number; color: string }> = [];
    const flatText = context.textNodes.map(node => node.text).join('');

    for (const highlight of highlights) {
      const phrase = highlight.text.trim();
      if (!phrase) continue;
      let searchFrom = context.flatStart;
      while (searchFrom < context.flatEnd) {
        const index = flatText.indexOf(phrase, searchFrom);
        if (index < 0 || index >= context.flatEnd) break;
        const end = index + phrase.length;
        if (end <= context.flatEnd) {
          for (const range of mapFocusContextRangeToDocRanges(context, index, end)) {
            ranges.push({ ...range, color: highlight.color });
          }
        }
        searchFrom = end;
      }
    }

    if (ranges.length === 0) return 0;

    const originalSelection = editor.state.selection;
    let chain = editor.chain().focus();
    for (const range of ranges) {
      chain = chain.setTextSelection({ from: range.from, to: range.to }).setColor(range.color);
    }
    chain.setTextSelection(originalSelection.from).run();
    return ranges.length;
  }, [editor, getFocusTextContext, mapFocusContextRangeToDocRanges]);

  // Loader position state
  const [loaderPosition, setLoaderPosition] = useState<{ top: number; left: number } | null>(null);

  // Get cursor coordinates for loader positioning
  const getCursorCoords = useCallback(() => {
    if (!editor) return null;
    const { from } = editor.state.selection;
    const coords = editor.view.coordsAtPos(from);
    const editorRect = editor.view.dom.getBoundingClientRect();
    return {
      top: coords.top - editorRect.top + editor.view.dom.scrollTop,
      left: coords.left - editorRect.left,
    };
  }, [editor]);

  const handleFocusHighlight = useCallback(async () => {
    if (!editor || isAutoCompleting || isFocusHighlighting) return;
    if (completion.isActive) {
      setFocusHighlightError('Confirm or cancel the active completion first.');
      return;
    }

    const context = getFocusTextContext();
    if (!context) {
      setFocusHighlightError('No current phrase to color.');
      return;
    }

    editor.commands.focus();
    setLastRequestPreview(null);
    setFocusHighlightError(null);

    if (hasFocusTextColor(context)) {
      clearFocusTextColor(context);
      return;
    }

    setIsFocusHighlighting(true);
    setLoaderPosition(getCursorCoords());
    abortControllerRef.current = new AbortController();

    try {
      const colorRules = FOCUS_COLORS
        .map(({ color }) => ({ color, meaning: (focusColorRules[color] || '').trim() }))
        .filter(rule => rule.meaning.length > 0);

      const response = await authFetch('/api/focus-highlight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: context.text,
          modelId: selectedModel,
          prompt: focusPrompt,
          colorRules,
        }),
        signal: abortControllerRef.current.signal,
      });

      const data = await response.json();
      setLoaderPosition(null);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate focus highlights');
      }

      if (data.requestPreview) {
        setLastRequestPreview(data.requestPreview as AutocompleteRequestPreview);
      }

      const appliedCount = applyFocusHighlights(Array.isArray(data.highlights) ? data.highlights : []);
      if (appliedCount === 0) {
        setFocusHighlightError('The model did not return exact words found in the current phrase.');
      }

      if (data.usage && modelPricing[selectedModel]) {
        const pricing = modelPricing[selectedModel];
        const promptCost = (data.usage.promptTokens / 1000000) * pricing.prompt;
        const completionCost = (data.usage.completionTokens / 1000000) * pricing.completion;
        setLastGenerationCost(promptCost + completionCost);
      } else {
        setLastGenerationCost(null);
      }

      fetchBalance();
    } catch (error) {
      setLoaderPosition(null);
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Focus color cancelled');
      } else {
        const message = error instanceof Error ? error.message : 'Failed to generate focus colors';
        setFocusHighlightError(message);
        console.error('Focus color error:', error);
      }
    } finally {
      setIsFocusHighlighting(false);
      abortControllerRef.current = null;
    }
  }, [editor, isAutoCompleting, isFocusHighlighting, completion.isActive, getFocusTextContext, hasFocusTextColor, clearFocusTextColor, getCursorCoords, focusColorRules, selectedModel, focusPrompt, applyFocusHighlights, modelPricing, fetchBalance]);

  const handleAutoComplete = useCallback(async () => {
    if (!editor || isAutoCompleting || isFocusHighlighting) return;

    // Keep editor focused (prevents keyboard from hiding on mobile)
    editor.commands.focus();

    cleanupTtsAudio();
    setLastRequestPreview(null);
    unlockTtsAudio();

    const text = getTextForCompletion();

    setIsAutoCompleting(true);
    setAutoCompleteError(null);

    // Show loading indicator at cursor position
    setLoaderPosition(getCursorCoords());

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      const response = await authFetch('/api/autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          modelId: selectedModel,
          prompt: customPrompt,
          useRagContext: useRagContextRef.current,
          embeddingModelId,
        }),
        signal: abortControllerRef.current.signal,
      });

      const data = await response.json();

      // Hide loading indicator
      setLoaderPosition(null);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get completion');
      }

      if (data.requestPreview) {
        setLastRequestPreview(data.requestPreview as AutocompleteRequestPreview);
      }

      if (data.completion && editor) {
        const completionText = data.completion.trim();
        const words = completionText.split(/\s+/).filter((w: string) => w.length > 0);
        
        if (words.length > 0) {
          const from = editor.state.selection.from;
          
          // Check if character before cursor is a space (to avoid double spaces)
          const textBeforeCursor = editor.state.doc.textBetween(0, from);
          const needsSpace = textBeforeCursor.length > 0 && !textBeforeCursor.endsWith(' ');
          const textToInsert = (needsSpace ? ' ' : '') + completionText;
          
          // Insert the completion text with the mark
          editor
            .chain()
            .focus()
            .insertContent(textToInsert)
            .setTextSelection({ from, to: from + textToInsert.length })
            .setCompletionMark()
            .setTextSelection(from)  // Cursor at start of generated text
            .run();
          
          completionTextRef.current = textToInsert;
          
          setCompletion({
            isActive: true,
            words,
            selectedCount: 0,
            range: { from, to: from + textToInsert.length },
          });
          
          // Calculate and store the generation cost
          if (data.usage && modelPricing[selectedModel]) {
            const pricing = modelPricing[selectedModel];
            const promptCost = (data.usage.promptTokens / 1000000) * pricing.prompt;
            const completionCost = (data.usage.completionTokens / 1000000) * pricing.completion;
            setLastGenerationCost(promptCost + completionCost);
          } else {
            setLastGenerationCost(null);
          }

          if (autoGenerateTts) {
            generateTtsForCompletion(completionText);
          }
        }
      }
      
      // Refresh balance after successful generation
      fetchBalance();
    } catch (error) {
      setLoaderPosition(null);
      // Don't show error for aborted requests
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Generation cancelled');
      } else {
        const message = error instanceof Error ? error.message : 'Failed to get completion';
        setAutoCompleteError(message);
        console.error('Auto-complete error:', error);
      }
    } finally {
      setIsAutoCompleting(false);
      abortControllerRef.current = null;
    }
  }, [editor, isAutoCompleting, isFocusHighlighting, getTextForCompletion, selectedModel, customPrompt, embeddingModelId, fetchBalance, modelPricing, getCursorCoords, cleanupTtsAudio, generateTtsForCompletion, unlockTtsAudio, autoGenerateTts]);

  // Handle regeneration when Tab is pressed with no words selected
  const handleRegenerate = useCallback(async () => {
    if (!editor || isAutoCompleting || isFocusHighlighting || !completion.isActive || !completion.range) return;
    
    // Keep editor focused (prevents keyboard from hiding on mobile)
    editor.commands.focus();

    cleanupTtsAudio();
    setLastRequestPreview(null);
    unlockTtsAudio();

    // Get the current ghost text before removing it
    const currentCompletionText = completionTextRef.current.trim();
    
    // Add current completion to attempts
    const newAttempts = [...attemptHistory.attempts, currentCompletionText];
    setAttemptHistory({ attempts: newAttempts });

    // Remove the current ghost text
    const { from, to } = completion.range;
    editor.chain().focus().setTextSelection({ from, to }).deleteSelection().run();

    setIsAutoCompleting(true);
    setAutoCompleteError(null);

    // Show loading indicator at cursor position
    setLoaderPosition(getCursorCoords());

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      const text = getTextForCompletion();
      const regenPrompt = buildRegenPrompt(newAttempts);

      const response = await authFetch('/api/autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          modelId: selectedModel,
          prompt: regenPrompt,
          useRagContext: useRagContextRef.current,
          embeddingModelId,
        }),
        signal: abortControllerRef.current.signal,
      });

      const data = await response.json();

      // Hide loading indicator
      setLoaderPosition(null);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get completion');
      }

      if (data.requestPreview) {
        setLastRequestPreview(data.requestPreview as AutocompleteRequestPreview);
      }

      if (data.completion && editor) {
        const completionText = data.completion.trim();
        const words = completionText.split(/\s+/).filter((w: string) => w.length > 0);
        
        if (words.length > 0) {
          const insertFrom = editor.state.selection.from;
          
          // Check if character before cursor is a space (to avoid double spaces)
          const textBeforeCursor = editor.state.doc.textBetween(0, insertFrom);
          const needsSpace = textBeforeCursor.length > 0 && !textBeforeCursor.endsWith(' ');
          const textToInsert = (needsSpace ? ' ' : '') + completionText;
          
          editor
            .chain()
            .focus()
            .insertContent(textToInsert)
            .setTextSelection({ from: insertFrom, to: insertFrom + textToInsert.length })
            .setCompletionMark()
            .setTextSelection(insertFrom)  // Cursor at start of generated text
            .run();
          
          completionTextRef.current = textToInsert;
          
          setCompletion({
            isActive: true,
            words,
            selectedCount: 0,
            range: { from: insertFrom, to: insertFrom + textToInsert.length },
          });
          
          // Calculate and store the generation cost
          if (data.usage && modelPricing[selectedModel]) {
            const pricing = modelPricing[selectedModel];
            const promptCost = (data.usage.promptTokens / 1000000) * pricing.prompt;
            const completionCost = (data.usage.completionTokens / 1000000) * pricing.completion;
            setLastGenerationCost(promptCost + completionCost);
          } else {
            setLastGenerationCost(null);
          }

          if (autoGenerateTts) {
            generateTtsForCompletion(completionText);
          }
        }
      }
      
      // Refresh balance after successful generation
      fetchBalance();
    } catch (error) {
      setLoaderPosition(null);
      // Don't show error for aborted requests
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Regeneration cancelled');
      } else {
        const message = error instanceof Error ? error.message : 'Failed to regenerate';
        setAutoCompleteError(message);
        console.error('Regenerate error:', error);
      }
    } finally {
      setIsAutoCompleting(false);
      abortControllerRef.current = null;
    }
  }, [editor, isAutoCompleting, isFocusHighlighting, completion, attemptHistory, getTextForCompletion, buildRegenPrompt, selectedModel, embeddingModelId, fetchBalance, modelPricing, getCursorCoords, cleanupTtsAudio, generateTtsForCompletion, unlockTtsAudio, autoGenerateTts]);

  // Cancel ongoing generation
  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoaderPosition(null);
    setIsAutoCompleting(false);
    setIsFocusHighlighting(false);
    cleanupTtsAudio();
    // Keep editor focused (prevents keyboard from hiding on mobile)
    editor?.commands.focus();
  }, [editor, cleanupTtsAudio]);

  const confirmCompletion = useCallback(() => {
    if (!editor || !completion.isActive || !completion.range) return;
    
    // Keep editor focused (prevents keyboard from hiding on mobile)
    editor.commands.focus();

    cleanupTtsAudio();

    const { from, to } = completion.range;
    const selectedWords = completion.words.slice(0, completion.selectedCount);
    
    // Build the text to keep (with leading space if original had one)
    const hasLeadingSpace = completionTextRef.current.startsWith(' ');
    const textToKeep = selectedWords.length > 0 
      ? (hasLeadingSpace ? ' ' : '') + selectedWords.join(' ')
      : '';
    
    // Delete the entire ghost text range
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .deleteSelection()
      .run();
    
    // Insert the selected words as regular text (without any marks)
    if (textToKeep) {
      editor.chain().focus().clearCompletionMark().insertContent(textToKeep).run();
    }
    
    // Ensure mark is fully cleared
    editor.chain().focus().clearCompletionMark().run();
    
    completionTextRef.current = '';
    // Clear attempt history when words are confirmed
    setAttemptHistory({ attempts: [] });
    setCompletion({
      isActive: false,
      words: [],
      selectedCount: 0,
      range: null,
    });
  }, [editor, completion, cleanupTtsAudio]);

  const cancelCompletion = useCallback(() => {
    if (!editor || !completion.isActive || !completion.range) return;
    
    // Keep editor focused (prevents keyboard from hiding on mobile)
    editor.commands.focus();

    cleanupTtsAudio();
    setLastRequestPreview(null);

    const { from, to } = completion.range;
    
    // Delete the ghost text and clear the completion mark to reset styling
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .unsetCompletionMark()
      .deleteSelection()
      .clearCompletionMark()
      .run();
    
    completionTextRef.current = '';
    // Clear attempt history when cancelled
    setAttemptHistory({ attempts: [] });
    setCompletion({
      isActive: false,
      words: [],
      selectedCount: 0,
      range: null,
    });
  }, [editor, completion.isActive, completion.range, cleanupTtsAudio]);

  const saveCompletion = useCallback(() => {
    if (!editor || !completion.isActive || !completion.range) return;
    
    // Keep editor focused (prevents keyboard from hiding on mobile)
    editor.commands.focus();

    cleanupTtsAudio();
    setLastRequestPreview(null);

    const { from, to } = completion.range;
    const selectedWords = completion.words.slice(0, completion.selectedCount);
    
    // Build the text to save (with leading space if original had one)
    const hasLeadingSpace = completionTextRef.current.startsWith(' ');
    const textToSave = selectedWords.length > 0 
      ? (hasLeadingSpace ? ' ' : '') + selectedWords.join(' ')
      : completionTextRef.current;
    
    // Delete the ghost text
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .unsetCompletionMark()
      .deleteSelection()
      .clearCompletionMark()
      .run();
    
    // Insert a saved completion marker using the Tiptap node extension
    editor.commands.insertSavedCompletion(textToSave);
    
    completionTextRef.current = '';
    // Clear attempt history when saved
    setAttemptHistory({ attempts: [] });
    setCompletion({
      isActive: false,
      words: [],
      selectedCount: 0,
      range: null,
    });
  }, [editor, completion, completionTextRef, cleanupTtsAudio]);

  const selectNextWord = useCallback(() => {
    if (!completion.isActive) return;
    
    // Clear attempt history when user starts selecting words
    if (completion.selectedCount === 0 && attemptHistory.attempts.length > 0) {
      setAttemptHistory({ attempts: [] });
    }
    
    setCompletion(prev => ({
      ...prev,
      selectedCount: Math.min(prev.selectedCount + 1, prev.words.length),
    }));
  }, [completion.isActive, completion.selectedCount, attemptHistory.attempts.length]);

  const deselectLastWord = useCallback(() => {
    if (!completion.isActive) return;
    
    setCompletion(prev => ({
      ...prev,
      selectedCount: Math.max(prev.selectedCount - 1, 0),
    }));
  }, [completion.isActive]);

  const selectAllWords = useCallback(() => {
    if (!completion.isActive) return;
    
    // Clear attempt history when user selects all words
    if (attemptHistory.attempts.length > 0) {
      setAttemptHistory({ attempts: [] });
    }
    
    setCompletion(prev => ({
      ...prev,
      selectedCount: prev.words.length,
    }));
  }, [completion.isActive, attemptHistory.attempts.length]);

  // Update visual selection when selectedCount changes
  useEffect(() => {
    if (!editor || !completion.isActive || !completion.range) return;

    const { from, to } = completion.range;
    const selectedWords = completion.words.slice(0, completion.selectedCount);
    
    // Calculate the position where selected words end
    const hasLeadingSpace = completionTextRef.current.startsWith(' ');
    const selectedText = selectedWords.length > 0 
      ? (hasLeadingSpace ? ' ' : '') + selectedWords.join(' ')
      : (hasLeadingSpace ? ' ' : '');
    const splitPos = from + selectedText.length;
    
    // Remove mark from selected portion, keep mark on unselected
    // Position cursor at the selection boundary (splitPos)
    if (splitPos < to) {
      editor.chain()
        .focus()
        .setTextSelection({ from, to })
        .unsetCompletionMark()
        .setTextSelection({ from: splitPos, to })
        .setCompletionMark()
        .setTextSelection(splitPos)  // Cursor follows selection
        .run();
    } else {
      // All words selected - remove all marks, cursor at end
      editor.chain()
        .focus()
        .setTextSelection({ from, to })
        .unsetCompletionMark()
        .setTextSelection(splitPos)  // Cursor at end of selection
        .run();
    }
  }, [editor, completion.isActive, completion.range, completion.selectedCount, completion.words]);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Escape - cancel generation or completion
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isAutoCompleting || isFocusHighlighting) {
          cancelGeneration();
        } else if (completion.isActive) {
          cancelCompletion();
        }
        return;
      }

      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();

        if (!isAutoCompleting && !isFocusHighlighting) {
          handleFocusHighlight();
        }
        return;
      }

      if (completion.isActive) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          selectNextWord();
          return;
        }
        
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          deselectLastWord();
          return;
        }
        
        if (e.key === ' ') {
          e.preventDefault();
          selectAllWords();
          return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          saveCompletion();
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [completion.isActive, isAutoCompleting, isFocusHighlighting, handleFocusHighlight, cancelCompletion, cancelGeneration, selectNextWord, deselectLastWord, selectAllWords, saveCompletion, isMobile, isChatModalOpen]);

  // Handle clicks on saved completion markers
  useEffect(() => {
    const handleSavedCompletionClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const marker = target.closest('[data-saved-completion]') as HTMLElement | null;
      if (!marker || !editor) return;

      e.preventDefault();

      let pos = editor.view.posAtDOM(marker, 0);
      let node = editor.state.doc.nodeAt(pos);

      if (!node || node.type.name !== 'savedCompletion') {
        const altPos = Math.max(0, pos - 1);
        const altNode = editor.state.doc.nodeAt(altPos);
        if (altNode && altNode.type.name === 'savedCompletion') {
          pos = altPos;
          node = altNode;
        }
      }

      if (!node || node.type.name !== 'savedCompletion') return;

      const content = typeof node.attrs?.content === 'string' ? node.attrs.content : '';

      setSavedCompletionPopup({
        isOpen: true,
        pos,
        content,
      });
    };

    if (editor) {
      editor.view.dom.addEventListener('click', handleSavedCompletionClick);
      return () => {
        editor.view.dom.removeEventListener('click', handleSavedCompletionClick);
      };
    }
  }, [editor]);

  useEffect(() => {
    if (editor && initialContent && editor.isEmpty) {
       // Content init logic
    }
  }, [initialContent, editor]);

  const editorDoc = editor?.state.doc ?? null;
  const bookmarks = useMemo(() => {
    if (!editorDoc) return [] as Array<{ id: string; name: string }>;

    const out: Array<{ id: string; name: string }> = [];
    editorDoc.descendants((node) => {
      if (node.type.name !== 'bookmark') return;
      const id = (node.attrs as { id?: unknown })?.id;
      const name = (node.attrs as { name?: unknown })?.name;
      if (typeof id === 'string' && id.trim()) {
        out.push({ id, name: typeof name === 'string' ? name : '' });
      }
    });

    const seen = new Set<string>();
    return out.filter((b) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    });
  }, [editorDoc]);

  if (!editor) {
    return null;
  }

  const toggleLeftSidebar = () => setIsLeftSidebarOpen(v => !v);

  const setLeftSidebarTab = (tab: 'assistant' | 'tools') => {
    setLeftSidebarTabState(tab);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LEFT_SIDEBAR_TAB_STORAGE_KEY, tab);
    }
  };

  const getCurrentFontSizePx = () => {
    const attrs = editor.getAttributes('textStyle') as { fontSize?: unknown };
    const raw = attrs?.fontSize;
    if (typeof raw === 'string') {
      const m = raw.trim().match(/^([0-9]+(?:\.[0-9]+)?)px$/);
      if (m) return Number.parseFloat(m[1]);
    }
    return 16;
  };

  const adjustFontSize = (deltaPx: number) => {
    const current = getCurrentFontSizePx();
    const next = Math.min(72, Math.max(10, Math.round(current + deltaPx)));
    editor.chain().focus().setFontSize(`${next}px`).run();
  };

  const insertStarBlock = () => {
    editor.commands.focus();
    editor.commands.insertSavedCompletion('');
  };

  const applyTextColor = (color: string) => {
    editor.chain().focus().setColor(color).run();
  };

  const makeId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const insertBookmarkTag = () => {
    const name = typeof window === 'undefined' ? '' : (window.prompt('Tag name') ?? '');
    const trimmed = name.trim();
    if (!trimmed) return;
    editor.chain().focus().insertBookmark({ id: makeId(), name: trimmed }).run();
  };

  const scrollToBookmark = (id: string) => {
    const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
    const el = editor.view.dom.querySelector(`[data-bookmark-id="${esc}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const scrollToTop = () => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const dateInputValue = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const timeInputValue = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const getCurrentReminderParts = () => {
    const d = new Date();
    d.setSeconds(0, 0);
    return { date: dateInputValue(d), time: timeInputValue(d), iso: d.toISOString() };
  };

  const clampReminderParts = (dateValue: string, timeValue: string) => {
    const now = new Date();
    now.setSeconds(0, 0);
    const next = new Date(`${dateValue}T${timeValue}`);
    const valid = Number.isNaN(next.getTime()) ? now : next;
    const clamped = valid < now ? now : valid;
    return { date: dateInputValue(clamped), time: timeInputValue(clamped), iso: clamped.toISOString() };
  };

  const getSelectedMentalNoteText = () => {
    const { selection, doc } = editor.state;
    if (selection.empty) return '';
    return doc.textBetween(selection.from, selection.to, '\n', '\n').trim();
  };

  const showMentalNoteSelectionError = () => {
    setMentalNoteSelectionError(true);
    window.setTimeout(() => setMentalNoteSelectionError(false), 1000);
  };

  const openMentalNoteMode = () => {
    if (!getSelectedMentalNoteText()) {
      showMentalNoteSelectionError();
      return;
    }
    setIsMentalNoteModeOpen(open => !open);
  };

  const saveSelectionAsMentalNote = async (reminderAt?: string | null) => {
    const selectedText = getSelectedMentalNoteText();
    if (!selectedText) {
      showMentalNoteSelectionError();
      return;
    }
    const res = await authFetch('/api/mental-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: selectedText, source: 'selection' }),
    });
    if (res.ok) {
      if (reminderAt) {
        const data = (await res.json().catch(() => ({}))) as { note?: { id?: string } };
        if (data.note?.id) {
          await authFetch('/api/mental-notes', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: data.note.id, reminderAt }),
          }).catch(() => {});
        }
      }
      setDidSaveMentalNote(true);
      setIsMentalNoteModeOpen(false);
      setIsMentalReminderOpen(false);
      window.setTimeout(() => setDidSaveMentalNote(false), 1000);
    }
    editor.commands.focus();
  };

  const openMentalReminder = () => {
    const parts = getCurrentReminderParts();
    setMentalReminderDate(parts.date);
    setMentalReminderTime(parts.time);
    setIsMentalNoteModeOpen(false);
    setIsMentalReminderOpen(true);
  };

  const confirmMentalReminder = () => {
    const next = clampReminderParts(mentalReminderDate, mentalReminderTime);
    setMentalReminderDate(next.date);
    setMentalReminderTime(next.time);
    void saveSelectionAsMentalNote(next.iso);
  };

  const closeSavedCompletionPopup = () => {
    const pos = savedCompletionPopup.pos;
    const content = savedCompletionPopup.content;

    if (typeof pos === 'number') {
      const doc = editor.state.doc;
      let node = doc.nodeAt(pos);
      let nodePos = pos;

      if (!node || node.type.name !== 'savedCompletion') {
        const altPos = Math.max(0, pos - 1);
        const altNode = doc.nodeAt(altPos);
        if (altNode && altNode.type.name === 'savedCompletion') {
          node = altNode;
          nodePos = altPos;
        }
      }

      if (node && node.type.name === 'savedCompletion') {
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(nodePos, undefined, {
            ...node.attrs,
            content,
          })
        );
      }
    }

    setSavedCompletionPopup({ isOpen: false, pos: null, content: '' });
    editor.commands.focus();
  };

  return (
    <div className={`flex w-full min-h-screen bg-black text-white relative ${completion.isActive ? 'completion-active' : ''} ${isAutoCompleting || isFocusHighlighting ? 'generating' : ''}`}>
      {/* Completion Mode Indicator - Visible on both mobile and desktop now, positioned via ref on mobile */}
      {completion.isActive && (
        <div 
          ref={statusIndicatorRef}
          className="flex fixed left-1/2 -translate-x-1/2 z-[70] bg-blue-600 text-white px-3 py-2 rounded-lg shadow-lg items-center gap-2 md:gap-3 text-xs md:text-sm max-w-[calc(100%-100px)] md:max-w-none whitespace-nowrap overflow-hidden"
          style={{ top: '1rem' }} // default fallback
        >
          <Sparkles size={16} className="shrink-0" />
          <span className="truncate">
            <strong>{completion.selectedCount}</strong> / {completion.words.length} words
            {attemptHistory.attempts.length > 0 && (
              <span className="text-blue-200 ml-2 hidden md:inline">(attempt {attemptHistory.attempts.length + 1})</span>
            )}
          </span>
          {lastGenerationCost !== null && (
            <>
              <span className="text-blue-200">|</span>
              <span className="text-green-300 font-mono">${lastGenerationCost.toFixed(6)}</span>
            </>
          )}
          {isTtsLoading && (
            <div className="flex items-center gap-1 ml-1">
              <Loader2 size={14} className="animate-spin text-white" />
            </div>
          )}
          {/* Desktop-only shortcuts hints */}
          <div className="hidden md:flex items-center gap-3 ml-2">
            <span className="text-blue-200">|</span>
            <span className="text-blue-200">→ select</span>
            <span className="text-blue-200">← deselect</span>
            <span className="text-green-200">Space all</span>
            {completion.selectedCount === 0 ? (
              <span className="text-yellow-200">Tab regenerate</span>
            ) : (
              <span className="text-blue-200">Tab confirm</span>
            )}
            <span className="text-amber-200">Enter save</span>
            <span className="text-blue-200">Esc cancel</span>
          </div>
        </div>
      )}

      {ttsError && completion.isActive && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[69] text-[11px] md:text-xs text-amber-200 bg-zinc-900 px-2 py-1 rounded border border-amber-500/50 shadow-lg max-md:bottom-20 max-md:top-auto md:top-14 md:bottom-auto">
          {ttsError}
        </div>
      )}

      {/* TTS Audio Control Panel */}
      {ttsAudioUrl && completion.isActive && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[69] bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg px-3 py-2 flex items-center gap-3 max-md:bottom-4 max-md:top-auto max-md:w-[calc(100%-1rem)] max-md:justify-center md:top-14 md:bottom-auto">
          <button
            type="button"
            onClick={skipTtsBackward}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            title="Back 5s"
          >
            <SkipBack size={16} />
          </button>
          <button
            type="button"
            onClick={toggleTtsPlayback}
            className="p-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            title={isTtsPlaying ? 'Pause' : 'Play'}
          >
            {isTtsPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            type="button"
            onClick={cycleTtsPlaybackRate}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors text-xs font-mono"
            title="Playback speed"
          >
            {ttsPlaybackRate}x
          </button>
          <button
            type="button"
            onClick={skipTtsForward}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            title="Forward 5s"
          >
            <SkipForward size={16} />
          </button>
          <div className="flex items-center gap-2 ml-1">
            <span className="text-xs text-zinc-400 w-10 text-right">
              {Math.floor(ttsCurrentTime / 60)}:{String(Math.floor(ttsCurrentTime % 60)).padStart(2, '0')}
            </span>
            <input
              type="range"
              min={0}
              max={ttsDuration || 0}
              step={0.1}
              value={ttsCurrentTime}
              onChange={handleTtsSeek}
              className="w-24 md:w-32 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <span className="text-xs text-zinc-400 w-10">
              {Math.floor(ttsDuration / 60)}:{String(Math.floor(ttsDuration % 60)).padStart(2, '0')}
            </span>
          </div>
          <button
            type="button"
            onClick={cleanupTtsAudio}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition-colors ml-1"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Left Sidebar - AI Assistant */}
      <div 
        className={`fixed top-0 left-0 h-full bg-zinc-900 border-r border-zinc-800 transition-all duration-300 ease-in-out z-[60] ${
          isLeftSidebarOpen ? 'w-72' : 'w-0'
        } overflow-hidden`}
      >
        <div className="p-4 flex flex-col gap-6 w-72 h-full overflow-y-auto">
          <h2 className="text-lg font-semibold text-zinc-400">
            <Sparkles size={18} className="inline mr-2" />
            Panel
          </h2>

          <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-700 bg-zinc-950/60 p-1">
            <button
              type="button"
              onClick={() => setLeftSidebarTab('assistant')}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                leftSidebarTab === 'assistant'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-white'
              }`}
            >
              Assistant
            </button>
            <button
              type="button"
              onClick={() => setLeftSidebarTab('tools')}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                leftSidebarTab === 'tools'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-white'
              }`}
            >
              Tools
            </button>
          </div>

          {leftSidebarTab === 'assistant' && (
            <>

          {/* Primary Focus Highlight */}
          <div className="flex flex-col gap-3 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300 flex items-center gap-2">
                <Palette size={16} />
                FOCUS PROMPT
              </span>
              <button
                type="button"
                onClick={handleFocusHighlight}
                disabled={isFocusHighlighting || isAutoCompleting}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded text-white text-xs font-medium transition-colors cursor-pointer"
                title="Focus color"
              >
                {isFocusHighlighting ? <Loader2 size={14} className="animate-spin" /> : <Split size={14} />}
                Color
              </button>
            </div>
            <textarea
              value={focusPrompt}
              onChange={(e) => setFocusPrompt(e.target.value)}
              rows={4}
              className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 resize-none"
              placeholder="Enter focus prompt..."
            />
            <div className="grid grid-cols-[96px_1fr] gap-2">
              <select
                value={selectedFocusColor}
                onChange={(e) => setSelectedFocusColor(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-2 text-xs text-white focus:outline-none focus:border-zinc-500"
                title="Focus color"
              >
                {FOCUS_COLORS.map(({ color, label }) => (
                  <option key={color} value={color}>{label}</option>
                ))}
              </select>
              <input
                value={focusColorRules[selectedFocusColor] || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setFocusColorRules(prev => ({ ...prev, [selectedFocusColor]: value }));
                }}
                className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-500"
                placeholder="What this text color means..."
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FOCUS_COLORS.filter(({ color }) => (focusColorRules[color] || '').trim()).map(({ color, label }) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedFocusColor(color)}
                  className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition-colors ${
                    selectedFocusColor === color ? 'border-white text-white bg-zinc-700' : 'border-zinc-700 text-zinc-400 bg-zinc-900 hover:text-white'
                  }`}
                  title={focusColorRules[color]}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                  {label}
                </button>
              ))}
            </div>
            {focusHighlightError && (
              <div className="p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
                {focusHighlightError}
              </div>
            )}
            <div className="text-xs text-zinc-500">
              <kbd className="px-1 py-0.5 bg-zinc-700 rounded">Tab</kbd> colors or clears the current phrase.
            </div>
          </div>

          {/* Secondary Auto-complete */}
          <div className="flex flex-col gap-2 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
            <span className="text-sm text-zinc-400">Auto-complete</span>
            <button
              type="button"
              onClick={handleAutoComplete}
              disabled={isAutoCompleting || isFocusHighlighting}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded text-white font-medium transition-colors cursor-pointer border border-zinc-700"
            >
              {isAutoCompleting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  Complete 2 Sentences
                </>
              )}
            </button>
            {autoCompleteError && (
              <div className="p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
                {autoCompleteError}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex flex-col gap-2 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
            <span className="text-sm text-zinc-400">Navigate</span>
            <Link
              href="/audiobooks"
              className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded text-white font-medium transition-colors cursor-pointer"
            >
              <BookOpen size={18} />
              Audiobooks
            </Link>
          </div>
          
          {/* Balance Display */}
          <div className="flex flex-col gap-2 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400 flex items-center gap-2">
                <DollarSign size={16} />
                Balance
              </span>
              <button
                type="button"
                onClick={fetchBalance}
                disabled={isLoadingBalance}
                className="p-1 hover:bg-zinc-700 rounded transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh balance"
              >
                <RefreshCw size={14} className={isLoadingBalance ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="text-xl font-mono text-green-400">
              {balanceInfo ? `$${balanceInfo.balance.toFixed(4)}` : '---'}
            </div>
          </div>

          {/* Groq Balance Display */}
          <div className="flex flex-col gap-2 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400 flex items-center gap-2">
                <DollarSign size={16} />
                Groq
              </span>
              <button
                type="button"
                onClick={fetchGroqBalance}
                disabled={isLoadingGroqBalance}
                className="p-1 hover:bg-zinc-700 rounded transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh Groq balance"
              >
                <RefreshCw size={14} className={isLoadingGroqBalance ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="text-xl font-mono text-green-400">
              {groqBalanceInfo ? `$${groqBalanceInfo.balance.toFixed(4)}` : '---'}
            </div>
            <div className="text-[11px] text-zinc-500">
              Owed: {groqBalanceInfo ? `$${groqBalanceInfo.totalUsage.toFixed(4)}` : '---'} • Credits: {groqBalanceInfo ? `$${groqBalanceInfo.totalCredits.toFixed(4)}` : '---'}
            </div>
          </div>

          {/* RAG Embedding Status */}
          <div className="flex flex-col gap-2 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400 flex items-center gap-2">
                <Database size={16} />
                RAG Embeddings
              </span>
              <button
                type="button"
                onClick={() => { void fetchRagStatus(); }}
                className="p-1 hover:bg-zinc-700 rounded transition-colors cursor-pointer"
                title="Refresh status"
              >
                <RefreshCw size={14} />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex-1">
                <div className="text-[11px] text-zinc-500 mb-1">Embedding model</div>
                <select
                  value={embeddingModelId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setEmbeddingModelId(next);
                    void fetchRagStatus(next);
                  }}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-500 font-mono"
                >
                  {Array.from(new Set([embeddingModelId, ...(ragStatus?.availableEmbeddingModels || [DEFAULT_EMBEDDING_MODEL_ID])]))
                    .filter(Boolean)
                    .map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2 pt-5">
                <button
                  type="button"
                  onClick={() => { setIsAddEmbeddingModelOpen(true); setEmbeddingModelError(null); }}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-200 transition-colors cursor-pointer"
                  title="Add embedding model"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={deleteEmbeddingsForModel}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-red-300 hover:text-red-200 transition-colors cursor-pointer"
                  title="Delete embeddings for this model"
                >
                  Delete
                </button>
              </div>
            </div>
            
            {ragStatus && (
              <>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-zinc-700 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        ragStatus.percentage === 100 ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${ragStatus.percentage}%` }}
                    />
                  </div>
                  <span className={`text-sm font-mono ${
                    ragStatus.percentage === 100 ? 'text-green-400' : 'text-blue-400'
                  }`}>
                    {ragStatus.percentage}%
                  </span>
                </div>
                
                <div className="text-xs text-zinc-500">
                  {ragStatus.embeddedChunks} / {ragStatus.totalChunks} chunks embedded
                </div>

                {ragStatus.needsUpdate && (
                  <button
                    type="button"
                    onClick={embedDocument}
                    disabled={isEmbedding}
                    className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded text-white text-sm font-medium transition-colors cursor-pointer"
                  >
                    {isEmbedding ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Embedding...
                      </>
                    ) : (
                      <>
                        <Database size={14} />
                        Embed New Chunks
                      </>
                    )}
                  </button>
                )}

                {embeddingError && (
                  <div className="text-xs text-red-400 mt-1">{embeddingError}</div>
                )}
              </>
            )}

            <div className="mt-3 border-t border-zinc-700/60 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Use context in prompt</span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={toggleUseRagContext}
                  className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${useRagContext ? 'bg-blue-600' : 'bg-zinc-700'}`}
                  title={useRagContext ? 'RAG context enabled' : 'RAG context disabled'}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${useRagContext ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-zinc-500">Completion audio</span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={toggleCompletionAudio}
                  className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${autoGenerateTts ? 'bg-blue-600' : 'bg-zinc-700'}`}
                  title={autoGenerateTts ? 'Auto-generate audio enabled' : 'Auto-generate audio disabled'}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${autoGenerateTts ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className="text-[11px] text-zinc-500 mt-1">When enabled, audio is generated automatically after each completion.</div>

              <div className="mt-3">
                <div className="text-xs text-zinc-500 mb-1">Chunks to retrieve (Top K)</div>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={ragTopKDraft}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRagTopKDraft(v);
                    setRagTopKDirty(true);
                    const n = Number.parseInt(v, 10);
                    if (Number.isFinite(n)) {
                      setRagTopK(Math.min(50, Math.max(1, Math.trunc(n))));
                    }
                  }}
                  onBlur={() => {
                    setRagTopKDraft(String(ragTopK));
                  }}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-500 font-mono"
                  placeholder="3"
                />
                <div className="text-[11px] text-zinc-500 mt-1">Stored in <span className="font-mono">data.db</span> (defaults to 3 if unset)</div>
              </div>
            </div>
          </div>

          <PinResetForm />
          
          {/* Model Selection */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Model</span>
              <button
                type="button"
                onClick={() => setIsAddModelOpen(true)}
                className="inline-flex items-center gap-1 text-xs text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1 transition-colors cursor-pointer"
                title="Add an OpenRouter model by id"
              >
                <Plus size={14} />
                Add
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {allModels.map((model) => {
                const pricing = modelPricing[model.id];
                const isSelected = model.id === selectedModel;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => selectEditorModel(model.id)}
                    className={`flex items-center justify-between px-3 py-2 rounded text-sm text-left transition-colors cursor-pointer ${
                      isSelected 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{model.name}</span>
                      <span className={`text-xs ${isSelected ? 'text-blue-200' : 'text-zinc-500'}`}>
                        {model.description}
                      </span>
                    </div>
                    <div className={`text-xs text-right ${isSelected ? 'text-blue-200' : 'text-zinc-500'}`}>
                      <div>{pricing ? `${formatCost(pricing.prompt)}/M in` : '--/M in'}</div>
                      <div>{pricing ? `${formatCost(pricing.completion)}/M out` : '--/M out'}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt Editor */}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Prompt</span>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={3}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 resize-none"
              placeholder="Enter your prompt..."
            />
            <span className="text-xs text-zinc-500">
              Your text will be appended after this prompt
            </span>
          </div>

          {/* Regeneration Prompt Template */}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Regeneration Prompt</span>
            <div className="relative">
              <textarea
                value={regenPromptTemplate}
                onChange={(e) => setRegenPromptTemplate(e.target.value)}
                rows={6}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 resize-none w-full font-mono"
                placeholder="Regeneration prompt template..."
              />
            </div>
            <div className="text-xs text-zinc-500 space-y-1">
              <p><code className="px-1 bg-zinc-700 rounded text-blue-300">{'{{ATTEMPTS}}'}</code> = previous attempts</p>
              <p><code className="px-1 bg-zinc-700 rounded text-green-300">{'{{ORIGINAL_PROMPT}}'}</code> = prompt above</p>
            </div>
            {attemptHistory.attempts.length > 0 && (
              <div className="mt-1 p-2 bg-blue-900/30 border border-blue-700 rounded text-xs text-blue-300">
                <span className="font-medium">Attempts: {attemptHistory.attempts.length}</span>
                <p className="mt-1 text-blue-400">Use the mobile regenerate button or completion controls to regenerate.</p>
              </div>
            )}
          </div>

            </>
          )}

          {leftSidebarTab === 'tools' && (
            <>
              <Link
                href="/mental-notes"
                className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded text-white font-medium transition-colors cursor-pointer"
              >
                <NotebookPen size={18} />
                Mental Notes
              </Link>

              <button
                type="button"
                onClick={insertStarBlock}
                className="flex items-center justify-center px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded text-white font-medium transition-colors cursor-pointer"
                title="Insert ★"
              >
                ★
              </button>

              <div className="flex flex-col gap-2 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400 flex items-center gap-2">
                    <Tag size={16} />
                    Tags
                  </span>
                  <button
                    type="button"
                    onClick={insertBookmarkTag}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-200 transition-colors cursor-pointer"
                    title="Insert a tag at the cursor"
                  >
                    Insert
                  </button>
                </div>
                {bookmarks.length === 0 ? (
                  <div className="text-xs text-zinc-500">No tags yet.</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {bookmarks.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => scrollToBookmark(b.id)}
                        className="w-full text-left px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-200 transition-colors cursor-pointer truncate"
                        title={`Jump to: ${b.name || b.id}`}
                      >
                        {b.name || b.id}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {lastRequestPreview && (
                <div className="flex flex-col gap-2 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                  <div className="text-sm text-zinc-400">Last request</div>

                  <div className="text-[11px] leading-relaxed text-zinc-200 bg-black/30 border border-zinc-800 rounded p-2 h-[60vh] overflow-auto whitespace-pre-wrap break-words">
                    {lastRequestPreview.useRagContext && (
                      <>
                        <div className="text-zinc-400">Model: <span className="text-zinc-200 font-mono">{lastRequestPreview.model}</span></div>
                        <div className="text-zinc-400">RAG: <span className="text-green-300">enabled</span></div>
                        <div className="text-zinc-400">Chunks available: <span className="text-zinc-200 font-mono">{lastRequestPreview.ragChunksAvailable ?? 0}</span></div>
                        <div className="text-zinc-400">Chunks retrieved: <span className="text-zinc-200 font-mono">{lastRequestPreview.ragChunksRetrieved ?? 0}</span></div>

                        {lastRequestPreview.ragContext && (
                          <div className="mt-3">
                            <div className="text-zinc-400 mb-1">Context</div>
                            <pre className="text-violet-200 bg-violet-950/20 border border-violet-900/40 rounded p-2 whitespace-pre-wrap break-words">
                              {lastRequestPreview.ragContext}
                            </pre>
                          </div>
                        )}

                        <div className="mt-3">
                          <div className="text-zinc-400 mb-1">User message (as sent)</div>
                          <div className="bg-zinc-950/30 border border-zinc-800 rounded p-2 font-mono whitespace-pre-wrap break-words">
                            {lastRequestPreview.userMessage}
                          </div>
                        </div>

                        <div className="mt-3">
                          <div className="text-zinc-400 mb-1">System prompt (as sent)</div>
                          <div className="bg-zinc-950/30 border border-zinc-800 rounded p-2 font-mono whitespace-pre-wrap break-words">
                            <pre className="text-zinc-200 whitespace-pre-wrap break-words">
                              {lastSystemPromptParts?.before ?? lastRequestPreview.systemPrompt}
                            </pre>
                            {lastSystemPromptParts?.context && (
                              <pre className="mt-2 text-violet-200 whitespace-pre-wrap break-words">
                                {lastSystemPromptParts.context}
                              </pre>
                            )}
                            {lastSystemPromptParts?.after && (
                              <pre className="mt-2 text-zinc-200 whitespace-pre-wrap break-words">
                                {lastSystemPromptParts.after}
                              </pre>
                            )}
                          </div>
                        </div>
                      </>
                    )}

                    <div className={lastRequestPreview.useRagContext ? 'mt-3' : ''}>
                      <div className="text-zinc-400 mb-1">Personalized prompt</div>
                      <pre className="text-emerald-200 bg-emerald-950/15 border border-emerald-900/30 rounded p-2 whitespace-pre-wrap break-words">
                        {lastRequestPreview.promptText}
                      </pre>
                    </div>

                    <div className="mt-3">
                      <div className="text-zinc-400 mb-1">Input text (until last dot/newline)</div>
                      <pre className="text-amber-200 bg-amber-950/15 border border-amber-900/30 rounded p-2 whitespace-pre-wrap break-words">
                        {lastRequestPreview.inputText}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm"><Bold size={16} /> Bold</span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${editor.isActive('bold') ? 'bg-blue-600' : 'bg-zinc-700'}`}
                  title="Toggle bold"
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${editor.isActive('bold') ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm"><span className="text-zinc-300 font-semibold">A</span> Size</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => adjustFontSize(-2)}
                    className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                    title="Decrease text size"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="w-12 text-center text-xs font-mono text-zinc-400 select-none">{getCurrentFontSizePx()}px</span>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => adjustFontSize(2)}
                    className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                    title="Increase text size"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm"><Strikethrough size={16} /> Strike</span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                  className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${editor.isActive('strike') ? 'bg-blue-600' : 'bg-zinc-700'}`}
                  title="Toggle strikethrough"
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${editor.isActive('strike') ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-2 text-sm"><Highlighter size={16} /> Highlight</span>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => editor.chain().focus().unsetHighlight().run()}
                    className="px-2 py-1 text-xs bg-zinc-800 rounded border border-zinc-700 cursor-pointer hover:bg-zinc-700 transition-colors"
                  >
                    None
                  </button>
                  {['#facc15', '#4ade80', '#60a5fa', '#f472b6'].map((color) => (
                    <button
                      key={color}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
                      className={`w-6 h-6 rounded-full border cursor-pointer hover:scale-110 transition-transform ${editor.isActive('highlight', { color }) ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>

              <PinAttemptLog />
            </>
          )}

        </div>
      </div>

      {/* Left Toggle Button */}
      <button
        type="button"
        ref={leftToggleRef}
        onClick={toggleLeftSidebar}
        title="Toggle left panel"
        className={`fixed top-8 z-[60] p-2 bg-zinc-800 rounded-r-md text-white transition-all duration-300 cursor-pointer hover:bg-zinc-700 ${
          isLeftSidebarOpen ? 'left-72 max-md:left-72' : 'left-0'
        }`}
      >
        {isLeftSidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>

      {/* Mobile Sidebar Overlay */}
      {isLeftSidebarOpen && (
        <div 
          className="sidebar-overlay md:hidden"
          onClick={() => {
            setIsLeftSidebarOpen(false);
          }}
        />
      )}

      {/* Editor Area */}
      <div className="flex-1 transition-all duration-300 relative editor-area">
        <EditorContent editor={editor} />
        
        {/* Loading Indicator Overlay */}
        {loaderPosition && (
          <div 
            className="ai-loading-indicator absolute pointer-events-none"
            style={{ 
              top: loaderPosition.top, 
              left: loaderPosition.left,
            }}
          >
            <div className="orbit-container">
              <div className="orbit-dot"></div>
              <div className="orbit-dot"></div>
              <div className="orbit-dot"></div>
            </div>
          </div>
        )}

        <audio
          ref={ttsAudioRef}
          src={ttsAudioUrl ?? undefined}
          preload="auto"
          playsInline
          onEnded={() => { setIsTtsPlaying(false); setTtsCurrentTime(0); }}
          onPause={() => setIsTtsPlaying(false)}
          onPlay={() => setIsTtsPlaying(true)}
          onTimeUpdate={(e) => setTtsCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setTtsDuration(e.currentTarget.duration)}
          onError={() => setTtsError('Audio playback error')}
          className="hidden"
        />
      </div>

      {/* Mobile Touch Controls - rendered via Portal to ensure proper z-index on iOS */}
      {isMounted && createPortal(
        <div 
          ref={fabContainerRef}
          className="fixed right-0 z-[9999] flex flex-col items-end justify-end pr-6 select-none pointer-events-none"
          contentEditable={false}
          style={{ 
            // top is handled by ref
            // removed bottom positioning
            // width adjusted for controls
            width: completion.isActive ? '100%' : isTextColorPaletteOpen ? 'min(380px, 100vw)' : '100px',
            WebkitTapHighlightColor: 'transparent',
            WebkitUserSelect: 'none',
            userSelect: 'none',
            WebkitTouchCallout: 'none',
            transform: 'translateZ(0)',
            WebkitTransform: 'translateZ(0)',
          }}
        >
          {/* Completion Controls - shown when completion is active */}
          {completion.isActive && (
            <div className="flex items-center gap-2 bg-zinc-900/95 backdrop-blur-sm rounded-full px-3 py-2 shadow-lg border border-zinc-700/50 pointer-events-auto" style={{ touchAction: 'manipulation' }}>
              {/* Word count indicator */}
              <span className="text-xs text-zinc-400 px-2">
                {completion.selectedCount}/{completion.words.length}
              </span>
              
              {/* Deselect word */}
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onTouchEnd={(e) => { e.preventDefault(); if (completion.selectedCount > 0) deselectLastWord(); }}
                onClick={deselectLastWord}
                disabled={completion.selectedCount === 0}
                className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none"
                style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                title="Deselect word"
              >
                <ChevronLeft size={18} />
              </button>
              
              {/* Select next word */}
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onTouchEnd={(e) => { e.preventDefault(); if (completion.selectedCount < completion.words.length) selectNextWord(); }}
                onClick={selectNextWord}
                disabled={completion.selectedCount >= completion.words.length}
                className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none"
                style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                title="Select word"
              >
                <ChevronRight size={18} />
              </button>
              
              {/* Select all */}
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onTouchEnd={(e) => { e.preventDefault(); if (completion.selectedCount < completion.words.length) selectAllWords(); }}
                onClick={selectAllWords}
                disabled={completion.selectedCount >= completion.words.length}
                className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none"
                style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                title="Select all"
              >
                <ChevronsRight size={18} />
              </button>
              
              {/* Divider */}
              <div className="w-px h-5 bg-zinc-700" />
              
              {/* Regenerate (when no words selected) or Confirm */}
              {completion.selectedCount === 0 ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onTouchEnd={(e) => { e.preventDefault(); handleRegenerate(); }}
                  onClick={handleRegenerate}
                  className="p-2 rounded-full text-amber-400 hover:text-amber-300 hover:bg-zinc-700 transition-colors select-none"
                  style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                  title="Regenerate"
                >
                  <RotateCcw size={18} />
                </button>
              ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onTouchEnd={(e) => { e.preventDefault(); confirmCompletion(); }}
                  onClick={confirmCompletion}
                  className="p-2 rounded-full text-green-400 hover:text-green-300 hover:bg-zinc-700 transition-colors select-none"
                  style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                  title="Confirm"
                >
                  <Check size={18} />
                </button>
              )}
              
              {/* Save */}
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onTouchEnd={(e) => { e.preventDefault(); saveCompletion(); }}
                onClick={saveCompletion}
                className="p-2 rounded-full text-amber-400 hover:text-amber-300 hover:bg-zinc-700 transition-colors select-none"
                style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                title="Save completion"
              >
                <Star size={18} />
              </button>
              
              {/* Cancel */}
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onTouchEnd={(e) => { e.preventDefault(); cancelCompletion(); }}
                onClick={cancelCompletion}
                className="p-2 rounded-full text-red-400 hover:text-red-300 hover:bg-zinc-700 transition-colors select-none"
                style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                title="Cancel"
              >
                <X size={18} />
              </button>
            </div>
          )}

          {/* Cancel generation button - shown during loading */}
          {(isAutoCompleting || isFocusHighlighting) && !completion.isActive && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onTouchEnd={(e) => { e.preventDefault(); cancelGeneration(); }}
              onClick={cancelGeneration}
              className="p-3 rounded-full bg-zinc-900/95 backdrop-blur-sm text-red-400 hover:text-red-300 hover:bg-zinc-800 transition-all shadow-lg border border-zinc-700/50 select-none pointer-events-auto"
              style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
              title="Cancel generation"
            >
              <X size={22} />
            </button>
          )}

          {/* Main FAB - Generate completion */}
          {!completion.isActive && !isAutoCompleting && !isFocusHighlighting && (
            <div className="flex flex-col items-end gap-3 pointer-events-none">
              {/* Toggle button — half height of FAB buttons, always visible */}
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onTouchEnd={(e) => { e.preventDefault(); setFabButtonsVisible(v => { const next = !v; try { localStorage.setItem('fabButtonsVisible', String(next)); } catch {} return next; }); }}
                onClick={() => setFabButtonsVisible(v => { const next = !v; try { localStorage.setItem('fabButtonsVisible', String(next)); } catch {} return next; })}
                className="flex h-6 w-12 items-center justify-center rounded-lg bg-zinc-900/95 backdrop-blur-sm hover:bg-zinc-800 transition-all shadow-lg border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 select-none pointer-events-auto"
                style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                title={fabButtonsVisible ? 'Hide buttons' : 'Show buttons'}
              >
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-300 ${fabButtonsVisible ? 'rotate-0' : 'rotate-180'}`}
                />
              </button>
              {/* Animated wrapper — slides down to hide */}
              <div
                className="flex flex-col items-end gap-3 pointer-events-none transition-all duration-300 ease-in-out"
                style={{
                  opacity: fabButtonsVisible ? 1 : 0,
                  transform: fabButtonsVisible ? 'translateY(0)' : 'translateY(12px)',
                  pointerEvents: fabButtonsVisible ? 'none' : 'none',
                  visibility: fabButtonsVisible ? 'visible' : 'hidden',
                }}
              >
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onTouchEnd={(e) => { e.preventDefault(); handleFocusHighlight(); }}
                onClick={handleFocusHighlight}
                className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-lg hover:shadow-blue-500/25 hover:scale-105 active:scale-95 select-none pointer-events-auto"
                style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                title="Focus color"
              >
                <Split size={24} />
              </button>

              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  openMentalNoteMode();
                }}
                onClick={openMentalNoteMode}
                className={`flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-900/95 backdrop-blur-sm hover:bg-zinc-800 transition-all shadow-lg border select-none pointer-events-auto ${
                  mentalNoteSelectionError
                    ? 'mental-note-shake border-red-400 text-red-300'
                    : didSaveMentalNote
                      ? 'border-emerald-400 text-emerald-200'
                      : 'border-zinc-700/50 text-emerald-300 hover:text-emerald-200'
                }`}
                style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                title="Save selection to mental notes"
              >
                {mentalNoteSelectionError ? <CircleAlert size={20} /> : didSaveMentalNote ? <Check size={20} /> : <BookmarkPlus size={20} />}
              </button>

              <div
                className={`pointer-events-auto overflow-hidden rounded-xl border bg-zinc-900/95 shadow-lg backdrop-blur-sm transition-all duration-300 ease-out ${
                  isMentalNoteModeOpen
                    ? 'max-h-14 w-52 translate-x-0 border-emerald-400/30 p-1.5 opacity-100 sm:w-56'
                    : 'max-h-0 w-0 translate-x-3 border-transparent p-0 opacity-0'
                }`}
              >
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { void saveSelectionAsMentalNote(null); }}
                    className="rounded-lg border border-emerald-400/25 bg-emerald-950/25 px-2 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-900/35"
                  >
                    Random
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={openMentalReminder}
                    className="rounded-lg border border-violet-400/25 bg-violet-950/25 px-2 py-2 text-xs font-medium text-violet-100 hover:bg-violet-900/35"
                  >
                    Reminder
                  </button>
                </div>
              </div>

              <div className="flex items-start justify-end gap-2 pointer-events-auto">
                <div
                  className={`overflow-hidden rounded-2xl border bg-zinc-900/95 text-zinc-200 shadow-lg backdrop-blur-sm transition-all duration-300 ease-out ${
                    isTextColorPaletteOpen
                      ? 'max-h-80 w-72 translate-x-0 border-zinc-700/50 p-3 opacity-100'
                      : 'max-h-0 w-0 translate-x-3 border-transparent p-0 opacity-0'
                  }`}
                  aria-hidden={!isTextColorPaletteOpen}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex gap-2">
                        {TEXT_COLORS.map(({ color, label }) => (
                          <button
                            key={color}
                            type="button"
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onTouchEnd={(e) => {
                              e.preventDefault();
                              applyTextColor(color);
                              setIsTextColorPaletteOpen(false);
                            }}
                            onClick={() => {
                              applyTextColor(color);
                              setIsTextColorPaletteOpen(false);
                            }}
                            className={`h-7 w-7 shrink-0 rounded-full border shadow-sm transition-transform hover:scale-110 ${
                              editor.isActive('textStyle', { color }) ? 'scale-110 border-white' : 'border-zinc-700'
                            }`}
                            style={{ backgroundColor: color }}
                            title={label}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onTouchEnd={(e) => {
                          e.preventDefault();
                          insertStarBlock();
                          setIsTextColorPaletteOpen(false);
                        }}
                        onClick={() => {
                          insertStarBlock();
                          setIsTextColorPaletteOpen(false);
                        }}
                        className="flex h-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-amber-400 transition-colors hover:bg-zinc-700 hover:text-amber-300"
                        title="Insert ★"
                      >
                        <Star size={17} />
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onTouchEnd={(e) => {
                          e.preventDefault();
                          scrollToTop();
                          setIsTextColorPaletteOpen(false);
                        }}
                        onClick={() => {
                          scrollToTop();
                          setIsTextColorPaletteOpen(false);
                        }}
                        className="flex h-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 transition-colors hover:bg-zinc-700 hover:text-white"
                        title="Scroll to top"
                      >
                        <ArrowUp size={17} />
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onTouchEnd={(e) => {
                          e.preventDefault();
                          editor.chain().focus().toggleBold().run();
                          setIsTextColorPaletteOpen(false);
                        }}
                        onClick={() => {
                          editor.chain().focus().toggleBold().run();
                          setIsTextColorPaletteOpen(false);
                        }}
                        className={`flex h-10 items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${
                          editor.isActive('bold') ? 'border-blue-500 bg-blue-600 text-white' : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700'
                        }`}
                        title="Bold"
                      >
                        <Bold size={17} />
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onTouchEnd={(e) => {
                          e.preventDefault();
                          editor.chain().focus().toggleStrike().run();
                          setIsTextColorPaletteOpen(false);
                        }}
                        onClick={() => {
                          editor.chain().focus().toggleStrike().run();
                          setIsTextColorPaletteOpen(false);
                        }}
                        className={`flex h-10 items-center justify-center rounded-lg border transition-colors ${
                          editor.isActive('strike') ? 'border-blue-500 bg-blue-600 text-white' : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700'
                        }`}
                        title="Strikethrough"
                      >
                        <Strikethrough size={17} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5">
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onTouchEnd={(e) => { e.preventDefault(); adjustFontSize(-2); }}
                        onClick={() => adjustFontSize(-2)}
                        className="rounded-md p-1.5 text-zinc-200 transition-colors hover:bg-zinc-700"
                        title="Decrease text size"
                      >
                        <Minus size={17} />
                      </button>
                      <span className="min-w-14 text-center text-xs font-mono text-zinc-300">{getCurrentFontSizePx()}px</span>
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onTouchEnd={(e) => { e.preventDefault(); adjustFontSize(2); }}
                        onClick={() => adjustFontSize(2)}
                        className="rounded-md p-1.5 text-zinc-200 transition-colors hover:bg-zinc-700"
                        title="Increase text size"
                      >
                        <Plus size={17} />
                      </button>
                    </div>

                    <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2">
                      <Highlighter size={16} className="shrink-0 text-zinc-400" />
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onTouchEnd={(e) => {
                          e.preventDefault();
                          editor.chain().focus().unsetHighlight().run();
                          setIsTextColorPaletteOpen(false);
                        }}
                        onClick={() => {
                          editor.chain().focus().unsetHighlight().run();
                          setIsTextColorPaletteOpen(false);
                        }}
                        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
                        title="Remove highlight"
                      >
                        None
                      </button>
                      {['#facc15', '#4ade80', '#60a5fa', '#f472b6'].map((color) => (
                        <button
                          key={color}
                          type="button"
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onTouchEnd={(e) => {
                            e.preventDefault();
                            editor.chain().focus().toggleHighlight({ color }).run();
                            setIsTextColorPaletteOpen(false);
                          }}
                          onClick={() => {
                            editor.chain().focus().toggleHighlight({ color }).run();
                            setIsTextColorPaletteOpen(false);
                          }}
                          className={`h-6 w-6 shrink-0 rounded-full border transition-transform hover:scale-110 ${
                            editor.isActive('highlight', { color }) ? 'scale-110 border-white' : 'border-zinc-700'
                          }`}
                          style={{ backgroundColor: color }}
                          title={`Highlight ${color}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    setIsTextColorPaletteOpen(open => !open);
                  }}
                  onClick={() => setIsTextColorPaletteOpen(open => !open)}
                  className={`flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-900/95 backdrop-blur-sm hover:bg-zinc-800 transition-all shadow-lg border select-none ${
                    isTextColorPaletteOpen ? 'border-white text-white' : 'border-zinc-700/50 text-zinc-200'
                  }`}
                  style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                  title="Tools"
                  aria-expanded={isTextColorPaletteOpen}
                >
                  <ChartNoAxesCombined size={20} />
                </button>
              </div>

              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onTouchEnd={(e) => { e.preventDefault(); setIsModalOpen(!isChatModalOpen); }}
                onClick={() => setIsModalOpen(!isChatModalOpen)}
                className={`flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-900/95 backdrop-blur-sm hover:bg-zinc-800 transition-all shadow-lg border select-none pointer-events-auto ${
                  isChatModalOpen ? 'border-cyan-400 text-cyan-200' : 'border-zinc-700/50 text-zinc-200'
                }`}
                style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                title="Chat"
              >
                <MessageSquare size={20} />
              </button>

              </div>{/* end animated wrapper */}
            </div>
          )}
        </div>,
        document.body
      )}

      {/* Saved Completion Popup Modal */}
      {savedCompletionPopup.isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div 
            className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl max-w-lg w-full max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-zinc-700">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <Star size={18} className="text-amber-400" />
                Saved Completion
              </h3>
              <button
                type="button"
                onClick={closeSavedCompletionPopup}
                className="p-1 rounded hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <textarea
                value={savedCompletionPopup.content}
                onChange={(e) => setSavedCompletionPopup((prev) => ({ ...prev, content: e.target.value }))}
                className="w-full min-h-[220px] bg-zinc-950/40 border border-zinc-700 rounded p-3 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 resize-y"
                placeholder=""
                spellCheck={false}
              />
            </div>
            <div className="p-4 border-t border-zinc-700 flex justify-end">
              <button
                type="button"
                onClick={closeSavedCompletionPopup}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add OpenRouter Model Modal */}
      {isAddModelOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-zinc-700">
              <h3 className="text-white font-semibold">Add OpenRouter model</h3>
              <button
                type="button"
                onClick={() => { setIsAddModelOpen(false); setNewModelError(null); }}
                className="p-1 rounded hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-2">
              <label className="text-sm text-zinc-400">Model id</label>
              <input
                ref={newModelInputRef}
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addOpenRouterModel();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsAddModelOpen(false);
                  }
                }}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 font-mono"
                placeholder="liquid/lfm-2.5-1.2b-thinking:free"
                autoComplete="off"
                spellCheck={false}
              />
              {newModelError && (
                <div className="text-xs text-red-400">{newModelError}</div>
              )}
              <div className="text-xs text-zinc-500">
                Paste an OpenRouter model id. It will be saved locally and appear in the model list.
              </div>
            </div>
            <div className="p-4 border-t border-zinc-700 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setIsAddModelOpen(false); setNewModelError(null); }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addOpenRouterModel}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {isMentalReminderOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-violet-200/25 bg-[linear-gradient(135deg,rgba(24,24,27,0.98),rgba(46,16,101,0.9),rgba(8,47,73,0.82))] p-3 shadow-2xl sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-violet-50">Set reminder</div>
                <div className="text-xs text-violet-100/55">Saved note also joins the random queue.</div>
              </div>
              <button
                type="button"
                onClick={() => setIsMentalReminderOpen(false)}
                className="rounded-full border border-white/10 bg-white/5 p-2 text-violet-100 hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mb-3 rounded-xl border border-cyan-200/20 bg-cyan-200/10 px-3 py-2 text-center">
              <div className="text-[11px] uppercase tracking-wide text-cyan-100/55">Current time</div>
              <div className="font-mono text-lg font-semibold text-cyan-50">
                {mentalReminderNow.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
              </div>
            </div>
            <div className="grid grid-cols-[1fr_0.8fr] gap-2">
              <input
                type="date"
                value={mentalReminderDate}
                min={getCurrentReminderParts().date}
                onChange={(e) => {
                  const next = clampReminderParts(e.target.value, mentalReminderTime);
                  setMentalReminderDate(next.date);
                  setMentalReminderTime(next.time);
                }}
                className="min-w-0 rounded-lg border border-violet-100/15 bg-black/45 px-3 py-2 text-sm text-violet-50 outline-none focus:border-violet-200/40"
              />
              <input
                type="time"
                value={mentalReminderTime}
                onChange={(e) => setMentalReminderTime(e.target.value)}
                onBlur={() => {
                  const next = clampReminderParts(mentalReminderDate, mentalReminderTime);
                  setMentalReminderDate(next.date);
                  setMentalReminderTime(next.time);
                }}
                className="min-w-0 rounded-lg border border-violet-100/15 bg-black/45 px-3 py-2 text-sm text-violet-50 outline-none focus:border-violet-200/40"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                ['2m', 2],
                ['5m', 5],
                ['15m', 15],
                ['1h', 60],
              ].map(([label, minutes]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    const d = new Date();
                    d.setSeconds(0, 0);
                    d.setMinutes(d.getMinutes() + Number(minutes));
                    setMentalReminderDate(dateInputValue(d));
                    setMentalReminderTime(timeInputValue(d));
                  }}
                  className="rounded-lg border border-violet-200/20 bg-violet-200/10 px-2 py-2 text-xs font-medium text-violet-50 hover:bg-violet-200/20"
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={confirmMentalReminder}
              className="mt-3 w-full rounded-lg bg-violet-100 px-4 py-2 text-sm font-semibold text-black hover:bg-violet-50"
            >
              Confirm reminder
            </button>
          </div>
        </div>
      )}

      {/* Add Embedding Model Modal */}
      {isAddEmbeddingModelOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-zinc-700">
              <h3 className="text-white font-semibold">Add embedding model</h3>
              <button
                type="button"
                onClick={() => { setIsAddEmbeddingModelOpen(false); setEmbeddingModelError(null); }}
                className="p-1 rounded hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-2">
              <label className="text-sm text-zinc-400">OpenRouter embedding model id</label>
              <input
                value={newEmbeddingModelId}
                onChange={(e) => setNewEmbeddingModelId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void registerEmbeddingModel();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsAddEmbeddingModelOpen(false);
                  }
                }}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 font-mono"
                placeholder="qwen/qwen3-embedding-8b"
                autoComplete="off"
                spellCheck={false}
              />
              {embeddingModelError && (
                <div className="text-xs text-red-400">{embeddingModelError}</div>
              )}
              <div className="text-xs text-zinc-500">
                This creates a separate embedding index for the same document. Switch models to see per-model progress.
              </div>
            </div>
            <div className="p-4 border-t border-zinc-700 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setIsAddEmbeddingModelOpen(false); setEmbeddingModelError(null); }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void registerEmbeddingModel(); }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TiptapEditor;
