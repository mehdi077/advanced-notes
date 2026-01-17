'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/app/store/useAppStore';

interface ShapeMorphProps {
  status: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'generating_audio' | 'speaking';
  stream?: MediaStream | null;
  audioElement?: HTMLAudioElement | null;
  onTap?: () => void;
}

export default function ShapeMorph({ status, stream, audioElement, onTap }: ShapeMorphProps) {
  const theme = useAppStore((state) => state.theme);
  const [audioLevels, setAudioLevels] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Setup audio analyzer for listening state
  useEffect(() => {
    if (status === 'listening' && stream) {
      try {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.85;

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const updateAudioData = () => {
          if (analyserRef.current && status === 'listening') {
            analyserRef.current.getByteFrequencyData(dataArray);
            
            const samples = 12;
            const levels = [];
            for (let i = 0; i < samples; i++) {
              const start = Math.floor((i * bufferLength) / samples);
              const end = Math.floor(((i + 1) * bufferLength) / samples);
              let sum = 0;
              for (let j = start; j < end; j++) {
                sum += dataArray[j];
              }
              levels.push((sum / (end - start)) / 255);
            }
            setAudioLevels(levels);
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
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.85;

        const source = audioContext.createMediaElementSource(audioElement);
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const updateAudioData = () => {
          if (analyserRef.current && status === 'speaking') {
            analyserRef.current.getByteFrequencyData(dataArray);
            
            const samples = 12;
            const levels = [];
            for (let i = 0; i < samples; i++) {
              const start = Math.floor((i * bufferLength) / samples);
              const end = Math.floor(((i + 1) * bufferLength) / samples);
              let sum = 0;
              for (let j = start; j < end; j++) {
                sum += dataArray[j];
              }
              levels.push((sum / (end - start)) / 255);
            }
            setAudioLevels(levels);
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

  // Calculate average audio level
  const averageLevel = audioLevels.reduce((a, b) => a + b, 0) / audioLevels.length;

  // Get colors and styles based on status
  const getStatusConfig = () => {
    switch (status) {
      case 'idle':
        return {
          gradient: theme === 'light' 
            ? 'radial-gradient(circle at 30% 30%, #cbd5e1 0%, #94a3b8 50%, #64748b 100%)'
            : 'radial-gradient(circle at 30% 30%, #64748b 0%, #475569 50%, #334155 100%)',
          glowColor: theme === 'light' ? 'bg-slate-300/10' : 'bg-slate-500/10',
          glowOpacity: theme === 'light' ? [0.05, 0.1, 0.05] : [0.1, 0.2, 0.1],
          shadowColor: theme === 'light' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(100, 116, 139, 0.2)',
          particleColor: theme === 'light' ? 'bg-slate-400' : 'bg-slate-400',
          showParticles: false,
        };
      case 'listening':
        return {
          gradient: theme === 'light'
            ? 'radial-gradient(circle at 30% 30%, #67e8f9 0%, #22d3ee 50%, #0891b2 100%)'
            : 'radial-gradient(circle at 30% 30%, #22d3ee 0%, #0891b2 50%, #164e63 100%)',
          glowColor: 'bg-cyan-500/10',
          glowOpacity: [0.3, 0.6, 0.3],
          shadowColor: 'rgba(34, 211, 238, 0.3)',
          particleColor: 'bg-cyan-400',
          showParticles: true,
        };
      case 'transcribing':
      case 'thinking':
        return {
          gradient: theme === 'light'
            ? 'radial-gradient(circle at 30% 30%, #93c5fd 0%, #60a5fa 50%, #3b82f6 100%)'
            : 'radial-gradient(circle at 30% 30%, #60a5fa 0%, #3b82f6 50%, #1e40af 100%)',
          glowColor: 'bg-blue-500/10',
          glowOpacity: [0.2, 0.4, 0.2],
          shadowColor: 'rgba(59, 130, 246, 0.25)',
          particleColor: 'bg-blue-400',
          showParticles: true,
        };
      case 'generating_audio':
        return {
          gradient: theme === 'light'
            ? 'radial-gradient(circle at 30% 30%, #c4b5fd 0%, #a78bfa 50%, #8b5cf6 100%)'
            : 'radial-gradient(circle at 30% 30%, #a78bfa 0%, #8b5cf6 50%, #6d28d9 100%)',
          glowColor: 'bg-violet-500/10',
          glowOpacity: [0.25, 0.45, 0.25],
          shadowColor: 'rgba(139, 92, 246, 0.28)',
          particleColor: 'bg-violet-400',
          showParticles: true,
        };
      case 'speaking':
        return {
          gradient: theme === 'light'
            ? 'radial-gradient(circle at 30% 30%, #d8b4fe 0%, #c084fc 50%, #a855f7 100%)'
            : 'radial-gradient(circle at 30% 30%, #c084fc 0%, #a855f7 50%, #7e22ce 100%)',
          glowColor: 'bg-purple-500/10',
          glowOpacity: [0.3, 0.7, 0.3],
          shadowColor: 'rgba(168, 85, 247, 0.4)',
          particleColor: 'bg-purple-400',
          showParticles: true,
        };
      default:
        return {
          gradient: theme === 'light'
            ? 'radial-gradient(circle at 30% 30%, #cbd5e1 0%, #94a3b8 50%, #64748b 100%)'
            : 'radial-gradient(circle at 30% 30%, #64748b 0%, #475569 50%, #334155 100%)',
          glowColor: theme === 'light' ? 'bg-slate-300/10' : 'bg-slate-500/10',
          glowOpacity: theme === 'light' ? [0.05, 0.1, 0.05] : [0.1, 0.2, 0.1],
          shadowColor: theme === 'light' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(100, 116, 139, 0.2)',
          particleColor: 'bg-slate-400',
          showParticles: false,
        };
    }
  };

  const config = getStatusConfig();
  const isActive = status !== 'idle';

  // Calculate orb scale based on audio
  const getOrbScale = () => {
    if (status === 'listening' || status === 'speaking') {
      return 1 + (averageLevel * 0.15);
    }
    return 1;
  };

  return (
    <div 
      className="flex items-center justify-center h-full w-full cursor-pointer"
      onClick={onTap}
    >
      <div className="relative flex items-center justify-center h-[500px] w-[500px]">
        
        {/* Layer 1: The Ambient Glow (The "Soul") */}
        <motion.div
          animate={{
            scale: isActive ? [1, 1.2, 1] : 1,
            opacity: config.glowOpacity,
          }}
          transition={{ 
            duration: 2, 
            repeat: Infinity, 
            ease: "easeInOut" 
          }}
          className={`absolute w-80 h-80 rounded-full ${config.glowColor} blur-[100px]`}
        />

        {/* Layer 2: Rotating Technical Rings */}
        {[...Array(3)].map((_, i) => (
          <motion.div
            key={i}
            animate={{ rotate: i % 2 === 0 ? 360 : -360 }}
            transition={{ 
              duration: status === 'idle' ? 20 + i * 5 : 10 + i * 5, 
              repeat: Infinity, 
              ease: "linear" 
            }}
            className="absolute rounded-full border border-[var(--border)] border-opacity-10"
            style={{
              width: 300 + i * 40,
              height: 300 + i * 40,
              borderStyle: i === 1 ? "dashed" : "solid",
            }}
          />
        ))}

        {/* Layer 3: Audio-reactive satellite particles for listening */}
        {status === 'listening' && audioLevels.map((level, i) => {
          const angle = (i / audioLevels.length) * Math.PI * 2;
          const radius = 140 + (level * 25);
          const size = 8 + (level * 6);
          
          return (
            <motion.div
              key={`listen-particle-${i}`}
              className="absolute rounded-full bg-cyan-400 blur-[2px]"
              style={{
                width: size,
                height: size,
                left: `calc(50% + ${Math.cos(angle) * radius}px)`,
                top: `calc(50% + ${Math.sin(angle) * radius}px)`,
                marginLeft: -size / 2,
                marginTop: -size / 2,
              }}
              animate={{
                opacity: 0.4 + level * 0.6,
                scale: 1 + level * 0.5,
              }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 20,
              }}
            />
          );
        })}

        {/* Layer 3: Audio-reactive satellite particles for speaking */}
        {status === 'speaking' && audioLevels.map((level, i) => {
          const angle = (i / audioLevels.length) * Math.PI * 2;
          const radius = 140 + (level * 30);
          const size = 10 + (level * 8);
          
          return (
            <motion.div
              key={`speak-particle-${i}`}
              className="absolute rounded-full bg-purple-400 blur-[2px]"
              style={{
                width: size,
                height: size,
                left: `calc(50% + ${Math.cos(angle) * radius}px)`,
                top: `calc(50% + ${Math.sin(angle) * radius}px)`,
                marginLeft: -size / 2,
                marginTop: -size / 2,
              }}
              animate={{
                opacity: 0.5 + level * 0.5,
                scale: 1 + level * 0.6,
              }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 25,
              }}
            />
          );
        })}

        {/* Layer 4: The Interactive Core Orb */}
        <motion.div
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          animate={{
            scale: getOrbScale(),
            boxShadow: isActive
              ? `0px 0px 40px 10px ${config.shadowColor}`
              : `0px 0px 20px 0px ${theme === 'light' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`,
          }}
          transition={{
            scale: {
              type: "spring",
              stiffness: 300,
              damping: 25,
            },
            boxShadow: {
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }
          }}
          className="relative z-10 w-40 h-40 rounded-full cursor-pointer flex items-center justify-center shadow-2xl overflow-hidden"
          style={{
            background: config.gradient,
          }}
        >
          {/* Internal Liquid-like effect */}
          <motion.div 
            animate={{ 
              y: [0, -10, 0], 
              x: [0, 5, 0],
              scale: status === 'listening' || status === 'speaking' ? [1, 1.1, 1] : 1,
            }}
            transition={{ 
              y: { duration: 4, repeat: Infinity },
              x: { duration: 4, repeat: Infinity },
              scale: { duration: 2, repeat: Infinity },
            }}
            className="absolute inset-0 bg-white/10 blur-xl rounded-full"
          />
        </motion.div>

        {/* Layer 5: Particle Orbits (Visible when active) */}
        {config.showParticles && (
          <AnimatePresence>
            {[...Array(8)].map((_, i) => {
              const angle = (i / 8) * Math.PI * 2;
              const radius = 150;
              
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ 
                    opacity: [0, 0.8, 0],
                    scale: [0.8, 1.2, 0.8],
                  }}
                  exit={{ opacity: 0, scale: 0 }}
                  transition={{ 
                    duration: 3, 
                    repeat: Infinity, 
                    delay: i * 0.375,
                    ease: "easeInOut" 
                  }}
                  className={`absolute w-2 h-2 ${config.particleColor} rounded-full blur-[1px]`}
                  style={{
                    left: `calc(50% + ${Math.cos(angle) * radius}px)`,
                    top: `calc(50% + ${Math.sin(angle) * radius}px)`,
                    marginLeft: -4,
                    marginTop: -4,
                  }}
                />
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
