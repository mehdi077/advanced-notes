# Advanced Notes / Helm - Agent Project Overview

This file is the canonical project map for AI agents working in this repo. Read it before opening individual source files. Keep it current after every task that changes behavior, APIs, data shape, persistence, routing, app structure, environment variables, or important implementation conventions.

Last verified against source: 2026-05-03.

## Agent Operating Contract

1. Start here. Before manually searching the repo, read this file and use it to decide which files actually need inspection.
2. Treat this file as a high-level cache, not an excuse to ignore code when editing. If you are about to change behavior, read the exact referenced files first.
3. After completing a task, update this file in the same turn if the task changed any project structure, route behavior, data flow, data schema, env var requirement, core component responsibility, or known caveat.
4. Keep updates specific. Add file references, route names, document IDs, setting keys, and data shapes. Avoid generic notes like "updated UI".
5. If you discover this file is stale, fix it before or alongside the requested change unless the user explicitly says not to.
6. Do not use `docs/project-documentation.md` as authoritative for this app; it appears copied from an older live translator project and is stale relative to the current code.

## Current Product Shape

This repo is a private local-first Next.js App Router application named `helm` / "Advanced Notes". It has multiple related writing/audio surfaces behind an in-app PIN gate:

- Main infinite AI writing document at `/`.
- Audiobook block editor at `/audiobooks`.
- PIN unlock/setup page at `/unlock`, plus a global lock overlay through `LockGate`.
- API routes for document persistence, OpenRouter text generation/chat/RAG/credits/models, Groq voice/TTS, audiobook audio generation/storage, nav buttons/bookmarks, editor settings, and PIN logs/reset.

The primary app experience is still the main TipTap writing editor, but the project has grown beyond what the old README/project overview described.

## Tech Stack

- Framework: Next.js App Router, `next@16.0.7`, React `19.2.0`.
- Language: TypeScript.
- Styling: Tailwind CSS v4 via `app/globals.css`.
- Editor: TipTap v3 (`@tiptap/react`, `@tiptap/starter-kit`, custom marks/nodes/extensions in `lib/`).
- Local DB: `better-sqlite3`.
- Client state: Zustand for unlock, save sync, and chat panel open state.
- Server-state helper: TanStack React Query provider exists globally but is not central to most current flows.
- AI text/chat/embeddings: OpenRouter through LangChain `ChatOpenAI` and direct OpenRouter `fetch`.
- Voice/TTS: Groq SDK and `@langchain/groq`.
- Voice activity/browser assets: VAD/ONNX assets in `public/`.
- Icons: `lucide-react`.

## Environment Variables

- `OPENROUTER_API_KEY`: required for autocomplete, chat, embeddings, OpenRouter model/pricing lookup, OpenRouter balance.
- `NEXT_PUBLIC_APP_URL`: optional referer/title metadata for OpenRouter requests; defaults to `http://localhost:3000`.
- `GROQ_API_KEY`: required for `/api/voice`, `/api/generation-tts`, audiobook segment generation, and Groq balance.

`DATABASE_PATH` is mentioned in old docs, but current `lib/db.ts` hardcodes `path.join(process.cwd(), 'data.db')`; do not assume `DATABASE_PATH` is honored unless code changes.

## Top-Level File Map

- `app/layout.tsx`: root HTML/body, Geist fonts, metadata, wraps everything in `Providers` and `LockGate`.
- `app/providers.tsx`: client `QueryClientProvider`.
- `app/globals.css`: global Tailwind and application/editor styling.
- `middleware.ts`: no-op middleware returning `NextResponse.next()`.
- `package.json`: scripts are `dev`, `build`, `start`, `lint`.
- `data.db`: primary SQLite DB for docs/settings/PIN logs/RAG/model config/chat history.
- `audiobook.db`: separate SQLite DB for audiobook docs/audio segment metadata.
- `data/audiobooks/`: generated audiobook WAV files are written here.
- `public/`: standard SVGs plus ONNX/VAD runtime/model assets used by voice/VAD-related code.
- `docs/`: mixed reference notes. Some files are useful library references; `docs/project-documentation.md` is stale for this app.

## Global Lock / Auth Model

All app pages are rendered inside `LockGate` from `app/layout.tsx`. `LockGate` is a client component that blocks the UI with a PIN keypad until the user has an in-memory unlock token.

Important files:

