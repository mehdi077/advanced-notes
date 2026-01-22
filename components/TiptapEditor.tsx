'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { debounce } from 'lodash';
import { ChevronRight, ChevronLeft, Bold, Highlighter, Palette, Sparkles, Loader2, DollarSign, RefreshCw, Check, X, ChevronsRight, RotateCcw, Split, Star, Mic, Play, Pause, SkipBack, SkipForward, Database } from 'lucide-react';
import { useVoiceStore } from '@/lib/stores/useVoiceStore';
import { AVAILABLE_MODELS, DEFAULT_MODEL, ModelId, ModelPricing, formatCost } from '@/lib/model-config';
import { CompletionMark } from '@/lib/completion-mark';
import { SavedCompletion } from '@/lib/saved-completion';

interface TiptapEditorProps {
  initialContent: object | null;
  onContentUpdate: (content: object) => void;
}

const DEFAULT_PROMPT = 'Provide a two sentence long completion to this text:';
const DEFAULT_REGEN_PROMPT_TEMPLATE = `This is the already generated text:
{{ATTEMPTS}}

Now generate a drastically  different path to the completion for the next attempt, very far deferent from the ones that are shown in the attempts above.
{{ORIGINAL_PROMPT}}`;

const SILENT_WAV_DATA_URL =
  'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

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
  ragContext: string | null;
  promptText: string;
  inputText: string;
  systemPrompt: string;
  userMessage: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
}

