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

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-6">
      {/* Simple status indicator */}
      <div className="relative">
        <div 
          className={`w-16 h-16 rounded-full ${getStatusColor()} transition-colors duration-300 ${
            status !== 'idle' ? 'animate-pulse' : ''
          }`}
        />
      </div>
      
      {/* Status text */}
      <p className="text-sm text-zinc-400">{getStatusText()}</p>
    </div>
  );
}