- `components/LockGate.tsx`: global overlay. Handles PIN setup when no PIN is configured, PIN entry when configured, keyboard input, and storing the returned token in `useUnlockStore`.
- `app/unlock/page.tsx`: standalone unlock/setup page with similar keypad logic and `next` redirect support.
- `lib/stores/unlock-store.ts`: Zustand store with `unlockToken`, `setUnlockToken`, `clearUnlockToken`. Token is in memory only, not persisted.
- `lib/auth-fetch.ts`: client helper that reads `unlockToken` and adds `x-an-unlock` to fetch headers.
- `lib/unlock-server.ts`: server token issuing/validation. Tokens live in a `globalThis.__anUnlockTokens` map and expire after 30 minutes. `requireUnlocked(request)` returns a `401 { error: 'Locked' }` response when invalid/missing.
- `lib/pin-auth.ts`: PIN hashing and verification using scrypt + HMAC verifier stored in the `settings` table. PIN must be exactly 6 digits.
- `app/api/unlock/route.ts`: setup or verify PIN, rate limits by IP in memory, logs attempts, issues unlock token.
- `app/api/unlock/status/route.ts`: returns `{ configured: boolean }`; intentionally not locked so the client can decide setup vs entry.
- `app/api/unlock/reset/route.ts`: locked route for changing PIN; verifies old PIN, sets new PIN, clears all existing tokens, issues a new token.
- `app/api/pin-attempts/route.ts`: locked route returning recent PIN attempt logs, filtered by `result=success|failure|all`, capped 1-200.
- `components/PinAttemptLog.tsx` and `components/PinResetForm.tsx`: UI surfaced inside editor/sidebar area for reviewing attempts and resetting PIN.

Most API routes call `requireUnlocked` at the top. If adding routes that expose private content, use `requireUnlocked`.

## Persistence and Databases

### Primary DB: `data.db`

Initialized in `lib/db.ts`. Current tables:

- `documents(id TEXT PRIMARY KEY, content TEXT, updated_at TEXT)`: stores TipTap JSON documents as JSON strings.
- `settings(key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`: stores prompts, RAG topK, editor settings, jump buttons, PIN verifier/salt/params, etc.
- `pin_attempt_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, success INTEGER NOT NULL, ip TEXT, user_agent TEXT)`.
- `llm_models(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, input_modalities TEXT NOT NULL DEFAULT '["text"]', supports_vision INTEGER NOT NULL DEFAULT 0, prompt_price_per_million REAL, completion_price_per_million REAL, image_price REAL)`: DB-backed OpenRouter model allowlist/config used by editor and chat. Seeded on first startup with the previous hardcoded defaults. OpenRouter metadata refreshes capabilities/pricing when `/api/models` runs.
- `chat_conversations(id TEXT PRIMARY KEY, title TEXT NOT NULL, model_id TEXT NOT NULL, system_prompt TEXT NOT NULL DEFAULT '', use_rag_context INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`: persisted chat sessions.
- `chat_messages(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user', 'assistant')), content TEXT NOT NULL, rag_context TEXT, model_id TEXT, position INTEGER NOT NULL, created_at TEXT NOT NULL)`: persisted chat messages, ordered by `position`, cascade-linked to `chat_conversations`.
- `chat_attachments(id TEXT PRIMARY KEY, message_id TEXT, conversation_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('upload', 'screenshot')), mime_type TEXT NOT NULL, data_url TEXT NOT NULL, file_name TEXT, created_at TEXT NOT NULL)`: stores chat image uploads and accepted screenshots as data URLs linked to messages/conversations.
- `openrouter_usage(id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT, message_id TEXT, model_id TEXT NOT NULL, prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, prompt_cost REAL, completion_cost REAL, image_cost REAL, total_cost REAL, created_at TEXT NOT NULL)`: accumulated OpenRouter token/image spend tracking by model and message.
- `embeddings(id INTEGER PRIMARY KEY AUTOINCREMENT, embedding_model_id TEXT NOT NULL, chunk_text TEXT NOT NULL, chunk_hash TEXT NOT NULL, embedding BLOB NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(embedding_model_id, chunk_hash))`.
- `embedding_state(embedding_model_id TEXT PRIMARY KEY, last_content_hash TEXT, total_chunks INTEGER DEFAULT 0, embedded_chunks INTEGER DEFAULT 0, updated_at TEXT)`.
- `embedding_models(model_id TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`.

`lib/db.ts` includes startup migrations for older single-model embedding schemas and seeds `llm_models` only if the model table is empty. Default embedding model is `qwen/qwen3-embedding-8b`.

### Audiobook DB: `audiobook.db`

Initialized in `lib/audiobook-db.ts`. Current tables:

