# Live AI Translator - Project Documentation

## Project Overview

The **Live AI Translator** is a real-time voice translation web application built with Next.js. It enables users to speak into their microphone, transcribes their speech, automatically translates between Spanish and English, and plays back the translated text as synthesized audio. The application operates in a continuous conversational loop, processing each user utterance through an AI pipeline for seamless multilingual communication.

## Main Technologies Used

### Frontend Framework
- **Next.js 16.1.1** (App Router) - React-based full-stack framework for server-side rendering and API routes
- **React 19.2.3** - UI library for building interactive user interfaces
- **TypeScript** - Type-safe JavaScript for better development experience and error prevention
- **Tailwind CSS v4** - Utility-first CSS framework for rapid UI development

### Animation & Visual Effects
- **Framer Motion 12.26.2** - Production-ready motion library for React with declarative animations

### Voice & Audio Processing
- **@ricky0123/vad-react & @ricky0123/vad-web** - Voice Activity Detection library using ONNX models (Silero VAD)
- **ONNX Runtime Web** - Runs machine learning models in the browser for real-time VAD
- **Web Audio API** - Browser native API for real-time audio visualization and processing

### AI & Language Processing
- **Groq SDK** - Fast inference API for AI model interactions
- **LangChain** - Framework for building applications with large language models
- **Whisper Large V3** - Advanced speech-to-text transcription model
- **OpenAI GPT-OSS-120B** - Large language model for natural language translation
- **Canopylabs/Orpheus-v1-English** - High-quality text-to-speech synthesis model

### State Management & Data Fetching
- **Zustand** - Lightweight, scalable state management solution
- **TanStack React Query** - Powerful data synchronization for server state

### Development Tools
- **ESLint** - Code linting and style enforcement
- **TypeScript** - Static type checking
- **PostCSS** - CSS processing and transformation

## Recent Updates

### Version Evolution
- **Enhanced Visual Interface**: Replaced basic audio visualizer with advanced ShapeMorph component featuring Framer Motion animations
- **Bidirectional Translation**: Updated from Spanish-only to automatic Spanish-English bidirectional translation
- **Improved Mobile Support**: Better error handling, secure context detection, and mobile-optimized audio constraints
- **Refined User Experience**: Interactive animated orb, improved error messaging, and touch-friendly controls

## Project Structure & File Organization

```
live-ai-translator/
├── app/                          # Next.js App Router directory
│   ├── api/conversation/         # API endpoint for audio processing
│   │   └── route.ts             # POST handler for the translation pipeline
│   ├── store/                   # Global state management
│   │   └── useAppStore.ts      # Zustand store for application state
│   ├── globals.css             # Global styles with Tailwind
│   ├── layout.tsx              # Root layout component with providers
│   ├── page.tsx                # Main translator interface component
│   └── providers.tsx           # React Query client provider
├── components/                 # Reusable React components
│   └── ShapeMorph.tsx          # Interactive animated visualizer with audio-reactive effects
├── utils/                      # Utility functions and helpers
│   └── audio.ts               # Audio data conversion utilities
├── public/                     # Static assets served by Next.js
│   ├── *.onnx                 # Silero VAD ONNX model files
│   ├── ort.*                  # ONNX Runtime WebAssembly binaries
│   └── vad.worklet.*          # VAD audio processing worklet
├── docs/                       # Documentation and planning files
│   ├── project-plan.md         # Technical roadmap and future plans
│   ├── *.txt                   # Library documentation references
│   └── notes.md                # Quick reference notes
├── package.json                # NPM dependencies and scripts
├── tsconfig.json              # TypeScript compiler configuration
├── next.config.ts             # Next.js build and runtime configuration
├── eslint.config.mjs          # ESLint configuration
├── .env.local                 # Environment variables (API keys)
└── .gitignore                 # Git ignore patterns
```

## Key Components & Architecture

### Main Application Component (page.tsx)

The `LiveTranslator` component serves as the application's entry point and orchestrates the entire voice translation workflow:

**Key Responsibilities:**
- Manages microphone permission and audio stream access
- Handles Voice Activity Detection (VAD) events
- Controls audio recording, processing, and playback
- Manages application state transitions
- Provides user interface and feedback

**State Management:**
- Uses Zustand store for global state (`useAppStore`)
- Tracks current operation status (idle, listening, transcribing, etc.)
- Manages audio playback and processing flags

### Shape Morph Component (ShapeMorph.tsx)

Advanced animated visualizer that morphs based on application state and provides audio-reactive feedback using Framer Motion:

**Features:**
- **Status-based Morphing**: Visual appearance changes based on app status (idle, listening, transcribing, etc.)
- **Audio-reactive Effects**: Real-time audio level analysis during listening and speaking phases
- **Multi-layer Animation**: Ambient glow, rotating rings, satellite particles, and orbital effects
- **Interactive Core Orb**: Clickable central element with liquid-like internal effects
- **Smooth Transitions**: Declarative animations with spring physics and easing
- **Color-coded States**: Different gradient themes for each operational state
- **Mobile-optimized**: Touch-friendly interactions and responsive design

### State Store (useAppStore.ts)

Centralized state management using Zustand:

```typescript
interface AppState {
  status: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'generating_audio' | 'speaking'
  isListening: boolean
  isProcessing: boolean
  isPlayingAudio: boolean
  // Action functions for state updates
}
```

### API Endpoint (api/conversation/route.ts)

Server-side processing pipeline that handles the complete AI workflow:

**Three-Stage Process:**
1. **Transcription**: Converts audio to text using Groq Whisper Large V3
2. **Translation**: Translates text using LangChain + Groq GPT model
3. **Synthesis**: Generates speech audio using Groq TTS

**Request/Response:**
- Accepts WAV audio blobs via POST requests
- Returns translated audio as base64-encoded data
- Implements error handling and validation

