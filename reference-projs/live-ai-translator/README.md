# Live AI Translator

A real-time voice translation web application built with Next.js that enables seamless multilingual communication. Speak into your microphone, and the app transcribes your speech, automatically translates between Spanish and English, and plays back the translated text as synthesized audio in a continuous conversational loop.

## Features

- **Real-time Speech Recognition**: Advanced transcription using Whisper Large V3
- **Bidirectional Translation**: Automatic Spanish-English translation and vice versa
- **High-Quality TTS**: Natural-sounding speech synthesis with Canopylabs/Orpheus-v1
- **Voice Activity Detection**: Intelligent speech detection using Silero VAD
- **Interactive Visualizer**: Animated interface with audio-reactive effects
- **Mobile-Optimized**: Touch-friendly controls and responsive design

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS
- **Animation**: Framer Motion for smooth visual effects
- **AI/ML**: Groq SDK, LangChain, ONNX Runtime Web
- **Audio Processing**: Web Audio API, VAD libraries
- **State Management**: Zustand, TanStack React Query

## Getting Started

1. Ensure you have Node.js 18.17+ installed
2. Install dependencies and set up your Groq API key in `.env.local`
3. Run the development server
4. Open your browser and start translating!

## Requirements

- Modern browser with microphone access
- Internet connection for AI processing
- Groq API key for model access