- `documents(id TEXT PRIMARY KEY, content TEXT, updated_at TEXT)`: audiobook block documents.
- `audio_segments(id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, text TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, created_at TEXT NOT NULL)`.
- Index: `audio_segments_doc_id_idx`.

Audio files are stored separately under `data/audiobooks/<segmentId>.wav`.

### Client Draft Recovery

`lib/draft-storage.ts` uses IndexedDB:

- DB: `anDrafts`.
- Store: `drafts`.
- Records include `docId`, `content`, and `updatedAt`.

The main document saves local drafts quickly before server persistence. On page load, server content and local draft are compared by JSON stringification; if a differing draft exists, it is used and marked dirty.

## Main Infinite Document Flow (`/`)

Primary files:

- `app/page.tsx`: page shell and persistence controller.
- `components/TiptapEditor.tsx`: main editor and AI/editor UI.
- `components/SaveSyncIndicator.tsx`: save status display based on `useSaveSyncStore`.
- `lib/stores/save-sync-store.ts`: tracks edit/save sequence numbers, in-flight saves, last saved word/doc, and last error.
- `lib/tiptap-text.ts`: extracts last word from TipTap JSON for save status.
- `lib/draft-storage.ts`: IndexedDB draft recovery.
- `app/api/doc/route.ts`: GET/POST `documents` table.

Document ID: `infinite-doc-v1`.

Load flow in `app/page.tsx`:

1. `useSaveSyncStore.setDocId('infinite-doc-v1')`.
2. Fetch local draft from IndexedDB and server doc from `/api/doc?id=infinite-doc-v1` using `authFetch`.
3. Hydrate save-sync state with server doc and last saved word.
4. If a local draft exists and differs from server doc, use the draft and mark dirty.
5. Pass loaded JSON to `TiptapEditor`.

Update/save flow:

1. `TiptapEditor` calls `onContentUpdate(editor.getJSON())`.
2. `app/page.tsx` calls `markEdited`, updates `latestContentRef`, debounces local draft save at 250 ms, debounces server save at 1000 ms.
3. Server save POSTs `{ id: 'infinite-doc-v1', content }` to `/api/doc`.
4. On success, save-sync state records the edit sequence, last saved word, and last saved doc; local draft is cleared.
5. There is an immediate-save path on unlock, online, focus, and visibility-visible if dirty, online, unlocked, and no saves are in flight.

Jump buttons/bookmarks:

- `app/page.tsx` extracts bookmark nodes from TipTap JSON where `node.type === 'bookmark'` and attrs include `id`/`name`.
- Jump button config is stored through `/api/nav-buttons?docId=infinite-doc-v1`.
- `lib/nav-buttons.ts` stores settings under `nav.jumpButtons.<docId>`, validates label/id/color, caps to 50 buttons.
- Buttons scroll to DOM elements with `data-bookmark-id="<id>"`.
- Bookmark TipTap extension is in `lib/bookmark.ts`.

Floating controls on `/`:

- Scroll-to-end and scroll-to-top buttons.
- Add/configure jump buttons.
- Chat is a right-side panel component mounted from `app/page.tsx`; `TiptapEditor` owns the fixed chat toggle button and uses `useVoiceStore.isModalOpen` as the panel-open flag.

## TipTap Editor Responsibilities

`components/TiptapEditor.tsx` is large and owns most main-editor behavior. Read it before touching editor UX.

Important imported local extensions/helpers:

- `lib/completion-mark.ts`: TipTap mark used for ghost/completion text styling and selection visualization.
- `lib/saved-completion.ts`: inline saved completion node, displayed as a star-like marker with stored `data-content`.
- `lib/bookmark.ts`: bookmark/tag node used by jump buttons.
- `lib/unsaved-underline.ts`: mark/plugin for visually indicating unsaved text.
- `lib/font-size.ts`: TipTap extension adding font size support through `textStyle`.
- `lib/audio-segment-mark.ts`: audio segment-related TipTap mark.
- `lib/audio-clip.ts`: audio clip helper/extension area.

Editor-side state includes:

- Sidebars: left settings panel, right tools panel, and the chat panel all have fixed on-screen toggles. The keyboard shortcuts that used to open the left/right side panels were removed, but the buttons remain.
- Model preferences: OpenRouter model records are loaded from `/api/models`, backed by `data.db.llm_models`.
- Selected autocomplete model is stored in `data.db.settings` as `editor.selectedModelId` through `/api/editor-settings`.
- Prompt templates loaded/saved via `/api/prompts`.
- Completion state: active flag, generated words, selected word count, TipTap range.
- Attempt history for regeneration.
- OpenRouter balance, Groq balance, model pricing.
- RAG status, embedding model selection, add/delete embedding models, topK, useRagContext.
- Last autocomplete request preview for debugging system/user prompt and RAG context.
- TTS state for generated ghost text through `/api/generation-tts`.
- Saved completion popup state.
- PIN attempt/reset components in settings UI.

