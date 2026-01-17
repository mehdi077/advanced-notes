# Advanced Notes - Helm Project Overview

## Project Purpose
Helm is an AI-powered infinite document writing application that integrates advanced AI text completion into a modern, minimalist editor interface. It allows users to generate contextual text suggestions and selectively accept them word-by-word, enhancing the writing process with intelligent assistance.

## Technology Stack
- **Frontend**: Next.js 16.0.7 with React 19.2.0, Geist fonts
- **Editor**: TipTap rich text editor with custom extensions for AI completions
- **AI Integration**: LangChain.js with OpenRouter API for model access
- **Database**: SQLite (better-sqlite3) for local document persistence
- **Styling**: Tailwind CSS v4 with custom dark theme and typography
- **Language**: TypeScript for type safety
- **Build Tools**: ESLint, PostCSS, Tailwind CSS v4\n- **Icons**: lucide-react

## Directory Structure Overview

### Root Directory\n- `package.json` - Dependencies and scripts (Next 16.0.7, React 19.2.0)\n- `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `next-env.d.ts`\n- `data.db` - SQLite DB (with backups in dataBackup/)\n- `docs/` - Integration notes (Tiptap.txt, langchain.txt, etc.)\n- `.env.local` - API keys

### `app/` Directory (Next.js App Router)
This contains the main application pages and API routes:
- `page.tsx` - Main landing page that initializes the editor
- `layout.tsx` - Global layout component wrapping the entire app
- `globals.css` - Global CSS styles including Tailwind imports
- `api/` subfolder (backend API endpoints):
  - Handles document CRUD, AI completions, model info, balance tracking, and prompts management

### `components/` Directory
- `TiptapEditor.tsx` - Core editor component using TipTap with AI completion features

### `lib/` Directory (Utility and Configuration)
- `completion-mark.ts` - Custom TipTap extension for handling AI completion marks/suggestions
- `model-config.ts` - Configuration for available AI models and their settings
- `saved-completion.ts` - TipTap node for savable AI snippets (★ icon)
- `db.ts` - Database connection and query logic using better-sqlite3

### `docs/` Directory (Documentation and Notes)
Contains text files documenting key integrations:
- `Tiptap.txt` - Notes on TipTap editor implementation
- `langchain.txt` - LangChain integration details
- `openrouter.txt` - OpenRouter API usage
- `prompts.txt` - Custom prompt configurations

### `public/` Directory (Static Assets)
- `favicon.ico` - App favicon

- SVG assets: file.svg, next.svg, vercel.svg, window.svg, globe.svg

## Architecture Overview\n\n### Core Data Flow\n```\nUser types → Editor detects Tab → Extract context → POST /api/autocomplete → LangChain + OpenRouter → Ghost text inserted (CompletionMark) → Word selection (arrows/Space) → Confirm (Tab/Enter) → Persist JSON to /api/doc → SQLite\n\nRegen: Tab (no sel) → Add to attempts → Regen prompt template → New ghost text\nSave: Enter → SavedCompletion node → Click ★ to preview\n```\n\n### Frontend Logic (app/page.tsx + components/TiptapEditor.tsx)\n- Single infinite doc ('infinite-doc-v1') loaded/saved via debounced fetch to /api/doc\n- TipTap editor w/ extensions: StarterKit, CompletionMark (ghost styling/selectable), SavedCompletion (★ snippets)\n- State: completion (words, selected), attempts, model, prompts, balance/pricing (fetched on mount)\n- Keyboard: Tab (gen/confirm/regen), →/← select, Space all, Esc cancel, Enter save\n\n### Backend Logic (app/api/)\n- `/api/doc`: CRUD JSON docs in SQLite (better-sqlite3 singleton)\n- `/api/autocomplete`: LangChain ChatOpenAI (OpenRouter) → system+user msg → extract completion+usage\n- `/api/prompts`: Persist/load customPrompt & regenPromptTemplate in settings table\n- `/api/models`, `/api/balance`: Fetch from OpenRouter

### Custom Extensions\n- **CompletionMark** (mark): Applies 'completion-ghost' class for styling unselected AI text; split/unset for selection visualization\n- **SavedCompletion** (node): Inline ★ icon w/ data-content; click shows popup preview

## Key Features Implemented

### AI Text Completion
- Contextual generation based on current text
- Word-by-word selection mechanism
- Regeneration capabilities
- Multiple model support with cost tracking

### User Interface
- Minimalist design optimized for writing
- Keyboard-first navigation
- Visual feedback for suggestions
- Real-time cost monitoring

### Configuration
- Custom prompts for different writing scenarios
- Model selection with pricing information
- Environment-based API key configuration

## Development and Build Process

### Scripts (from package.json)
- `npm run dev` - Development server with hot reload
- `npm run build` - Production build
- `npm run start` - Production server
- `npm run lint` - Code linting

### Configuration Requirements
- OpenRouter API key required (OPENROUTER_API_KEY)
- Optional DATABASE_PATH environment variable

### Build Output
- Next.js handles bundling of React/TypeScript code
- Static assets served from `/public`
- API routes compiled into serverless handlers

## Design Decisions\n- **Word-by-word selection**: Precise control over AI suggestions, avoiding full-paragraph commits\n- **Infinite single doc**: Simplifies UX/persistence; auto-backups in dataBackup/\n- **Local SQLite**: Offline-first, privacy (no cloud sync), fast sync queries\n- **Regen w/ attempts**: Template prevents repetitive generations via history\n- **Debounced saves**: Balances real-time UX w/ perf (1s throttle)\n- **OpenRouter**: Model agnostic, cost tracking, multi-provider\n\nThis overview provides complete structure, logic flows, and rationale.
