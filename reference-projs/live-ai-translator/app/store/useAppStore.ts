import { create } from 'zustand';

interface AppState {
  isListening: boolean;
  isProcessing: boolean;
  isPlayingAudio: boolean;
  status: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'generating_audio' | 'speaking';
  theme: 'light' | 'dark';
  isSidePanelOpen: boolean;
  setIsListening: (isListening: boolean) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  setIsPlayingAudio: (isPlaying: boolean) => void;
  setStatus: (status: AppState['status']) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setIsSidePanelOpen: (isOpen: boolean) => void;
  toggleSidePanel: () => void;
}

const getInitialTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('theme') as 'light' | 'dark' | null;
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
      // Set default if not present
      localStorage.setItem('theme', 'light');
    } catch (e) {
      console.warn('Failed to access localStorage:', e);
    }
  }
  return 'light';
};

export const useAppStore = create<AppState>((set) => ({
  isListening: false,
  isProcessing: false,
  isPlayingAudio: false,
  status: 'idle',
  theme: getInitialTheme(),
  isSidePanelOpen: false,
  setIsListening: (isListening) => set({ isListening }),
  setIsProcessing: (isProcessing) => set({ isProcessing }),
  setIsPlayingAudio: (isPlayingAudio) => set({ isPlayingAudio }),
  setStatus: (status) => set({ status }),
  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', theme);
    }
    set({ theme });
  },
  toggleTheme: () => set((state) => {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', newTheme);
    }
    return { theme: newTheme };
  }),
  setIsSidePanelOpen: (isSidePanelOpen) => set({ isSidePanelOpen }),
  toggleSidePanel: () => set((state) => ({ isSidePanelOpen: !state.isSidePanelOpen })),
}));