Keyboard behavior documented by old README is still conceptually relevant:

- Tab generates/confirms/regenerates completion depending on current completion state.
- Arrow keys adjust selected words.
- Space selects all words.
- Escape cancels completion.
- Enter has special behavior for saving generated completions/snippets in parts of the editor.

Because this file is large, prefer narrow edits and preserve existing state contracts/localStorage keys.

## AI Text Completion

Primary files:

- `components/TiptapEditor.tsx`: client request construction, ghost insertion, selection/confirm/regenerate UX, request preview UI.
- `app/api/autocomplete/route.ts`: server completion endpoint.
- `lib/model-config.ts`: OpenRouter/LangChain model factory and model types.
- `lib/model-store.ts`: DB-backed model list/add/fallback helpers for `data.db.llm_models`.
- `app/api/prompts/route.ts`: persisted prompt settings.
- `app/api/models/route.ts`: DB-backed configured model list/add API; enriches configured models with OpenRouter pricing when `OPENROUTER_API_KEY` is available.
- `app/api/balance/route.ts`: OpenRouter credits fetch.

Autocomplete route behavior:

1. Requires unlock.
2. Requires `OPENROUTER_API_KEY`.
3. Accepts JSON including `text`, `modelId`, `embeddingModelId`, `prompt`, `useRagContext`.
4. Uses `getOpenRouterModel(modelId)` from `lib/model-config.ts`; default model is `openai/gpt-4o-mini`.
5. If RAG is enabled, embeds the input text and retrieves relevant chunks from `embeddings` for the selected embedding model.
6. Builds a system prompt: "continue naturally", output only completion text, optionally includes `---RELEVANT CONTEXT---`.
7. Builds a user message from the selected/custom prompt plus source text.
8. Calls LangChain model `.invoke`.
9. Returns `{ completion, usage, requestPreview }`, where `requestPreview` includes model, RAG flags, prompt text, input text, system prompt, user message, message list, and RAG chunk counts.

Prompt persistence:

- `/api/prompts GET` returns `customPrompt` and `regenPromptTemplate` from `settings`, falling back to defaults.
- `/api/prompts POST` stores both in `settings`.
- Default custom prompt: `Provide a two sentence long completion to this text:`.
- Default regen template includes `{{ATTEMPTS}}` and `{{ORIGINAL_PROMPT}}`.

Model config:

- `lib/model-config.ts` exports `DEFAULT_MODEL`, `formatCost`, `getOpenRouterModel`, and model types. It no longer stores the configured app model list.
- `lib/model-store.ts` reads/writes configured OpenRouter models in `data.db.llm_models`, and seeds the table with the previous built-in defaults only when the table is empty.
- `/api/models GET` returns only configured DB models, optionally with pricing and `architecture.input_modalities` from OpenRouter. Models with `"image"` in `input_modalities` are marked `supportsVision`.
- `/api/models POST` adds or updates a model by id/name/description. If `OPENROUTER_API_KEY` is available, it fetches OpenRouter metadata for that id and stores pricing, input modalities, and vision support in `llm_models`.
- `/api/models DELETE` removes a configured model unless it is the last model. Any chat/editor settings or chat conversations using the deleted model are reassigned to the oldest remaining model.
- `getOpenRouterModel` sets OpenRouter base URL, referer/title headers, temperature `0.7`, max tokens `2000`.

## RAG / Embeddings

Primary files:

- `app/api/embeddings/route.ts`: status, register model, embed chunks, delete embeddings for a model.
- `app/api/rag/route.ts`: retrieve context for an arbitrary query.
- `app/api/rag-topk/route.ts`: get/set topK.
- `lib/rag-settings.ts`: stores/clamps topK in `settings`.
- `app/api/autocomplete/route.ts` and `app/api/chat/route.ts`: duplicate/reuse RAG retrieval logic inline.

Default embedding model: `qwen/qwen3-embedding-8b`.

Embedding source document:

- `/api/embeddings` uses `id` query param if provided.
- If omitted or missing, it tries fallback docs `infinite-doc-v1`, then `main`, then latest document by `updated_at`.
- It extracts plain text from TipTap JSON recursively, using `text` fields and `content` arrays.

Chunking logic:

