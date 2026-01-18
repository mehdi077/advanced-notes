# Voice Mode Implementation Analysis

## Overview

The application is a **live AI voice translator** built with Next.js 16 (App Router), React 19, and Zustand for state management. There is no explicit \"voice mode\" toggle—the entire app operates in voice mode by default. Users interact via a central animated orb (ShapeMorph) that visualizes audio input/output states.

**Core Functionality**:
- **Input**: Real-time microphone capture with Voice Activity Detection (VAD) to segment speech.
- **Processing**: Audio → Transcription (Groq Whisper) → Translation (Groq LLM) → TTS (Groq Speech).
- **Output**: Synthesized speech playback with visual feedback.
- **States**: Managed via Zustand: `idle`, `listening`, `transcribing`, `thinking`, `generating_audio`, `speaking`.
- **Key Innovations**:
  - Client-side VAD using `@ricky0123/vad-react` (ONNX WebAssembly model) for low-latency speech detection without constant server streaming.
  - Mobile-optimized microphone access with fallback constraints.
  - AudioContext unlocking for autoplay compliance.
  - Reactive UI with Framer Motion and Web Audio API visualization.
- **Limitations**: Relies on HTTPS/localhost for mic access; no multi-language config in UI (hardcoded in API); no persistent conversation history.

**High-Level Architecture**:
```
User Tap → Mic Stream + VAD → Speech Detected → WAV Blob → POST /api/conversation
                                                                 ↓
                       Groq APIs: Whisper → LLM → TTS → Audio Blob Response
                                                                 ↓
Frontend: Play Audio → Visualize → Resume Listening (Loop)
```

## Files Involved

Absolute paths with roles:

| File Path | Role |
|-----------|------|
| `/Users/mehdi/projects/live-ai-translator/app/page.tsx` | Main page: Mic access, VAD hook, state mutations, UI orchestration (407 lines). |
| `/Users/mehdi/projects/live-ai-translator/utils/audio.ts` | Converts Float32Array (VAD output) to WAV Blob (35 lines). |
| `/Users/mehdi/projects/live-ai-translator/app/api/conversation/route.ts` | API route: Transcription, translation, TTS via Groq (96 lines). |
| `/Users/mehdi/projects/live-ai-translator/app/store/useAppStore.ts` | Zustand store: Global state (listening, status, theme, etc.) (63 lines). |
| `/Users/mehdi/projects/live-ai-translator/components/ShapeMorph.tsx` | Audio-reactive visualizer (mic input/output analysis) (400 lines). |
| `/Users/mehdi/projects/live-ai-translator/components/SidePanel.tsx` | Settings panel (theme toggle, placeholder for future configs) (78 lines). |
| `/Users/mehdi/projects/live-ai-translator/app/providers.tsx` | QueryClientProvider for TanStack Query (18 lines). |
| `/Users/mehdi/projects/live-ai-translator/app/layout.tsx` | Root layout: Theme persistence script (57 lines). |
| `/Users/mehdi/projects/live-ai-translator/package.json` | Dependencies and scripts (39 lines). |
| `/Users/mehdi/projects/live-ai-translator/public/vad.worklet.bundle.min.js` | Bundled VAD WebAudio worklet (pre-built). |

No other files directly involved in voice mode (e.g., no config files for languages/models).

## Architecture Flow

### Step-by-Step Data Flow

1. **Initialization (Idle State)**:
   - App mounts in `/app/page.tsx`.
   - Checks secure context (`window.isSecureContext` or HTTPS/localhost).
   - Zustand store initializes `status: 'idle'`, `isListening: false`.

2. **Enable Voice Mode (User Tap)**:
   - Tap ShapeMorph orb → `toggleSession()` (`/app/page.tsx:181`).
   - Unlock AudioContext with silent audio play (`unlockAudio()`, lines 54-70).
   - `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, ... } })` (lines 200-209).
   - Fallback to basic `{ audio: true }` on `OverconstrainedError`.
   - Store stream, set `status: 'listening'`, start VAD (`vad.start()`).

3. **Speech Detection (Listening)**:
   - `@ricky0123/vad-react` hook (`useMicVAD`, lines 133-155):
     - `onSpeechStart`: Log \"User started speaking\".
     - `onSpeechEnd`: Receive `Float32Array` audio → `float32ToWav(audio)` → `processAudioMutation.mutate(wavBlob)`.
   - ShapeMorph analyzes mic stream via `AudioContext.createMediaStreamSource` + AnalyserNode (lines 22-73 in ShapeMorph).

4. **Audio Processing (Transcribing → Thinking)**:
   - TanStack Query mutation (`processAudioMutation`, lines 84-130):
     - POST WAV to `/api/conversation`.
     - Set `status: 'transcribing'`.
   - API (`/app/api/conversation/route.ts`):
     - **STT**: `groq.audio.transcriptions.create({ model: 'whisper-large-v3', language: 'en' })` (lines 32-39).
     - **LLM**: `ChatGroq({ model: 'openai/gpt-oss-120b' })` with `SYSTEM_PROMPT: \"whenever you hear spanish translate to english, and vice versa. be a live translator\"` (lines 48-60).
     - **TTS**: `(groq.audio as any).speech.create({ model: 'canopylabs/orpheus-v1-english', voice: 'daniel' })` (lines 75-80).
     - Return audio blob (`Content-Type: 'audio/mpeg'`).