const TiptapEditor = ({ initialContent, onContentUpdate }: TiptapEditorProps) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const { setIsModalOpen } = useVoiceStore();
  const [selectedModel, setSelectedModel] = useState<ModelId>(DEFAULT_MODEL);
  const [isAutoCompleting, setIsAutoCompleting] = useState(false);
  const [autoCompleteError, setAutoCompleteError] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_PROMPT);
  const [regenPromptTemplate, setRegenPromptTemplate] = useState(DEFAULT_REGEN_PROMPT_TEMPLATE);
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
  const [modelPricing, setModelPricing] = useState<ModelPricingMap>({});
  const [lastGenerationCost, setLastGenerationCost] = useState<number | null>(null);
  const [promptsLoaded, setPromptsLoaded] = useState(false);

  // RAG embedding state
  const [ragStatus, setRagStatus] = useState<{ percentage: number; totalChunks: number; embeddedChunks: number; needsUpdate: boolean } | null>(null);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [embeddingError, setEmbeddingError] = useState<string | null>(null);

  const [useRagContext, setUseRagContext] = useState(true);
  const [lastRequestPreview, setLastRequestPreview] = useState<AutocompleteRequestPreview | null>(null);

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
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortControllerRef = useRef<AbortController | null>(null);
  const ttsUnlockedRef = useRef(false);
  const ttsAutoplayRequestedRef = useRef(false);
  
  // Saved completion popup state
  const [savedCompletionPopup, setSavedCompletionPopup] = useState<{ isOpen: boolean; content: string }>({
    isOpen: false,
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
  const rightToggleRef = useRef<HTMLButtonElement>(null);
  const statusIndicatorRef = useRef<HTMLDivElement>(null);
  
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

  // Handle Visual Viewport updates for sticky positioning
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const viewport = window.visualViewport;
    
    const updatePositions = () => {
      // Use offsetTop to keep elements pinned to the top of the visual viewport
      // This handles the case where the layout viewport scrolls or the keyboard
      // pushes content but we want these controls to stay "sticky" to the glass
      const topOffset = viewport.offsetTop;
      
      // Base top position (e.g., 32px or 2rem)
      const baseTop = 32; 
      
      // Update Sidebar Toggles
      if (leftToggleRef.current) {
        leftToggleRef.current.style.top = `${topOffset + baseTop}px`;
      }
      
      if (rightToggleRef.current) {
        rightToggleRef.current.style.top = `${topOffset + baseTop}px`;
      }

      // Update Status Indicator (Completion Bar)
      // Position it at the top as well, aligned with toggles but centered
      if (statusIndicatorRef.current) {
        statusIndicatorRef.current.style.top = `${topOffset + 16}px`;
      }
      
      // Update FAB Container - Position it on the right, below the sidebar toggle
      // Sidebar toggle is ~40px height + 32px top = ~72px. Let's put FAB at ~80px top
      if (fabContainerRef.current) {
        // For the FAB, we want it top-aligned now, not bottom-aligned
        // It should be below the right sidebar toggle
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
      
      if (rightToggleRef.current) {
        rightToggleRef.current.style.top = `${topOffset + baseTop}px`;
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
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      CompletionMark,
      SavedCompletion,
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
      const response = await fetch('/api/balance');
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

  // Fetch model pricing from OpenRouter
  const fetchModelPricing = useCallback(async () => {
    try {
      const response = await fetch('/api/models');
      if (response.ok) {
        const data = await response.json();
        const pricingMap: ModelPricingMap = {};
        for (const model of data.models || []) {
          pricingMap[model.id] = model.pricing;
        }
        setModelPricing(pricingMap);
      }
    } catch (error) {
      console.error('Failed to fetch model pricing:', error);
    }
  }, []);

  // Fetch prompts from database
  const fetchPrompts = useCallback(async () => {
    try {
      const response = await fetch('/api/prompts');
      if (response.ok) {
        const data = await response.json();
        setCustomPrompt(data.customPrompt);
        setRegenPromptTemplate(data.regenPromptTemplate);
      }
    } catch (error) {
      console.error('Failed to fetch prompts:', error);
    } finally {
      setPromptsLoaded(true);
    }
  }, []);

  const savePrompts = useMemo(() => {
    return debounce(async (prompt: string, regenTemplate: string) => {
      try {
        await fetch('/api/prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customPrompt: prompt, regenPromptTemplate: regenTemplate }),
        });
      } catch (error) {
        console.error('Failed to save prompts:', error);
      }
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      savePrompts.cancel();
    };
  }, [savePrompts]);

  // Fetch RAG embedding status
  const fetchRagStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/embeddings');
      if (response.ok) {
        const data = await response.json();
        setRagStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch RAG status:', error);
    }
  }, []);

  // Embed document chunks
  const embedDocument = useCallback(async () => {
    setIsEmbedding(true);
    setEmbeddingError(null);
    try {
      const response = await fetch('/api/embeddings', { method: 'POST' });
      if (response.ok) {
        await fetchRagStatus();
      } else {
        const data = await response.json();
        setEmbeddingError(data.error || 'Failed to embed');
      }
    } catch {
      setEmbeddingError('Failed to embed document');
    } finally {
      setIsEmbedding(false);
    }
  }, [fetchRagStatus]);

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
      const response = await fetch('/api/generation-tts', {
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
    fetchModelPricing();
    fetchPrompts();
    fetchRagStatus();
  }, [fetchBalance, fetchModelPricing, fetchPrompts, fetchRagStatus]);

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
      savePrompts(customPrompt, regenPromptTemplate);
    }
  }, [customPrompt, regenPromptTemplate, promptsLoaded, savePrompts]);

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

    const fullText = editor.getText();
    const cursorPos = editor.state.selection.anchor;
    let textUpToCursor = fullText.slice(0, cursorPos);

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

  const handleAutoComplete = useCallback(async () => {
    if (!editor || isAutoCompleting) return;

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
      const response = await fetch('/api/autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, modelId: selectedModel, prompt: customPrompt, useRagContext }),
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

          generateTtsForCompletion(completionText);
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
  }, [editor, isAutoCompleting, getTextForCompletion, selectedModel, customPrompt, useRagContext, fetchBalance, modelPricing, getCursorCoords, cleanupTtsAudio, generateTtsForCompletion, unlockTtsAudio]);

  // Handle regeneration when Tab is pressed with no words selected
  const handleRegenerate = useCallback(async () => {
    if (!editor || isAutoCompleting || !completion.isActive || !completion.range) return;
    
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

      const response = await fetch('/api/autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, modelId: selectedModel, prompt: regenPrompt, useRagContext }),
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

          generateTtsForCompletion(completionText);
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
  }, [editor, isAutoCompleting, completion, attemptHistory, getTextForCompletion, buildRegenPrompt, selectedModel, useRagContext, fetchBalance, modelPricing, getCursorCoords, cleanupTtsAudio, generateTtsForCompletion, unlockTtsAudio]);

  // Cancel ongoing generation
  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoaderPosition(null);
    setIsAutoCompleting(false);
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
        if (isAutoCompleting) {
          cancelGeneration();
        } else if (completion.isActive) {
          cancelCompletion();
        }
        return;
      }

      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        
        if (completion.isActive) {
          // If no words selected, regenerate instead of confirm
          if (completion.selectedCount === 0) {
            handleRegenerate();
          } else {
            confirmCompletion();
          }
        } else if (!isAutoCompleting) {
          handleAutoComplete();
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
  }, [completion.isActive, completion.selectedCount, isAutoCompleting, handleAutoComplete, handleRegenerate, confirmCompletion, cancelCompletion, cancelGeneration, selectNextWord, deselectLastWord, selectAllWords, saveCompletion]);

  // Handle clicks on saved completion markers
  useEffect(() => {
    const handleSavedCompletionClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const marker = target.closest('[data-saved-completion]');
      if (marker) {
        e.preventDefault();
        const content = marker.getAttribute('data-content');
        if (content) {
          setSavedCompletionPopup({
            isOpen: true,
            content: decodeURIComponent(content)
          });
        }
      }
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

  if (!editor) {
    return null;
  }

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const toggleLeftSidebar = () => setIsLeftSidebarOpen(!isLeftSidebarOpen);

  return (
    <div className={`flex w-full min-h-screen bg-black text-white relative ${completion.isActive ? 'completion-active' : ''} ${isAutoCompleting ? 'generating' : ''}`}>
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
          <h2 className="text-lg font-semibold text-zinc-400 border-b border-zinc-700 pb-2">
            <Sparkles size={18} className="inline mr-2" />
            AI Assistant
          </h2>
          
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

          {/* RAG Embedding Status */}
          <div className="flex flex-col gap-2 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400 flex items-center gap-2">
                <Database size={16} />
                RAG Embeddings
              </span>
              <button
                type="button"
                onClick={fetchRagStatus}
                className="p-1 hover:bg-zinc-700 rounded transition-colors cursor-pointer"
                title="Refresh status"
              >
                <RefreshCw size={14} />
              </button>
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

            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-zinc-500">Use context in prompt</span>
              <button
                type="button"
                onClick={() => setUseRagContext(v => !v)}
                className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${useRagContext ? 'bg-blue-600' : 'bg-zinc-700'}`}
                title={useRagContext ? 'RAG context enabled' : 'RAG context disabled'}
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${useRagContext ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
          
          {/* Model Selection */}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Model</span>
            <div className="flex flex-col gap-1">
              {AVAILABLE_MODELS.map((model) => {
                const pricing = modelPricing[model.id];
                const isSelected = model.id === selectedModel;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModel(model.id)}
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
                    {pricing && (
                      <div className={`text-xs text-right ${isSelected ? 'text-blue-200' : 'text-zinc-500'}`}>
                        <div>{formatCost(pricing.prompt)}/M in</div>
                        <div>{formatCost(pricing.completion)}/M out</div>
                      </div>
                    )}
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
                <p className="mt-1 text-blue-400">Press Tab with no selection to regenerate</p>
              </div>
            )}
          </div>

          {/* Auto-complete Button */}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Auto-complete</span>
            <button
              type="button"
              onClick={handleAutoComplete}
              disabled={isAutoCompleting}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded text-white font-medium transition-colors cursor-pointer"
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
            <div className="text-xs text-zinc-500 space-y-1">
              <p><kbd className="px-1 py-0.5 bg-zinc-700 rounded">Tab</kbd> to generate completion</p>
              <p><kbd className="px-1 py-0.5 bg-zinc-700 rounded">→</kbd> <kbd className="px-1 py-0.5 bg-zinc-700 rounded">←</kbd> to select words</p>
              <p><kbd className="px-1 py-0.5 bg-zinc-700 rounded">Space</kbd> to select all words</p>
              <p><kbd className="px-1 py-0.5 bg-zinc-700 rounded">Tab</kbd> confirm or regenerate</p>
              <p><kbd className="px-1 py-0.5 bg-zinc-700 rounded">Esc</kbd> to cancel</p>
            </div>
            {autoCompleteError && (
              <div className="mt-2 p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
                {autoCompleteError}
              </div>
            )}
          </div>

          {/* Voice Assistant Button */}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Voice Assistant</span>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 rounded text-white font-medium transition-colors cursor-pointer"
            >
              <Mic size={18} />
              Start Voice Chat
            </button>
            <div className="text-xs text-zinc-500">
              Have a conversation with the AI assistant using your voice
            </div>
          </div>
        </div>
      </div>

      {/* Left Toggle Button */}
      <button
        type="button"
        ref={leftToggleRef}
        onClick={toggleLeftSidebar}
        className={`fixed top-8 z-[60] p-2 bg-zinc-800 rounded-r-md text-white transition-all duration-300 cursor-pointer hover:bg-zinc-700 ${
          isLeftSidebarOpen ? 'left-72 max-md:left-72' : 'left-0'
        }`}
      >
        {isLeftSidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>

      {/* Right Sidebar - Formatting Tools */}
      <div 
        className={`fixed top-0 right-0 h-full bg-zinc-900 border-l border-zinc-800 transition-all duration-300 ease-in-out z-[60] ${
          isSidebarOpen ? 'w-64' : 'w-0'
        } overflow-hidden`}
      >
        <div className="p-4 flex flex-col gap-6 w-64">
          <h2 className="text-lg font-semibold text-zinc-400 border-b border-zinc-700 pb-2">Tools</h2>

          {lastRequestPreview && (
            <div className="flex flex-col gap-2 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
              <div className="text-sm text-zinc-400">Last request</div>

              <div className="text-[11px] leading-relaxed text-zinc-200 bg-black/30 border border-zinc-800 rounded p-2 h-[60vh] overflow-auto whitespace-pre-wrap break-words">
                <div className="text-zinc-400">Model: <span className="text-zinc-200 font-mono">{lastRequestPreview.model}</span></div>
                <div className="text-zinc-400">RAG: <span className={lastRequestPreview.useRagContext ? 'text-green-300' : 'text-zinc-400'}>{lastRequestPreview.useRagContext ? 'enabled' : 'disabled'}</span></div>

                {lastRequestPreview.ragContext && (
                  <div className="mt-3">
                    <div className="text-zinc-400 mb-1">Context</div>
                    <pre className="text-violet-200 bg-violet-950/20 border border-violet-900/40 rounded p-2 whitespace-pre-wrap break-words">
                      {lastRequestPreview.ragContext}
                    </pre>
                  </div>
                )}

                <div className="mt-3">
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

                <div className="mt-3">
                  <div className="text-zinc-400 mb-1">User message (as sent)</div>
                  <div className="bg-zinc-950/30 border border-zinc-800 rounded p-2 font-mono whitespace-pre-wrap break-words">
                    <span className="text-emerald-200">{lastRequestPreview.promptText}</span>
                    <span className="text-zinc-200"> </span>
                    <span className="text-amber-200">{lastRequestPreview.inputText}</span>
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
              </div>
            </div>
          )}
          
          {/* Bold Control */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm"><Bold size={16} /> Bold</span>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${editor.isActive('bold') ? 'bg-blue-600' : 'bg-zinc-700'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${editor.isActive('bold') ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Color Control */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-sm"><Palette size={16} /> Text Color</span>
            <div className="flex gap-2 flex-wrap">
              {['#ffffff', '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => editor.chain().focus().setColor(color).run()}
                  className={`w-6 h-6 rounded-full border cursor-pointer hover:scale-110 transition-transform ${editor.isActive('textStyle', { color }) ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* Highlight Control */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-sm"><Highlighter size={16} /> Highlight</span>
            <div className="flex gap-2 flex-wrap">
              <button
                  type="button"
                  onClick={() => editor.chain().focus().unsetHighlight().run()}
                  className="px-2 py-1 text-xs bg-zinc-800 rounded border border-zinc-700 cursor-pointer hover:bg-zinc-700 transition-colors"
              >
                None
              </button>
              {['#facc15', '#4ade80', '#60a5fa', '#f472b6'].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
                  className={`w-6 h-6 rounded-full border cursor-pointer hover:scale-110 transition-transform ${editor.isActive('highlight', { color }) ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right Toggle Button */}
      <button
        type="button"
        ref={rightToggleRef}
        onClick={toggleSidebar}
        className={`fixed top-8 z-[60] p-2 bg-zinc-800 rounded-l-md text-white transition-all duration-300 cursor-pointer hover:bg-zinc-700 ${
          isSidebarOpen ? 'right-64 max-md:right-64' : 'right-0'
        }`}
      >
        {isSidebarOpen ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
      </button>

      {/* Mobile Sidebar Overlay */}
      {(isLeftSidebarOpen || isSidebarOpen) && (
        <div 
          className="sidebar-overlay md:hidden"
          onClick={() => {
            setIsLeftSidebarOpen(false);
            setIsSidebarOpen(false);
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
          className="fixed right-0 z-[9999] flex flex-col items-end justify-end pr-6 select-none"
          contentEditable={false}
          style={{ 
            // top is handled by ref
            // removed bottom positioning
            // width adjusted for controls
            width: completion.isActive ? '100%' : '100px',
            pointerEvents: 'auto',
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
            <div className="flex items-center gap-2 bg-zinc-900/95 backdrop-blur-sm rounded-full px-3 py-2 shadow-lg border border-zinc-700/50" style={{ touchAction: 'manipulation' }}>
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
          {isAutoCompleting && !completion.isActive && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onTouchEnd={(e) => { e.preventDefault(); cancelGeneration(); }}
              onClick={cancelGeneration}
              className="p-3 rounded-full bg-zinc-900/95 backdrop-blur-sm text-red-400 hover:text-red-300 hover:bg-zinc-800 transition-all shadow-lg border border-zinc-700/50 select-none"
              style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
              title="Cancel generation"
            >
              <X size={22} />
            </button>
          )}

          {/* Main FAB - Generate completion */}
          {!completion.isActive && !isAutoCompleting && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onTouchEnd={(e) => { e.preventDefault(); handleAutoComplete(); }}
              onClick={handleAutoComplete}
              className="p-4 rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-lg hover:shadow-blue-500/25 hover:scale-105 active:scale-95 select-none"
              style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
              title="Generate AI completion"
            >
              <Split size={24} />
            </button>
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
                onClick={() => setSavedCompletionPopup({ isOpen: false, content: '' })}
                className="p-1 rounded hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <p className="text-zinc-300 whitespace-pre-wrap">{savedCompletionPopup.content}</p>
            </div>
            <div className="p-4 border-t border-zinc-700 flex justify-end">
              <button
                type="button"
                onClick={() => setSavedCompletionPopup({ isOpen: false, content: '' })}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TiptapEditor;