- `CHUNK_SIZE = 500` characters.
- Splits on sentence boundaries.
- Keeps about 20% word overlap from the previous chunk when splitting.
- Drops chunks shorter than 20 chars.
- Hashes chunk text with SHA-256.

Embedding storage:

- Embeddings are stored as Float32Array buffers in SQLite BLOBs.
- Uniqueness is `(embedding_model_id, chunk_hash)`.
- GET calculates how many current chunks are already embedded and updates `embedding_state`.
- POST embeds only missing chunk hashes for the selected model and updates state.
- PUT registers a new embedding model without embedding chunks yet.
- DELETE deletes embeddings for one model but keeps the model registered and resets its state row.

Retrieval logic:

- Query text is embedded through OpenRouter `/api/v1/embeddings`.
- All stored embeddings for selected model are loaded and compared with cosine similarity in process.
- Results are sorted descending.
- topK comes from `lib/rag-settings.ts`; defaults to 3, min 1, max 50.
- Chunks below similarity `0.3` are filtered out.
- Autocomplete/chat join context with blank lines; `/api/rag` joins chunks with `\n\n---\n\n`.

Important caveat: RAG retrieval code is duplicated in `autocomplete`, `chat`, and `rag`. If changing scoring/filtering/model behavior, update all relevant paths or factor a shared helper.

## Chat Side Panel

Primary files:

- `components/VoiceChat.tsx`: despite the name, this is the DB-backed right-side text chat panel mounted from `app/page.tsx`.
- `components/TiptapEditor.tsx`: owns the fixed left/right side-panel buttons plus the fixed chat toggle button.
- `app/api/chat/route.ts`: sends one user message, invokes OpenRouter, persists user/assistant messages, and updates conversation runtime fields.
- `app/api/chat/conversations/route.ts`: loads chat state/history, creates a new current chat, loads a specific history chat, deletes a conversation, and patches per-conversation runtime settings.
- `app/api/chat/settings/route.ts`: reads/writes global chat defaults in `data.db.settings`.
- `lib/chat-store.ts`: DB helper for chat settings, current conversation, conversations, messages, and runtime updates.
- `lib/stores/useVoiceStore.ts`: stores `isModalOpen`; currently used as the chat side-panel open flag. It also contains older voice status/conversation fields.

Chat client behavior:

- Slides in from the right at width `min(30rem, 100vw)`. Closing the panel does not clear the current chat.
- Has three static tabs: current chat, history, settings.
- Has one dynamic fourth tab when opening a chat from history. That tab has an `x`; clicking another history chat replaces it. The current chat remains separate.
- Header includes a new-chat button. Creating a new chat replaces only the current chat and stores its id as `chat.currentConversationId`.
- The current chat view auto-scrolls to the latest message whenever the panel opens or the current tab becomes active.
- Current/open chat tabs show a per-conversation model selector; changing it persists `chat_conversations.model_id` and affects subsequent messages in that conversation.
- History lists all saved `chat_conversations` ordered by `updated_at DESC` with message counts, and each row has a delete button that removes the conversation, its messages, its attachments, and its usage rows from `data.db`.
- Settings tab edits DB-backed defaults: default model for new chats, add/delete OpenRouter models, system prompt, and RAG toggle.
- RAG is off by default for chat (`chat.useRagContext` defaults false). When enabled, outgoing messages include retrieved context and assistant messages store `ragContext`.
- Models shown in chat come from `/api/models`, backed by `data.db.llm_models`; adding a model writes to the DB so moving `data.db` carries the model config.
- Model dropdowns include pricing and a text/vision indicator. Settings also shows a capabilities list and an OpenRouter spend section grouped by model from `openrouter_usage`.
- If the selected conversation model supports vision, the composer shows image upload and screen-capture buttons. Uploaded images and accepted screenshots are staged in the composer, sent with the next message, and persisted in `chat_attachments`.
- Screen capture uses the browser Screen Capture API (`navigator.mediaDevices.getDisplayMedia`), shows an approval preview, and only attaches the screenshot after confirmation. Browser support and user permission are required.

Server behavior:

