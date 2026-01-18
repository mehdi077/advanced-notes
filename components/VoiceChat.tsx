'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useMicVAD } from '@ricky0123/vad-react';
import { useVoiceStore } from '@/lib/stores/useVoiceStore';
import { float32ToWav } from '@/utils/audio';
import SimpleVisualizer from '@/components/SimpleVisualizer';
import { X } from 'lucide-react';

export default function VoiceChat() {
  const { 
    status, 
    setStatus, 
    isListening, 
    setIsListening,
    isPlayingAudio,
    setIsPlayingAudio,
    isModalOpen,
    setIsModalOpen,
    conversationHistory,
    addToConversation,
    clearConversation,
  } = useVoiceStore();

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioContextUnlocked, setAudioContextUnlocked] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTranscription, setCurrentTranscription] = useState<string>('');
  const [currentGeneration, setCurrentGeneration] = useState<string>('');
  const conversationScrollRef = useRef<HTMLDivElement>(null);

  // Cleanup object URLs
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  // Unlock audio context on user interaction
  const unlockAudio = () => {
    const silentAudio = new Audio('data:audio/wav;base64,UklGRi9AAABAAAAAAABAAEA8AEAAP///AAAABJRU5ErkJggg==');
    silentAudio.play().then(() => {
      silentAudio.pause();
      silentAudio.currentTime = 0;
      setAudioContextUnlocked(true);
    }).catch((e) => {
      console.warn('Audio unlock failed:', e);
    });
  };

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    if (conversationScrollRef.current) {
      conversationScrollRef.current.scrollTop = conversationScrollRef.current.scrollHeight;
    }
  }, [conversationHistory, currentTranscription, currentGeneration]);

  // Process audio through API
  const processAudio = async (audioBlob: Blob) => {
    try {
      setStatus('transcribing');\n      setIsProcessing(true);\n      setCurrentTranscription('');\n      setCurrentGeneration('');\n\n      // Brief delay to show transcribing\n      await new Promise(resolve => setTimeout(resolve, 800));\n      setStatus('thinking');

      const formData = new FormData();
      formData.append('audio', audioBlob, 'input.wav');
      formData.append('conversationHistory', JSON.stringify(conversationHistory));
      
      const response = await fetch('/api/voice', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process audio');
      }

      // Get transcription and response text from headers
      const transcription = decodeURIComponent(response.headers.get('X-Transcription') || '');
      const responseText = decodeURIComponent(response.headers.get('X-Response-Text') || '');

      // Show transcription first
      if (transcription) {
        setCurrentTranscription(transcription);
        // Wait a bit to show transcription before moving to generation
        await new Promise(resolve => setTimeout(resolve, 500));
        addToConversation('user', transcription);
        setCurrentTranscription('');
      }

      // Show generation text
      setStatus('generating_audio');
      if (responseText) {
        setCurrentGeneration(responseText);
        // Wait a bit to show generation before moving to speaking
        await new Promise(resolve => setTimeout(resolve, 500));
        addToConversation('assistant', responseText);
        setCurrentGeneration('');
      }

      const audioBlob = await response.blob();
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
        });
      }
    } catch (error: any) {
      console.error('Processing error:', error);
      setPermissionError(error.message);
      setStatus('listening');
      setCurrentTranscription('');
      setCurrentGeneration('');
      // Resume VAD if error
      if (isListening) vad.start();
    } finally {
      setIsProcessing(false);
    }
  };

  // VAD Hook with custom stream handler for visualization
  const vad = useMicVAD({\n    stream,\n    startOnLoad: false,\n    baseAssetPath: \"/\",\n    onnxWASMBasePath: \"/\",\n    positiveSpeechThreshold: 0.5,\n    negativeSpeechThreshold: 0.35,\n    redemptionFrames: 8,\n    preSpeechPadFrames: 1,\n    minSpeechFrames: 3,\n    onSpeechStart: () => {\n      console.log('🎤 VAD: Speech started');\n    },\n    onSpeechEnd: (audio) => {\n      console.log('🎤 VAD: Speech ended, audio length:', audio.length);\n      if (status !== 'listening') {\n        console.log('⚠️ Ignoring speech end - not in listening state, current status:', status);\n        return;\n      }\n\n      console.log('✅ Processing speech...');\n      vad.pause();\n      \n      const wavBlob = float32ToWav(audio);\n      console.log('📦 WAV blob created, size:', wavBlob.size);\n      processAudio(wavBlob);\n    },\n    onVADMisfire: () => {\n      console.log('⚠️ VAD misfire (noise detected)');\n    },\n  });

  // Cancel everything and reset to idle
  const cancelSession = useCallback(() => {
    vad.pause();
    setIsListening(false);
    
    // Clear stream reference (VAD will handle cleanup internally)
    if (stream) {
      setStream(null);
    }
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlayingAudio(false);
    setStatus('idle');
  }, [vad, stream, setIsListening, setStatus, setIsPlayingAudio]);

  // Start/Stop Session
  const toggleSession = useCallback(async () => {
    if (isListening) {
      cancelSession();
    } else {
      try {
        setPermissionError(null);
        
        // Unlock audio context on user interaction
        unlockAudio();
        
        console.log('🎬 Starting VAD (VAD will handle microphone access)...');
        
        // Let VAD handle microphone access internally
        // The library will prompt for permission and manage the stream
        vad.start();
        
        setIsListening(true);
        setStatus('listening');
        console.log('✅ VAD started - Listening for speech...');
        console.log('📊 VAD state - loading:', vad.loading, 'listening:', vad.listening, 'errored:', vad.errored);
      } catch (err: any) {
        console.error("VAD start error:", err);
        
        // Provide specific error messages based on error type
        let errorMessage = 'Failed to start voice detection';
        
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMessage = 'Microphone permission denied. Please allow microphone access in your browser settings.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMessage = 'No microphone found. Please connect a microphone and try again.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          errorMessage = 'Microphone is already in use by another application.';
        } else if (err.name === 'SecurityError') {
          errorMessage = 'Security error: Microphone access requires HTTPS on mobile devices.';
        } else if (err.message) {
          errorMessage = err.message;
        }
        
        setPermissionError(errorMessage);
        setStatus('idle');
        setIsListening(false);
      }
    }
  }, [isListening, vad, setIsListening, setStatus]);

  // Audio Ended Handler
  const handleAudioEnded = useCallback(() => {
    setIsPlayingAudio(false);
    setStatus('listening');
    if (isListening) {
      vad.start();
    }
  }, [isListening, setStatus, setIsPlayingAudio, vad]);

  // Close modal handler with conversation wipe
  const closeModal = () => {
    cancelSession();
    clearConversation();
    setIsModalOpen(false);
    setPermissionError(null);
    setCurrentTranscription('');
    setCurrentGeneration('');
  };

  if (!isModalOpen) return null;

  return (
    <>
      {/* Backdrop blur */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={closeModal}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4">
        <div className="relative bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 w-full max-w-3xl max-h-[70vh] flex flex-col overflow-hidden">
          
          {/* Close button */}
          <button
            onClick={closeModal}
            className="absolute top-3 right-3 md:top-4 md:right-4 z-10 p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white"
          >
            <X size={18} className="md:w-5 md:h-5" />
          </button>

          {/* Header */}
          <div className="px-4 py-3 md:px-6 md:py-4 border-b border-zinc-800 flex-shrink-0">
            <h2 className="text-lg md:text-xl font-semibold text-white pr-10">Voice Assistant</h2>
            <p className="text-xs md:text-sm text-zinc-400 mt-1">
              {vad.loading ? 'Loading voice detection...' :
               status === 'idle' ? 'Tap START to begin' : 
               status === 'listening' ? 'Listening...' :
               status === 'transcribing' ? 'Transcribing...' :
               status === 'thinking' ? 'Thinking...' :
               status === 'generating_audio' ? 'Generating...' :
               status === 'speaking' ? 'Speaking...' : ''}
            </p>
          </div>

          {/* Error Display */}
          {permissionError && (
            <div className="mx-4 mt-3 md:mx-6 md:mt-4 bg-red-900/20 border border-red-500/30 rounded-lg p-2 md:p-3 flex-shrink-0">
              <p className="text-xs md:text-sm text-red-300">{permissionError}</p>
            </div>
          )}

          {/* Mobile: Stack layout, Desktop: Two column layout */}
          <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
            
            {/* Visualizer section */}
            <div className="relative flex flex-col items-center justify-center md:flex-1 min-w-0 py-4">
              <SimpleVisualizer 
                status={status} 
                stream={stream}
                audioElement={audioRef.current}
              />

              {/* Start button */}
              {status === 'idle' && (
                <button
                  onClick={toggleSession}
                  disabled={isProcessing || vad.loading}
                  className="mt-4 px-6 py-2.5 md:px-8 md:py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-full text-white font-medium text-sm md:text-base shadow-lg transition-colors"
                >
                  {vad.loading ? 'Loading VAD...' : isProcessing ? 'Loading...' : 'START'}
                </button>
              )}

              {/* Stop button */}
              {status !== 'idle' && (
                <button
                  onClick={cancelSession}
                  className="mt-4 px-6 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-full text-white font-medium text-sm transition-colors"
                >
                  STOP
                </button>
              )}
            </div>

            {/* Live conversation view */}
            {(status !== 'idle' || conversationHistory.length > 0) && (
              <div className="flex-1 md:w-80 md:flex-none border-t md:border-t-0 md:border-l border-zinc-800 flex flex-col bg-zinc-950/50">
                <div className="px-3 py-2 md:px-4 md:py-3 border-b border-zinc-800 flex-shrink-0">
                  <h3 className="text-xs md:text-sm font-semibold text-zinc-300">Live Transcript</h3>
                </div>
                
                <div 
                  ref={conversationScrollRef}
                  className="flex-1 overflow-y-auto px-3 py-2 md:px-4 md:py-3 space-y-2 md:space-y-3 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent"
                >
                  {/* Past conversation history */}
                  {conversationHistory.map((msg, idx) => (
                    <div 
                      key={idx} 
                      className={`flex flex-col gap-0.5 md:gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <span className="text-[10px] md:text-xs text-zinc-500 px-1">
                        {msg.role === 'user' ? 'You' : 'AI'}
                      </span>
                      <div 
                        className={`px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg text-xs md:text-sm max-w-[90%] md:max-w-[85%] ${
                          msg.role === 'user' 
                            ? 'bg-cyan-900/30 text-cyan-100 border border-cyan-800/30' 
                            : 'bg-purple-900/30 text-purple-100 border border-purple-800/30'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  
                  {/* Current transcription (while transcribing) */}
                  {currentTranscription && (
                    <div className="flex flex-col gap-0.5 md:gap-1 items-end animate-pulse">
                      <span className="text-[10px] md:text-xs text-zinc-500 px-1">You (transcribing...)</span>
                      <div className="px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg text-xs md:text-sm max-w-[90%] md:max-w-[85%] bg-cyan-900/40 text-cyan-100 border border-cyan-700/50">
                        {currentTranscription}
                      </div>
                    </div>
                  )}
                  
                  {/* Current generation (while generating) */}
                  {currentGeneration && (
                    <div className="flex flex-col gap-0.5 md:gap-1 items-start animate-pulse">
                      <span className="text-[10px] md:text-xs text-zinc-500 px-1">AI (generating...)</span>
                      <div className="px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg text-xs md:text-sm max-w-[90%] md:max-w-[85%] bg-purple-900/40 text-purple-100 border border-purple-700/50">
                        {currentGeneration}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Hidden Audio Element */}
          <audio 
            ref={audioRef} 
            onEnded={handleAudioEnded}
            className="hidden" 
          />
        </div>
      </div>
    </>
  );
}
