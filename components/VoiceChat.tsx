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

  // Keep scroll at top (newest messages appear at top)
  useEffect(() => {
    if (conversationScrollRef.current) {
      conversationScrollRef.current.scrollTop = 0;
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
      
      // Detect supported MIME type
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
          mimeType = 'audio/ogg;codecs=opus';
        }
      }
      console.log('📼 Using MIME type:', mimeType);
      
      const mediaRecorder = new MediaRecorder(mediaStream, {
        mimeType: mimeType,
      });

      mediaRecorder.ondataavailable = (event) => {
        console.log('📊 Data available event fired! Size:', event.data.size, 'bytes');
        if (event.data && event.data.size > 0) {
          console.log('✅ Pushing chunk to array, current length:', audioChunksRef.current.length);
          audioChunksRef.current.push(event.data);
        } else {
          console.warn('⚠️ Data available but size is 0 or data is null');
        }
      };
      
      mediaRecorder.onerror = (event) => {
        console.error('❌ MediaRecorder error:', event);
        setPermissionError('Recording error occurred');
        setStatus('idle');
      };
      
      mediaRecorder.onstart = () => {
        console.log('🎬 MediaRecorder onstart event fired');
        console.log('📊 MediaRecorder state:', mediaRecorder.state);
      };

      mediaRecorder.onstop = async () => {
        console.log('🛑 MediaRecorder stopped, chunks:', audioChunksRef.current.length);
        
        if (audioChunksRef.current.length === 0) {
          console.error('❌ No audio data captured');
          setPermissionError('No audio recorded. Please try again.');
          setStatus('idle');
          return;
        }
        
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        console.log('🎤 Recording stopped, blob size:', audioBlob.size, 'type:', audioBlob.type);
        
        if (audioBlob.size === 0) {
          console.error('❌ Audio blob is empty');
          setPermissionError('Recording failed. Please try again.');
          setStatus('idle');
          return;
        }
        
        // Auto-generate immediately after stopping
        setRecordedAudioBlob(audioBlob);
        
        // Process the audio automatically
        try {
          setStatus('transcribing');
          setIsProcessing(true);
          setCurrentTranscription('');
          setCurrentGeneration('');
          setPermissionError(null);

          const formData = new FormData();
          formData.append('audio', audioBlob, 'input.webm');
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
          console.log('🔊 Received audio blob:', {
            size: responseAudioBlob.size,
            type: responseAudioBlob.type,
            contentType: response.headers.get('Content-Type')
          });
          
          // Validate audio blob
          if (responseAudioBlob.size === 0) {
            console.error('❌ Received empty audio blob');
            throw new Error('Received empty audio response');
          }
          
          // Validate audio type
          const contentType = responseAudioBlob.type;
          if (!contentType || (!contentType.includes('audio/') && !contentType.includes('application/octet-stream'))) {
            console.error('❌ Invalid audio content type:', contentType);
            throw new Error(`Invalid audio format: ${contentType}`);
          }
          
          // Check browser audio format support
          const audio = document.createElement('audio');
          const canPlayMP3 = audio.canPlayType('audio/mpeg');
          const canPlayWAV = audio.canPlayType('audio/wav');
          console.log('🎵 Browser audio support:', { mp3: canPlayMP3, wav: canPlayWAV });
          
          // Revoke previous audio URL if exists
          if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
          }
          
          const url = URL.createObjectURL(responseAudioBlob);
          setAudioUrl(url);
          console.log('🔗 Created audio URL:', url);
          
          // Auto-play
          if (audioRef.current) {
            const audioElement = audioRef.current;
            audioElement.src = url;
            
            // Set up one-time load event handler
            const handleLoadError = () => {
              console.error('❌ Audio failed to load after setting src');
              setPermissionError('Audio format not supported by browser');
              setStatus('idle');
            };
            
            audioElement.addEventListener('error', handleLoadError, { once: true });
            
            try {
              await audioElement.load(); // Ensure the audio is loaded
              console.log('▶️ Attempting to play audio...');
              
              // Try to play
              const playPromise = audioElement.play();
              
              if (playPromise !== undefined) {
                await playPromise;
                setIsPlayingAudio(true);
                setStatus('speaking');
                console.log('✅ Audio playing successfully');
                // Remove error listener if play succeeds
                audioElement.removeEventListener('error', handleLoadError);
              }
            } catch (error: any) {
              console.error("❌ Autoplay failed:", error);
              console.error("Error name:", error.name);
              console.error("Error message:", error.message);
              
              // Remove error listener
              audioElement.removeEventListener('error', handleLoadError);
              
              // Set error with helpful message
              if (error.name === 'NotAllowedError') {
                setPermissionError('Browser blocked autoplay. Please click the audio player to play.');
              } else if (error.name === 'NotSupportedError') {
                setPermissionError('Audio format not supported by your browser');
              } else {
                setPermissionError(`Audio playback failed: ${error.message}`);
              }
              
              setStatus('idle');
            }
          } else {
            console.error('❌ Audio ref not available');
            setStatus('idle');
          }
          
          // Clear recorded blob
          setRecordedAudioBlob(null);
          
        } catch (error: any) {
          console.error('Processing error:', error);
          setPermissionError(error.message || 'Failed to process audio');
          setStatus('idle');
        } finally {
          setIsProcessing(false);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      
      // Start recording with timeslice (collect data every 100ms)
      mediaRecorder.start(100);
      console.log('🎬 MediaRecorder started with timeslice=100ms');
      
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

  // Stop recording and auto-generate
  const stopRecording = useCallback(() => {
    console.log('🛑 Stopping recording...');
    console.log('Current chunks before stop:', audioChunksRef.current.length);
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      console.log('MediaRecorder state:', mediaRecorderRef.current.state);
      
      // Request data before stopping
      if (mediaRecorderRef.current.state === 'recording') {
        console.log('Requesting final data...');
        mediaRecorderRef.current.requestData();
      }
      
      // Stop after a small delay to ensure data is captured
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          console.log('Now stopping MediaRecorder...');
          mediaRecorderRef.current.stop();
        }
      }, 100);
    }
    
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    
    setIsListening(false);
  }, [setIsListening]);



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
                  className="flex-1 overflow-y-auto px-3 py-2 md:px-4 md:py-3 space-y-2 md:space-y-3 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent flex flex-col-reverse"
                >
                  {/* Current generation (while generating) - Shows first (at top) */}
                  {currentGeneration && (
                    <div className="flex flex-col gap-0.5 md:gap-1 items-start animate-pulse">
                      <span className="text-[10px] md:text-xs text-zinc-500 px-1">AI (generating...)</span>
                      <div className="px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg text-xs md:text-sm max-w-[90%] md:max-w-[85%] bg-purple-900/40 text-purple-100 border border-purple-700/50">
                        {currentGeneration}
                      </div>
                    </div>
                  )}
                  
                  {/* Current transcription (while transcribing) - Shows first (at top) */}
                  {currentTranscription && (
                    <div className="flex flex-col gap-0.5 md:gap-1 items-end animate-pulse">
                      <span className="text-[10px] md:text-xs text-zinc-500 px-1">You (transcribing...)</span>
                      <div className="px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg text-xs md:text-sm max-w-[90%] md:max-w-[85%] bg-cyan-900/40 text-cyan-100 border border-cyan-700/50">
                        {currentTranscription}
                      </div>
                    </div>
                  )}
                  
                  {/* Past conversation history - Reversed (newest first) */}
                  {[...conversationHistory].reverse().map((msg, idx) => (
                    <div 
                      key={conversationHistory.length - 1 - idx} 
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
                </div>
              </div>
            )}
          </div>

          {/* Hidden Audio Element */}
          <audio 
            ref={audioRef} 
            onEnded={handleAudioEnded}
            onError={(e) => {
              try {
                const audioElement = e.currentTarget;
                const error = audioElement.error;
                console.log('❌ Audio element error:', {
                  code: error?.code,
                  message: error?.message,
                  src: audioElement.src,
                  networkState: audioElement.networkState,
                  readyState: audioElement.readyState,
                });
                
                let errorMessage = 'Audio failed to load';
                if (error?.code) {
                  switch (error.code) {
                    case 1: // MEDIA_ERR_ABORTED
                      errorMessage = 'Audio loading was aborted';
                      break;
                    case 2: // MEDIA_ERR_NETWORK
                      errorMessage = 'Network error while loading audio';
                      break;
                    case 3: // MEDIA_ERR_DECODE
                      errorMessage = 'Audio format not supported or corrupted';
                      break;
                    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
                      errorMessage = 'Audio source not supported';
                      break;
                  }
                }
                
                setPermissionError(errorMessage);
                setStatus('idle');
                setIsPlayingAudio(false);
              } catch (err) {
                console.log('Error in audio error handler:', err);
                setPermissionError('Audio playback error');
                setStatus('idle');
                setIsPlayingAudio(false);
              }
            }}
            onLoadedData={() => console.log('✅ Audio loaded successfully')}
            onCanPlay={() => console.log('✅ Audio can play')}
            onPlay={() => console.log('▶️ Audio started playing')}
            onPause={() => console.log('⏸️ Audio paused')}
            playsInline
            className="hidden" 
          />
          
          {/* Manual play button if autoplay fails */}
          {audioUrl && !isPlayingAudio && status === 'idle' && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
              <button
                onClick={async () => {
                  if (audioRef.current) {
                    try {
                      await audioRef.current.play();
                      setIsPlayingAudio(true);
                      setStatus('speaking');
                    } catch (err) {
                      console.error('Manual play failed:', err);
                    }
                  }
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-full text-white text-sm shadow-lg"
              >
                ▶️ Play Response
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