- Requires unlock and `OPENROUTER_API_KEY`.
- `/api/chat` validates `{ conversationId, message, modelId?, systemPrompt?, useRagContext? }`.
- It also accepts `attachments` with image data URLs when the selected model has `supportsVision`.
- Loads previous persisted messages for that conversation and appends the new user message only after the OpenRouter call succeeds.
- Uses direct OpenRouter `/api/v1/chat/completions` rather than LangChain for chat so multimodal message content and usage metadata can be handled.
- Uses the supplied/per-conversation model and system prompt. If RAG is enabled, embeds the outgoing user message and appends relevant context to the system prompt.
- Persists both user and assistant messages in `chat_messages`, image attachments in `chat_attachments`, updates `chat_conversations.updated_at`, and sets the title from the first user message if the title is still `New chat`.
- Records returned prompt/completion token usage and estimated spend in `openrouter_usage`, using the model pricing stored in `llm_models`.
- Returns persisted `userMessage`, assistant `message`, updated `conversation`, and RAG/model metadata.

## Voice / Speech / TTS

There are two related but separate areas:

1. The current text chat panel named `VoiceChat`.
2. Actual audio processing endpoints and components/assets, some of which come from an earlier voice assistant/translator implementation.

Primary files:

- `components/VoiceChat.tsx`: text chat side panel, not actual microphone UI.
- `components/ShapeMorph.tsx` and `components/SimpleVisualizer.tsx`: visual/audio UI components from voice-related work.
- `utils/audio.ts`: audio conversion utilities.
- `lib/stores/useVoiceStore.ts`: voice-ish global state and modal open flag.
- `app/api/voice/route.ts`: actual server voice assistant pipeline.
- `app/api/generation-tts/route.ts`: server TTS endpoint for generated text playback.
- `public/ort*`, `public/silero_vad_*.onnx`, `public/vad.worklet.bundle.min.js`: VAD/ONNX browser assets.

`/api/voice` behavior:

- Requires unlock and `GROQ_API_KEY`.
- Accepts multipart form data with `audio` File and optional `conversationHistory` JSON.
- Transcribes with Groq `whisper-large-v3-turbo`, English language.
- Uses `ChatGroq` model `llama-3.3-70b-versatile`, temperature `0.7`, max tokens `150`, with a concise spoken-assistant system prompt.
- Uses last 10 history messages.
- Generates WAV speech with Groq model `canopylabs/orpheus-v1-english`, voice `daniel`.
- Returns raw `audio/wav` with headers `X-Transcription` and `X-Response-Text`.

`/api/generation-tts` behavior:

- Requires unlock and `GROQ_API_KEY`.
- Accepts JSON `{ text }`.
- Generates WAV using Groq `canopylabs/orpheus-v1-english`, voice `daniel`.
- Returns raw `audio/wav`.

`app/api/groq-balance/route.ts` fetches Groq credits from `https://api.groq.com/openai/v1/credits`.

## Audiobooks (`/audiobooks`)

Primary files:

- `app/audiobooks/page.tsx`: page shell, loads doc ID `audiobook-doc-v1` from `/api/audiobooks/doc`.
- `components/AudiobookBlocksEditor.tsx`: client block editor, textareas, add/delete/generate/clear/play audio controls.
- `lib/audiobook-db.ts`: separate DB.
- `app/api/audiobooks/doc/route.ts`: load/save audiobook document.
- `app/api/audiobooks/segments/route.ts`: generate TTS segment and write file/metadata.
- `app/api/audiobooks/audio/[segmentId]/route.ts`: serve generated WAV.
- `app/api/audiobooks/segments/[segmentId]/route.ts`: delete segment metadata and file.

Document shape in `AudiobookBlocksEditor`:

```ts
type AudiobookDoc = {
  version: 1;
  blocks: Array<{
    id: string;
    text: string;
    audioSegmentId?: string | null;
    audioText?: string | null;
  }>;
};
```

Client behavior:

- Normalizes missing/invalid docs to one empty block.
- Debounced doc save to `/api/audiobooks/doc` at 600 ms.
- `saveDocDebounced.flush()` is used after deletes to persist promptly.
- Each block can generate audio from its current text.
- If text differs from `audioText`, the UI treats audio as stale.
- Deleting a block with audio deletes the audio segment first.
- Regenerating audio best-effort deletes the previous segment first.

Segment generation:

- Requires unlock and `GROQ_API_KEY`.
- Accepts `{ docId, text, model?, voice? }`.
- Defaults: model `canopylabs/orpheus-v1-english`, voice `daniel`.
- Writes `data/audiobooks/<uuid>.wav`.
- Inserts metadata in `audiobook.db.audio_segments`.
- Returns `{ segmentId, audioUrl }`.

Segment serving/deleting:

- Segment IDs are validated with `/^[a-zA-Z0-9-]+$/`.
- GET reads file by metadata `file_name`; returns `audio/wav` no-store.
- DELETE removes metadata and file. File missing errors are handled best-effort.

## API Route Inventory

All routes below are under `app/api/`.

