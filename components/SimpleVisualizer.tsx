'use client';

import { useEffect, useRef, useState } from 'react';

interface SimpleVisualizerProps {
  status: 'idle' | 'recording' | 'ready_to_generate' | 'transcribing' | 'thinking' | 'generating_audio' | 'speaking';
  stream?: MediaStream | null;
  audioElement?: HTMLAudioElement | null;
}

export default function SimpleVisualizer({ status, stream, audioElement }: SimpleVisualizerProps) {
  const [audioLevel, setAudioLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Setup audio analyzer for recording state
  useEffect(() => {
    if (status === 'recording' && stream) {
      try {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateAudioData = () => {
          if (analyserRef.current && status === 'recording') {
            analyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            setAudioLevel(average / 255);
            animationFrameRef.current = requestAnimationFrame(updateAudioData);
          }
        };

        updateAudioData();
      } catch (error) {
        console.error('Audio analyzer setup failed:', error);
      }

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
      };
    }
  }, [status, stream]);

  // Setup audio analyzer for speaking state
  useEffect(() => {
    if (status === 'speaking' && audioElement) {
      try {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;

        const source = audioContext.createMediaElementSource(audioElement);
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateAudioData = () => {
          if (analyserRef.current && status === 'speaking') {
            analyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            setAudioLevel(average / 255);
            animationFrameRef.current = requestAnimationFrame(updateAudioData);
          }
        };

        updateAudioData();
      } catch (error) {
        console.error('Audio analyzer setup failed:', error);
      }

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
      };
    }
  }, [status, audioElement]);
  
  const getStatusColor = () => {
    switch (status) {
      case 'recording':
        return 'bg-red-500';
      case 'ready_to_generate':
        return 'bg-green-500';
      case 'transcribing':
      case 'thinking':
        return 'bg-blue-500';
      case 'generating_audio':
        return 'bg-violet-500';
      case 'speaking':
        return 'bg-purple-500';
      default:
        return 'bg-zinc-500';
    }
  };

  const getRingColor = () => {
    switch (status) {
      case 'recording':
        return 'border-red-500';
      case 'ready_to_generate':
        return 'border-green-500';
      case 'transcribing':
      case 'thinking':
        return 'border-blue-500';
      case 'generating_audio':
        return 'border-violet-500';
      case 'speaking':
        return 'border-purple-500';
      default:
        return 'border-zinc-500';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'recording':
        return 'Recording...';
      case 'ready_to_generate':
        return 'Ready';
      case 'transcribing':
        return 'Transcribing...';
      case 'thinking':
        return 'Thinking...';
      case 'generating_audio':
        return 'Generating...';
      case 'speaking':
        return 'Speaking...';
      default:
        return 'Idle';
    }
  };

  const shouldPulse = status === 'recording' || status === 'speaking';
  const effectiveAudioLevel = shouldPulse ? audioLevel : 0;
  const scale = 1 + (effectiveAudioLevel * 0.3);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-6">
      {/* Status indicator with audio-reactive pulse */}
      <div className="relative w-24 h-24 flex items-center justify-center">
        {/* Pulse rings - audio-reactive for listening and speaking */}
        {shouldPulse && effectiveAudioLevel > 0.05 && (
          <>
            <div 
              className={`absolute rounded-full border-2 ${getRingColor()} transition-all`} 
              style={{
                width: `${80 + (effectiveAudioLevel * 40)}px`,
                height: `${80 + (effectiveAudioLevel * 40)}px`,
                opacity: 0.6 * effectiveAudioLevel,
              }}
            />
            <div 
              className={`absolute rounded-full border-2 ${getRingColor()} transition-all`} 
              style={{
                width: `${100 + (effectiveAudioLevel * 60)}px`,
                height: `${100 + (effectiveAudioLevel * 60)}px`,
                opacity: 0.4 * effectiveAudioLevel,
              }}
            />
          </>
        )}
        
        {/* Core circle - audio-reactive scale */}
        <div 
          className={`w-16 h-16 rounded-full ${getStatusColor()} transition-all duration-150 relative z-10`}
          style={{
            transform: `scale(${scale})`,
          }}
        />
      </div>
      
      {/* Status text */}
      <p className="text-sm text-zinc-400">{getStatusText()}</p>
    </div>
  );
}
