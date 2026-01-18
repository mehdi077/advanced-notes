'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useVoiceStore } from '@/lib/stores/useVoiceStore';
import SimpleVisualizer from '@/components/SimpleVisualizer';
import { X, Mic, Square, Send } from 'lucide-react';

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
  
  // Manual recording state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup audio URLs
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      // Cleanup media stream
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      // Stop audio playback
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      // Clear recording timer
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [audioUrl, stream]);

  // Unlock audio context on user interaction
  const unlockAudio = useCallback(() => {
    if (audioContextUnlocked) return;
    const silentAudio = new Audio('data:audio/wav;base64,UklGRi9AAABAAAAAAABAAEA8AEAAP///AAAABJRU5ErkJggg==');
    silentAudio.play().then(() => {
      silentAudio.pause();
      silentAudio.currentTime = 0;
      setAudioContextUnlocked(true);
      console.log('✅ Audio context unlocked');
    }).catch((e) => {
      console.warn('Audio unlock failed:', e);
    });
  }, [audioContextUnlocked]);

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    if (conversationScrollRef.current) {
      conversationScrollRef.current.scrollTop = conversationScrollRef.current.scrollHeight;
    }
  }, [conversationHistory, currentTranscription, currentGeneration]);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setPermissionError(null);
      unlockAudio();

      console.log('🎤 Requesting microphone access...');
      
      // Request microphone access
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 16000 }
        }
      }).catch(async (err) => {
        if (err.name === 'OverconstrainedError') {
          console.log('📱 Using fallback audio constraints');
          return navigator.mediaDevices.getUserMedia({ audio: true });
        }
        throw err;
      });

      setStream(mediaStream);

      // Setup MediaRecorder
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(mediaStream, {
        mimeType: 'audio/webm',
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordedAudioBlob(audioBlob);
        setStatus('ready_to_generate');
        console.log('🎤 Recording stopped, blob size:', audioBlob.size);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      
      setStatus('recording');
      setIsListening(true);
      setRecordingDuration(0);
      
      // Start timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      console.log('✅ Recording started...');
      
    } catch (err: any) {
      console.error("❌ Microphone access error:", err);
      
      let errorMessage = 'Failed to start recording';
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = 'Microphone permission denied. Please allow microphone access.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage = 'No microphone found. Please connect a microphone.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage = 'Microphone is already in use.';
      } else if (err.name === 'SecurityError') {
        errorMessage = 'Security error: Microphone requires HTTPS.';
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setPermissionError(errorMessage);
      setStatus('idle');
      setIsListening(false);
    }
  }, [setStatus, setIsListening, unlockAudio]);

  // Stop recording
  const stopRecording = useCallback(() => {
    console.log('🛑 Stopping recording...');
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    
    setIsListening(false);
  }, [setIsListening]);

  // Process recorded audio through API
  const generateResponse = useCallback(async () => {
    if (!recordedAudioBlob) {
      console.error('No recorded audio to process');
      return;
    }

    try {
      setStatus('transcribing');
      setIsProcessing(true);
      setCurrentTranscription('');
      setCurrentGeneration('');
      setPermissionError(null);

      const formData = new FormData();
      formData.append('audio', recordedAudioBlob, 'input.webm');
      formData.append('conversationHistory', JSON.stringify(conversationHistory));
      
      const response = await fetch('/api/voice', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to process audio' }));
        throw new Error(errorData.error || 'Failed to process audio');
      }

      // Get transcription and response text from headers
      const transcription = decodeURIComponent(response.headers.get('X-Transcription') || '');
      const responseText = decodeURIComponent(response.headers.get('X-Response-Text') || '');

      // Show transcription
      if (transcription) {
        setStatus('thinking');
        setCurrentTranscription(transcription);
        await new Promise(resolve => setTimeout(resolve, 300));
        addToConversation('user', transcription);
        setCurrentTranscription('');
      }

      // Show generation text
      setStatus('generating_audio');
      if (responseText) {
        setCurrentGeneration(responseText);
        await new Promise(resolve => setTimeout(resolve, 300));
        addToConversation('assistant', responseText);
        setCurrentGeneration('');
      }

      // Get audio blob
      const responseAudioBlob = await response.blob();
      
      // Revoke previous audio URL if exists
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      
      const url = URL.createObjectURL(responseAudioBlob);
      setAudioUrl(url);
      
      // Auto-play
      if (audioRef.current) {
        audioRef.current.src = url;
        
        try {
          await audioRef.current.play();
          setIsPlayingAudio(true);
          setStatus('speaking');
        } catch (error) {
          console.error("Autoplay failed:", error);
          setStatus('idle');
        }
      }
      
      // Clear recorded blob
      setRecordedAudioBlob(null);
      
    } catch (error: any) {
      console.error('Processing error:', error);
      setPermissionError(error.message || 'Failed to process audio');
      setStatus('ready_to_generate');
    } finally {
      setIsProcessing(false);
    }
  }, [recordedAudioBlob, conversationHistory, audioUrl, setStatus, setIsPlayingAudio, addToConversation]);

  // Cancel/Reset everything
  const resetSession = useCallback(() => {
    console.log('🛑 Resetting session...');
    
    // Stop recording if active
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    // Clear recording timer
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    
    // Stop and cleanup media stream
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
        console.log('🔇 Stopped track:', track.kind);
      });
      setStream(null);
    }
    
    // Stop audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    
    // Reset all state
    setIsListening(false);
    setIsPlayingAudio(false);
    setStatus('idle');
    setIsProcessing(false);
    setRecordedAudioBlob(null);
    setRecordingDuration(0);
    audioChunksRef.current = [];
    
    console.log('✅ Session reset');
  }, [stream, setIsListening, setStatus, setIsPlayingAudio]);

  // Audio Ended Handler
  const handleAudioEnded = useCallback(() => {
    console.log('🔊 Audio playback ended');
    setIsPlayingAudio(false);
    setStatus('idle');
  }, [setStatus, setIsPlayingAudio]);

  // Close modal handler
  const closeModal = useCallback(() => {
    resetSession();
    clearConversation();
    setIsModalOpen(false);
    setPermissionError(null);
    setCurrentTranscription('');
    setCurrentGeneration('');
  }, [resetSession, clearConversation, setIsModalOpen]);

  // Format recording duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
              {status === 'idle' ? 'Press Record to start' : 
               status === 'recording' ? `Recording... ${formatDuration(recordingDuration)}` :
               status === 'ready_to_generate' ? 'Press Generate to process' :
               status === 'transcribing' ? 'Transcribing...' :
               status === 'thinking' ? 'Thinking...' :
               status === 'generating_audio' ? 'Generating response...' :
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

              {/* Control buttons */}
              <div className="mt-4 flex flex-col gap-2 items-center">
                {/* Idle state - Show Record button */}
                {status === 'idle' && (
                  <button
                    onClick={startRecording}
                    disabled={isProcessing}
                    className="px-6 py-2.5 md:px-8 md:py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-full text-white font-medium text-sm md:text-base shadow-lg transition-colors flex items-center gap-2"
                  >
                    <Mic size={18} />
                    RECORD
                  </button>
                )}

                {/* Recording state - Show Stop button */}
                {status === 'recording' && (
                  <button
                    onClick={stopRecording}
                    className="px-6 py-2.5 md:px-8 md:py-3 bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-500 rounded-full text-white font-medium text-sm md:text-base shadow-lg transition-colors flex items-center gap-2"
                  >
                    <Square size={18} />
                    STOP
                  </button>
                )}

                {/* Ready to generate - Show Generate button */}
                {status === 'ready_to_generate' && (
                  <div className="flex flex-col gap-2 items-center">
                    <button
                      onClick={generateResponse}
                      disabled={isProcessing}
                      className="px-6 py-2.5 md:px-8 md:py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-full text-white font-medium text-sm md:text-base shadow-lg transition-colors flex items-center gap-2"
                    >
                      <Send size={18} />
                      GENERATE
                    </button>
                    <button
                      onClick={resetSession}
                      className="px-4 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Processing states - Show status */}
                {(status === 'transcribing' || status === 'thinking' || status === 'generating_audio' || status === 'speaking') && (
                  <div className="px-6 py-2.5 text-sm text-zinc-400">
                    Processing...
                  </div>
                )}
              </div>
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