5. **Output Speech (Generating Audio → Speaking)**:
   - Mutation `onSuccess`: Create object URL, autoplay if unlocked (`audioRef.current.play()`), set `status: 'speaking'`.
   - ShapeMorph analyzes playback via `AudioContext.createMediaElementSource(audioElement)` (lines 77-128).
   - `onEnded`: Resume VAD, set `status: 'listening'`.

6. **Cancel/Stop**:
   - `cancelSession()`: Stop tracks, pause VAD/audio, reset to `idle`.

7. **Error Handling**:
   - Permission errors (NotAllowedError, etc.) → User-friendly messages.
   - Autoplay blocked → Manual \"tap to play\" button.

**State Transitions**:
```
idle → (tap) listening → (speech end) transcribing → (API) thinking → generating_audio → speaking → (end) listening
                                                                 ↓ (cancel) idle
```

**Visual Feedback**:
- Status-based gradients/glows/particles in ShapeMorph (`getStatusConfig()`).
- Bottom dots indicate progress.
- Logs (last 5) for debugging.

## Key Code Snippets

### 1. VAD Integration (`/app/page.tsx`, lines 133-155)
```tsx
const vad = useMicVAD({
  startOnLoad: false,
  baseAssetPath: \"/\",
  onnxWASMBasePath: \"/\",
  onSpeechStart: () => { /* log */ },
  onSpeechEnd: (audio) => {
    vad.pause();
    const wavBlob = float32ToWav(audio);  // /utils/audio.ts
    processAudioMutation.mutate(wavBlob);
  },
});
```

### 2. Mic Access (`/app/page.tsx`, lines 182-269)
```tsx
const mediaStream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: { ideal: 16000 } }
});
vad.start(); setIsListening(true); setStatus('listening');
```

### 3. API Processing (`/app/api/conversation/route.ts`, lines 30-85)
```ts
const transcription = await groq.audio.transcriptions.create({ file: audioFile, model: 'whisper-large-v3' });
const model = new ChatGroq({ model: 'openai/gpt-oss-120b' });
const aiResponse = await model.invoke([new SystemMessage(SYSTEM_PROMPT), new HumanMessage(transcribedText)]);
const speechResponse = await (groq.audio as any).speech.create({ model: 'canopylabs/orpheus-v1-english', voice: 'daniel', input: translatedText });
```

### 4. Audio Visualization (Listening) (`/components/ShapeMorph.tsx`, lines 22-73)
```tsx
const source = audioContext.createMediaStreamSource(stream);
source.connect(analyser);
const updateAudioData = () => { /* FFT → setAudioLevels */; requestAnimationFrame(updateAudioData); };
```

### 5. Store State (`/app/store/useAppStore.ts`, lines 3-19)
```ts
interface AppState {
  status: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'generating_audio' | 'speaking';
  // ...
}
```

### 6. WAV Conversion (`/utils/audio.ts`, lines 1-28)
```ts
export function float32ToWav(float32Array: Float32Array, sampleRate: number = 16000): Blob {
  // Builds WAV header + PCM data
}
```

## Replication Steps

1. Clone/clone repo, `npm i`.
2. Set `GROQ_API_KEY` in `.env.local`.
3. `npm run dev` (localhost:3000).
4. Tap orb → Allow mic → Speak (e.g., Spanish) → Hear English translation.
5. Test cancel (red X), errors (block mic).
6. Mobile: Use HTTPS, test constraints fallback.

**Debug**:
- Console: VAD logs, API steps.
- Network: Inspect `/api/conversation` payloads.

## Dependencies & External Services

### NPM Dependencies (`package.json`)
| Package | Purpose |
|---------|---------|
| `@ricky0123/vad-react@^0.0.36` | Client-side VAD (ONNX/WebAudio). |
| `groq-sdk@^0.37.0` | Groq API client (STT/LLM/TTS). |
| `@langchain/groq@^1.0.2`, `langchain@^1.2.3` | LLM chaining. |
| `react-media-recorder@^1.7.2` | (Unused?) MediaRecorder polyfill. |
| `framer-motion@^12.26.2` | Animations. |
| `@tanstack/react-query@^5.90.16` | Mutations. |
| `zustand@^5.0.9` | State. |
| `onnxruntime-web@^1.23.2` | VAD inference. |

### External Services
- **Groq API** (primary):
  - STT: `whisper-large-v3`.
  - LLM: `openai/gpt-oss-120b` (Llama-based).
  - TTS: `canopylabs/orpheus-v1-english` (voice: 'daniel').
- **Browser APIs**: `getUserMedia`, `AudioContext`, `AnalyserNode`.
- No other services (self-hosted Next.js API).

**Configs**:
- `SYSTEM_PROMPT`: Hardcoded Spanish↔English.
- VAD: Loads `/public/vad.worklet.bundle.min.js`.
- SampleRate: 16kHz optimized.

This covers the complete implementation exhaustively. No additional files or hidden logic found.

*Generated by opencode on $(date)*