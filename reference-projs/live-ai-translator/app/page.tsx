'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useMicVAD } from '@ricky0123/vad-react';
import { useAppStore } from './store/useAppStore';
import { float32ToWav } from '@/utils/audio';
import ShapeMorph from '@/components/ShapeMorph';
import SidePanel from '@/components/SidePanel';
import { Menu } from 'lucide-react';

export default function LiveTranslator() {
  // Zustand Store
  const { 
    status, 
    setStatus, 
    isListening, 
    setIsListening,
    isPlayingAudio,
    setIsPlayingAudio,
    toggleSidePanel
  } = useAppStore();

  const [logs, setLogs] = useState<string[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [audioContextUnlocked, setAudioContextUnlocked] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isSecureContext, setIsSecureContext] = useState(true);

  // Check secure context on mount (required for iOS)
  useEffect(() => {
    const checkSecureContext = () => {
      // Check if we're in a secure context (HTTPS or localhost)
      const isSecure = window.isSecureContext || 
                       window.location.protocol === 'https:' || 
                       window.location.hostname === 'localhost' ||
                       window.location.hostname === '127.0.0.1';
      
      setIsSecureContext(isSecure);
      
      if (!isSecure) {
        setPermissionError('Microphone access requires HTTPS on mobile devices. Please use HTTPS or localhost.');
        addLog('Error: Not a secure context (HTTPS required)');
      }
    };
    
    checkSecureContext();
  }, []);

  // Unlock audio context on user interaction
  const unlockAudio = () => {
    if (!silentAudioRef.current) {
      // Create a silent audio element to unlock audio context
      const silentAudio = new Audio('data:audio/wav;base64,UklGRi9AAABAAAAAAABAAEA8AEAAP///AAAABJRU5ErkJggg==');
      silentAudioRef.current = silentAudio;
      
      silentAudio.play().then(() => {
        silentAudio.pause();
        silentAudio.currentTime = 0;
        setAudioContextUnlocked(true);
      }).catch((e) => {
        console.warn('Audio unlock failed:', e);
      });
    } else {
      setAudioContextUnlocked(true);
    }
  };

  // Cleanup object URLs
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const addLog = (msg: string) => setLogs(prev => [...prev.slice(-4), msg]);

  // API Mutation
  const processAudioMutation = useMutation({
    mutationFn: async (audioBlob: Blob) => {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'input.wav');
      
      const response = await fetch('/api/conversation', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process audio');
      }

      return response.blob();
    },
    onMutate: () => {
      setStatus('transcribing');
      addLog('Processing audio...');
    },
    onSuccess: (audioBlob) => {
      setStatus('generating_audio');
      addLog('Audio received, playing...');
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);
      
      // Auto-play if audio context is unlocked
      if (audioContextUnlocked && audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play().then(() => {
          setIsPlayingAudio(true);
          setStatus('speaking');
        }).catch(error => {
          console.error("Autoplay failed:", error);
          addLog("Autoplay failed - click play button");
        });
      }
    },
    onError: (error) => {
      console.error(error);
      addLog(`Error: ${error.message}`);
      setStatus('listening');
      // Resume VAD if error
      if (isListening) vad.start();
    }
  });

  // VAD Hook
  const vad = useMicVAD({
    startOnLoad: false,
    baseAssetPath: "/",
    onnxWASMBasePath: "/",
    onSpeechStart: () => {
      if (status === 'listening') {
        setStatus('listening');
        addLog('User started speaking...');
      }
    },
    onSpeechEnd: (audio) => {
      if (status !== 'listening') return; // Ignore if not in listening mode

      addLog('Speech ended, processing...');
      vad.pause(); // Pause VAD while processing
      
      const wavBlob = float32ToWav(audio);
      processAudioMutation.mutate(wavBlob);
    },
    onVADMisfire: () => {
      addLog('VAD misfire (noise detected)');
    },
  });

  // Cancel everything and reset to idle
  const cancelSession = useCallback(() => {
    // Stop VAD
    vad.pause();
    setIsListening(false);
    
    // Stop stream
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    
    // Stop any audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlayingAudio(false);
    
    // Reset state
    setStatus('idle');
    addLog('Session cancelled');
  }, [vad, stream, setIsListening, setStatus, setIsPlayingAudio]);

  // Start/Stop Session
  const toggleSession = useCallback(async () => {
    if (isListening) {
      cancelSession();
    } else {
      try {
        // Clear any previous errors
        setPermissionError(null);
        
        // Check if getUserMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Your browser does not support microphone access. Please use a modern browser.');
        }
        
        // Unlock audio context on user interaction
        unlockAudio();
        
        addLog('Requesting microphone permission...');
        
        // Enhanced audio constraints for better mobile compatibility
        const constraints: MediaStreamConstraints = {
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            // Mobile-friendly sample rate
            sampleRate: { ideal: 16000 },
          }
        };
        
        // Capture stream first for visualization
        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Verify we got an audio track
        const audioTracks = mediaStream.getAudioTracks();
        if (audioTracks.length === 0) {
          throw new Error('No audio track available. Please check your microphone.');
        }
        
        addLog(`Microphone access granted: ${audioTracks[0].label}`);
        setStream(mediaStream);
        
        // Small delay before starting VAD on mobile devices
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        vad.start();
        setIsListening(true);
        setStatus('listening');
        addLog('Session started - Speak now!');
      } catch (err: any) {
        console.error("Microphone access error:", err);
        
        // Provide specific error messages based on error type
        let errorMessage = 'Microphone access failed';
        
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMessage = 'Microphone permission denied. Please allow microphone access in your browser settings.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMessage = 'No microphone found. Please connect a microphone and try again.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          errorMessage = 'Microphone is already in use by another application.';
        } else if (err.name === 'OverconstrainedError') {
          errorMessage = 'Microphone does not meet requirements. Trying with basic settings...';
          
          // Retry with basic constraints
          try {
            const basicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setStream(basicStream);
            vad.start();
            setIsListening(true);
            setStatus('listening');
            addLog('Session started with basic audio settings');
            return;
          } catch (retryErr) {
            errorMessage = 'Failed to access microphone even with basic settings.';
          }
        } else if (err.name === 'SecurityError') {
          errorMessage = 'Security error: Microphone access requires HTTPS on mobile devices.';
        } else if (err.message) {
          errorMessage = err.message;
        }
        
        setPermissionError(errorMessage);
        addLog(`Error: ${errorMessage}`);
      }
    }
  }, [isListening, vad, setIsListening, setStatus, stream]);

  const playAudio = () => {
    if (audioRef.current && audioUrl) {
      audioRef.current.src = audioUrl;
      audioRef.current.play().then(() => {
        setIsPlayingAudio(true);
        setStatus('speaking');
      }).catch(error => {
        console.error("Playback failed:", error);
        addLog("Error: Could not play audio");
      });
    }
  };

  // Audio Ended Handler
  const handleAudioEnded = useCallback(() => {
    setIsPlayingAudio(false);
    setStatus('listening');
    addLog('Playback ended, listening...');
    if (isListening) {
      vad.start(); // Resume VAD
    }
  }, [isListening, setStatus, setIsPlayingAudio, vad]);

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-[var(--background)] text-[var(--foreground)] overflow-hidden">

      {/* Hamburger Menu Button - Mobile Only */}
      <button
        onClick={toggleSidePanel}
        className="fixed top-4 left-4 z-30 md:hidden p-2 rounded-lg hover:bg-[var(--border-light)] transition-colors"
        aria-label="Open settings"
      >
        <Menu 
          size={20} 
          className="text-[var(--muted-foreground)]"
        />
      </button>

      {/* Side Panel */}
      <SidePanel />

      {/* Error Display - Fixed at top */}
      {permissionError && (
        <div className="absolute top-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md bg-red-100/20 backdrop-blur-xl border border-red-500/30 rounded-2xl p-4 z-50 dark:bg-red-900/20">
          <div className="flex items-start gap-3">
            <div className="text-red-500 dark:text-red-400 text-xl">⚠️</div>
            <div className="flex-1">
              <h3 className="text-red-600 dark:text-red-400 font-semibold mb-1 text-sm">Microphone Error</h3>
              <p className="text-xs text-red-700/80 dark:text-red-200/80">{permissionError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Main Shape Visualizer - Takes center stage */}
      <div className="relative z-10 w-full h-screen flex items-center justify-center">
        <ShapeMorph 
          status={status}
          stream={stream}
          audioElement={audioRef.current}
          onTap={() => {
            if (status === 'idle') {
              toggleSession();
            } else if (audioUrl && status === 'generating_audio' && !audioContextUnlocked) {
              unlockAudio();
              playAudio();
            }
          }}
        />
      </div>

      {/* Play button if needed */}
      {audioUrl && status === 'generating_audio' && !audioContextUnlocked && (
        <div className="absolute bottom-32 left-1/2 -translate-x-1/2 z-20">
          <button
            onClick={() => { unlockAudio(); playAudio(); }}
            className="px-5 py-2 bg-[var(--surface-elevated)] hover:bg-[var(--border-light)] backdrop-blur-xl rounded-full font-light transition-all text-xs tracking-wider border border-[var(--border)] text-[var(--foreground)]"
          >
            tap to play
          </button>
        </div>
      )}

      {/* Subtle Bottom Indicators */}
      <div className="absolute bottom-12 flex gap-8 opacity-30">
        <div 
          className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
            status === 'idle' ? 'bg-[var(--foreground)] scale-150' : 'bg-[var(--muted-foreground)]'
          }`} 
        />
        <div 
          className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
            status === 'listening' || status === 'transcribing' || status === 'thinking' ? 'bg-cyan-400 scale-150' : 'bg-[var(--muted-foreground)]'
          }`} 
        />
        <div 
          className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
            status === 'generating_audio' || status === 'speaking' ? 'bg-purple-400 scale-150' : 'bg-[var(--muted-foreground)]'
          }`} 
        />
      </div>

      {/* Cancel button - More visible when active */}
      {status !== 'idle' && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20">
          <button
            onClick={cancelSession}
            className="group relative w-12 h-12 rounded-full transition-all duration-300 hover:scale-110"
          >
            {/* Shadow glow effect */}
            <div className="absolute inset-0 rounded-full bg-red-500/20 blur-xl group-hover:bg-red-500/40 transition-all dark:bg-red-500/20 dark:group-hover:bg-red-500/40" />
            {/* Button content */}
            <div className="relative w-full h-full rounded-full border-2 border-red-500/40 bg-black/20 backdrop-blur-sm flex items-center justify-center group-hover:border-red-500 group-hover:bg-red-500/10 transition-all">
              <div className="w-4 h-4 rounded-sm bg-red-500 group-hover:scale-110 transition-all" />
            </div>
          </button>
        </div>
      )}

      {/* Hidden Audio Element */}
      <audio 
        ref={audioRef} 
        onEnded={handleAudioEnded}
        className="hidden" 
      />

      {/* Minimal debug info - bottom left corner */}
      {vad.loading && (
        <div className="absolute bottom-4 left-4 text-[10px] text-gray-600 opacity-30 tracking-wider">
          loading...
        </div>
      )}
    </div>
  );
}