- `doc/route.ts`: primary document GET/POST in `data.db`.
- `autocomplete/route.ts`: OpenRouter completion with optional RAG.
- `chat/route.ts`: OpenRouter chat send endpoint; persists user and assistant messages.
- `chat/conversations/route.ts`: chat state/history/current-chat endpoint.
- `chat/settings/route.ts`: DB-backed chat default settings endpoint.
- `embeddings/route.ts`: RAG embedding status/register/embed/delete.
- `rag/route.ts`: ad hoc RAG context retrieval.
- `rag-topk/route.ts`: RAG topK get/set.
- `prompts/route.ts`: completion prompt and regeneration prompt settings.
- `editor-settings/route.ts`: editor setting persistence, currently includes `useRagContext`.
- `models/route.ts`: DB-backed configured model list/add endpoint; enriches configured models with OpenRouter pricing when available.
- `balance/route.ts`: OpenRouter credits.
- `groq-balance/route.ts`: Groq credits.
- `generation-tts/route.ts`: Groq TTS for plain text.
- `voice/route.ts`: Groq transcription + LLM + TTS voice pipeline.
- `nav-buttons/route.ts`: get/set jump buttons for a doc.
- `pin-attempts/route.ts`: read PIN attempt logs.
- `unlock/route.ts`: setup/verify PIN and issue token.
- `unlock/status/route.ts`: check whether PIN is configured.
- `unlock/reset/route.ts`: reset PIN after unlock and old PIN verification.
- `audiobooks/doc/route.ts`: audiobook document GET/POST in `audiobook.db`.
- `audiobooks/segments/route.ts`: generate/store audiobook segment.
- `audiobooks/audio/[segmentId]/route.ts`: serve audiobook WAV.
- `audiobooks/segments/[segmentId]/route.ts`: delete audiobook segment and file.

When adding a route:

- Decide whether it exposes private app data. If yes, call `requireUnlocked` first.
- Update this inventory.
- Document request/response shapes if nontrivial.
- If it persists data, update the DB/schema section and settings keys if relevant.

## Settings Keys

Known keys in `data.db.settings`:

- `customPrompt`: main autocomplete prompt.
- `regenPromptTemplate`: regeneration prompt template.
- `ragTopK`: RAG retrieval count, clamped 1-50.
- `nav.jumpButtons.<docId>`: JSON array of jump button configs.
- `editor.selectedModelId`: selected model for main editor autocomplete.
- `editor.useRagContext`: main editor completion RAG toggle.
- `editor.completionAudio`: main editor generated-completion audio toggle.
- `chat.currentConversationId`: current chat id for the static current-chat tab.
- `chat.selectedModelId`: default model for new chats.
- `chat.systemPrompt`: default system prompt for chat.
- `chat.useRagContext`: chat RAG toggle, defaults false.
- `auth_pin_salt_b64`: PIN salt.
- `auth_pin_verifier_b64`: PIN verifier.
- `auth_pin_scrypt_params_json`: PIN scrypt params.
- Editor and chat settings routes store JSON-ish primitive settings in this table.

Known browser localStorage keys:

- `helm.embeddingModelId`: selected embedding model.

Known IndexedDB keys:

- `anDrafts` database, `drafts` store, keyed by doc ID.

## Custom TipTap Extensions and Related Helpers

- `lib/completion-mark.ts`: completion/ghost mark. Used by main editor AI completion.
- `lib/saved-completion.ts`: inline saved completion node. Used by main editor saved snippet preview.
- `lib/bookmark.ts`: bookmark/tag node. Used by main editor and jump buttons.
- `lib/unsaved-underline.ts`: mark/plugin for unsaved text highlighting. Works with save sync state.
- `lib/font-size.ts`: font size extension over `textStyle`.
- `lib/audio-segment-mark.ts`: mark for associating text with audio segment metadata.
- `lib/audio-clip.ts`: audio clip behavior/helper area.
- `lib/tiptap-text.ts`: generic TipTap JSON text extraction helper for save indicators.

If changing TipTap schema or node/mark attributes, update all consumers that parse JSON manually:

- Bookmark extraction in `app/page.tsx`.
- Plain text extraction in `app/api/embeddings/route.ts`.
- Save last-word extraction in `lib/tiptap-text.ts`.
- Any audio segment or saved completion UI that expects specific attrs.

## Save Sync Model

`lib/stores/save-sync-store.ts` is the global save status state for pages that opt in.

Core fields:

