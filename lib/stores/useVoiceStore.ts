import { create } from 'zustand';

interface VoiceState {
  isListening: boolean;
  isProcessing: boolean;
  isPlayingAudio: boolean;
  status: 'idle' | 'recording' | 'ready_to_generate' | 'transcribing' | 'thinking' | 'generating_audio' | 'speaking';
  isModalOpen: boolean;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  setIsListening: (isListening: boolean) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  setIsPlayingAudio: (isPlaying: boolean) => void;
  setStatus: (status: VoiceState['status']) => void;
  setIsModalOpen: (isOpen: boolean) => void;
  addToConversation: (role: 'user' | 'assistant', content: string) => void;
  clearConversation: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  isListening: false,
  isProcessing: false,
  isPlayingAudio: false,
  status: 'idle',
  isModalOpen: false,
  conversationHistory: [],
  setIsListening: (isListening) => set({ isListening }),
  setIsProcessing: (isProcessing) => set({ isProcessing }),
  setIsPlayingAudio: (isPlayingAudio) => set({ isPlayingAudio }),
  setStatus: (status) => set({ status }),
  setIsModalOpen: (isModalOpen) => set({ isModalOpen }),
  addToConversation: (role, content) => 
    set((state) => ({ 
      conversationHistory: [...state.conversationHistory, { role, content }] 
    })),
  clearConversation: () => set({ conversationHistory: [] }),
}));