### Utility Functions (utils/audio.ts)

**float32ToWav()**: Converts raw Float32Array audio data to WAV format for API transmission

## Data Flow & Application Logic

### Complete Translation Cycle

1. **Initialization**
   - User clicks "START" button
   - Browser requests microphone permissions
   - VAD model loads and initializes
   - Audio context establishes

2. **Listening Phase**
   - Continuous audio monitoring begins
   - VAD analyzes audio chunks for speech activity
   - Visual feedback shows audio levels

3. **Speech Detection**
   - VAD triggers `onSpeechStart` event
   - Audio recording begins capturing speech segment
   - User continues speaking naturally

4. **Speech End Detection**
   - VAD triggers `onSpeechEnd` event
   - Audio recording stops
   - Raw Float32Array data converted to WAV Blob

5. **Server Processing**
   - WAV data sent to `/api/conversation` endpoint
   - **Stage 1**: Transcription via Groq Whisper
   - **Stage 2**: Translation via LangChain + Groq LLM
   - **Stage 3**: Audio synthesis via Groq TTS

6. **Response Handling**
   - Translated audio received as base64
   - HTML5 Audio element created and played
   - Application returns to listening state

7. **Loop Continuation**
   - Process repeats for continuous conversation
   - Each utterance triggers new translation cycle

### State Machine Logic

The application follows a finite state machine pattern:

```
idle → listening → transcribing → generating_audio → speaking → listening
```

**State Transitions:**
- **idle → listening**: User initiates session
- **listening → transcribing**: Speech detected and recorded
- **transcribing → generating_audio**: Transcription complete, translation begins
- **generating_audio → speaking**: Translation complete, audio generation begins
- **speaking → listening**: Audio playback complete, ready for next input

### Audio Processing Pipeline

**Input Processing:**
- Browser `MediaStream` from `getUserMedia()`
- VAD processes audio chunks in real-time
- Speech segments extracted between start/end events

**Data Transformation:**
- Raw audio: Float32Array (32-bit float samples)
- API format: WAV Blob (16kHz, mono)
- Output: MP3/AAC audio for playback

## Key Dependencies & Their Roles

### Core AI/ML Libraries
- **@langchain/community & @langchain/core**: Provide LLM orchestration framework
- **@langchain/groq**: Groq-specific integration for LangChain
- **groq-sdk**: Direct API access for transcription and TTS
- **@ricky0123/vad-react**: React hooks for VAD integration

### Animation & UI Libraries
- **framer-motion**: Declarative animation library for complex UI transitions
- **zustand**: Lightweight state management with minimal boilerplate

### Web Audio & Machine Learning
- **onnxruntime-web**: Browser-based ML model execution
- **Public ONNX files**: Pre-trained Silero VAD models

### State & Data Management
- **zustand**: Client-side state with minimal boilerplate
- **@tanstack/react-query**: Server state management with caching

## Configuration & Customization

### System Prompt Configuration
Located in `app/api/conversation/route.ts`:

```typescript
const SYSTEM_PROMPT = "whenever you hear spanish translate to english, and vice versa. be a live translator";
```

**Current Behavior:**
- **Bidirectional Translation**: Automatically detects Spanish or English input and translates to the other language
- **Live Translation Mode**: Optimized for real-time conversational translation
- **Context Preservation**: Maintains natural conversation flow between languages

**Customization Options:**
- Modify language pairs by changing the prompt
- Adjust translation style (formal/informal, technical/simple)
- Add specific domain expertise or terminology preferences

### VAD Configuration
Configurable in `page.tsx`:

```typescript
const vad = useVAD({
  baseAssetPath: "/",
  onnxWASMBasePath: "/",
  startOnLoad: false,
  onSpeechStart: handleSpeechStart,
  onSpeechEnd: handleSpeechEnd,
});
```

### Audio Settings
- **Sample Rate**: 16kHz (optimized for speech processing)
- **Format**: WAV for transmission, compressed formats for playback
- **Channels**: Mono (single channel for efficiency)

## Environment & Requirements

### Runtime Requirements
- **Node.js**: Version 18.17 or higher
- **Browser**: Modern browser with Web Audio API support
- **Hardware**: Microphone access required

### Environment Variables
- **GROQ_API_KEY**: Required for AI model access (stored in `.env.local`)

### API Dependencies
- **Groq API**: For speech-to-text, translation, and text-to-speech
- Internet connection required for AI processing

## Terms & Concepts Used

### Voice Activity Detection (VAD)
Technology that automatically detects the presence of speech in audio streams using machine learning models. Distinguishes between speech, silence, and background noise in real-time.

### ONNX Runtime
Open Neural Network Exchange runtime that enables running machine learning models across different platforms. The web version allows client-side ML inference in browsers.

### Silero VAD
Open-source voice activity detection model developed by Silero. Lightweight and efficient for real-time speech detection in web applications.

### LangChain
A framework for developing applications powered by language models. Provides abstractions for prompts, chains, agents, and memory management.

### Web Audio API
A high-level JavaScript API for processing and synthesizing audio in web applications. Enables real-time audio manipulation and analysis.

### Float32Array
A typed array in JavaScript that holds 32-bit floating-point numbers. Used to represent raw audio samples from the microphone before conversion to other formats.

### Base64 Encoding
A binary-to-text encoding scheme used to transmit binary data (like audio files) over text-based protocols such as HTTP.

### WebAssembly (WASM)
Binary instruction format that allows running high-performance code in web browsers. Used by ONNX Runtime for efficient ML model execution.

This documentation provides a comprehensive overview of the Live AI Translator project's architecture, implementation details, and operational logic. The application demonstrates modern web technologies combined with AI capabilities to enable real-time multilingual communication.