- `docId`: active document identifier.
- `editSeq`: increments on every local edit.
- `lastSavedEditSeq`: highest edit sequence confirmed saved.
- `inFlightCount`: number of pending saves.
- `lastAttemptAtMs`, `lastSavedAtMs`, `lastEditAtMs`.
- `lastSavedWord`, `lastSavedDocJson`.
- `lastError`.

Important behavior:

- A save success carries the edit sequence captured when the save started. The store uses `Math.max` so older in-flight saves do not move `lastSavedEditSeq` backward.
- `selectIsDirty` is `editSeq !== lastSavedEditSeq`.
- The main page has immediate-save logic triggered by unlock, online, focus, and visibility-visible.

If changing persistence timing or adding a new save-aware page, reuse these patterns instead of inventing another status store.

## Known Stale or Risky Areas

- `docs/project-documentation.md` describes a "Live AI Translator" and is not current for this app.
- `README.md` and old `PROJECT_OVERVIEW.md` were focused on the original Helm editor and did not include all current routes/features before this rewrite.
- `components/VoiceChat.tsx` name is misleading; it is currently a text chat side panel. Actual voice endpoint exists separately at `/api/voice`.
- RAG embedding/retrieval logic is duplicated across `app/api/embeddings/route.ts`, `app/api/rag/route.ts`, `app/api/autocomplete/route.ts`, and `app/api/chat/route.ts`.
- `middleware.ts` does not enforce auth. Auth is component/API-route based.
- Unlock tokens are memory-only. Server restarts clear them; multi-instance deployments would not share tokens.
- The primary DB path and audiobook DB path are hardcoded relative to `process.cwd()`.
- Some generated assets and DB files are present in the repo workspace; do not delete or reset them unless explicitly asked.
- `package-lock.json` was already modified before the 2026-05-03 overview rewrite. Do not assume it was changed by the current agent unless you verify.

## Development Commands

- `npm run dev`: start Next dev server.
- `npm run build`: production build.
- `npm run start`: production server.
- `npm run lint`: ESLint.

When building/running locally, expect API routes that call OpenRouter/Groq to require env vars and network access. In restricted environments, builds may still work, but live AI calls will fail without credentials/network.

## File Reading Strategy for Future Agents

Use this map to avoid broad searches:

- Main editor UI/AI behavior: start with `components/TiptapEditor.tsx`, then exact route/helper referenced by the feature.
- Main document persistence or save bugs: `app/page.tsx`, `lib/stores/save-sync-store.ts`, `lib/draft-storage.ts`, `app/api/doc/route.ts`.
- RAG bugs: `app/api/embeddings/route.ts`, `app/api/autocomplete/route.ts`, `app/api/chat/route.ts`, `app/api/rag/route.ts`, `lib/rag-settings.ts`.
- Chat panel/history/settings bugs: `components/VoiceChat.tsx`, `app/api/chat/route.ts`, `app/api/chat/conversations/route.ts`, `app/api/chat/settings/route.ts`, `lib/chat-store.ts`.
- Unlock/auth bugs: `components/LockGate.tsx`, `lib/unlock-server.ts`, `lib/pin-auth.ts`, `app/api/unlock/*`.
- Audiobook bugs: `components/AudiobookBlocksEditor.tsx`, `app/audiobooks/page.tsx`, `app/api/audiobooks/*`, `lib/audiobook-db.ts`.
- Model/pricing/balance bugs: `lib/model-config.ts`, `lib/model-store.ts`, `app/api/models/route.ts`, `app/api/balance/route.ts`, `app/api/groq-balance/route.ts`.
- TipTap schema/styling bugs: relevant `lib/*.ts` extension plus `components/TiptapEditor.tsx` and `app/globals.css`.

## How To Update This File

Update this file whenever:

- You add, remove, rename, or materially change a page, component, hook/store, API route, DB table, settings key, localStorage key, IndexedDB shape, env var, or external service integration.
- You change a non-obvious data flow, such as save/debounce logic, RAG retrieval, completion prompt construction, unlock behavior, or audio generation.
- You discover a stale statement in this file while investigating.
- You add a known caveat or remove one by fixing it.

Preferred update style:

- Keep sections organized by product surface and flow.
- Include exact file paths in backticks.
- Include exact route paths and document IDs.
- Include request/response shapes for API routes when helpful.
- Include "why this exists" when the reason is not obvious.
- Do not paste large code blocks. Summarize contracts and point to files.
- Keep "Last verified against source" current when you do a broad verification pass. For narrow changes, update only the affected sections unless you truly re-verified all sections.

Before finalizing any future task, ask: "Did my change make this overview stale?" If yes, patch this file before reporting completion.
