'use client';

interface SimpleVisualizerProps {
  status: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'generating_audio' | 'speaking';
}

export default function SimpleVisualizer({ status }: SimpleVisualizerProps) {
  const getStatusColor = () => {
    switch (status) {
      case 'listening':
        return 'bg-cyan-500';
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
      case 'listening':
        return 'border-cyan-500';
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
      case 'listening':
        return 'Listening...';
      case 'transcribing':
        return 'Transcribing...';
      case 'thinking':
        return 'Thinking...';
      case 'generating_audio':
        return 'Generating...';
      case 'speaking':
        return 'Speaking...';
      default:
        return 'Ready';
    }
  };

  const shouldPulse = status === 'listening' || status === 'speaking';

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-6">
      {/* Status indicator with pulse rings for listening and speaking */}
      <div className="relative w-20 h-20 flex items-center justify-center">
        {/* Pulse rings - only for listening and speaking */}
        {shouldPulse && (
          <>
            <div className={`absolute inset-0 rounded-full border-2 ${getRingColor()} opacity-75 animate-ping`} />
            <div className={`absolute inset-2 rounded-full border-2 ${getRingColor()} opacity-50 animate-ping`} style={{ animationDelay: '0.3s' }} />
          </>
        )}
        
        {/* Core circle */}
        <div 
          className={`w-16 h-16 rounded-full ${getStatusColor()} transition-colors duration-300 relative z-10`}
        />
      </div>
      
      {/* Status text */}
      <p className="text-sm text-zinc-400">{getStatusText()}</p>
    </div>
  );
}
