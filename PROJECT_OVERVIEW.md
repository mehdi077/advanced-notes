# Helm Project Overview

## Project Purpose
Helm is an AI-powered infinite document writing application that integrates advanced AI text completion into a modern, minimalist editor interface. It allows users to generate contextual text suggestions and selectively accept them word-by-word, enhancing the writing process with intelligent assistance.

## Technology Stack
- **Frontend**: Next.js 16 with React 19 for the web framework
- **Editor**: TipTap rich text editor with custom extensions for AI completions
- **AI Integration**: LangChain.js with OpenRouter API for model access
- **Database**: SQLite (better-sqlite3) for local document persistence
- **Styling**: Tailwind CSS v4 with custom dark theme and typography
- **Language**: TypeScript for type safety
- **Build Tools**: ESLint for linting, PostCSS for CSS processing

## Directory Structure Overview

### Root Directory
- `package.json` - Project metadata, scripts, and dependencies
- `tsconfig.json` - TypeScript configuration
- `next.config.ts` - Next.js build and runtime configuration
- `eslint.config.mjs` - ESLint configuration for code linting
- `postcss.config.mjs` - PostCSS configuration for Tailwind
- `data.db` - SQLite database for storing documents
- `next-env.d.ts` - Next.js TypeScript declarations

### `app/` Directory (Next.js App Router)
This contains the main application pages and API routes:
- `page.tsx` - Main landing page that initializes the editor
- `layout.tsx` - Global layout component wrapping the entire app
- `globals.css` - Global CSS styles including Tailwind imports
- `api/` subfolder (backend API endpoints):
  - Handles document CRUD, AI completions, model info, and balance tracking

### `components/` Directory
- `TiptapEditor.tsx` - Core editor component using TipTap with AI completion features

### `lib/` Directory (Utility and Configuration)
- `completion-mark.ts` - Custom TipTap extension for handling AI completion marks/suggestions
- `model-config.ts` - Configuration for available AI models and their settings
- `saved-completion.ts` - Handles saving and retrieving AI completion states
- `db.ts` - Database connection and query logic using better-sqlite3

### `docs/` Directory (Documentation and Notes)
Contains text files documenting key integrations:
- `Tiptap.txt` - Notes on TipTap editor implementation
- `langchain.txt` - LangChain integration details
- `openrouter.txt` - OpenRouter API usage
- `prompts.txt` - Custom prompt configurations

### `public/` Directory (Static Assets)
- `favicon.ico` - App favicon
- `globals.css` - Wait, this seems misplaced; probably styles should be in app/
- Various SVG assets (next.svg, vercel.svg, etc.)

## Architecture Overview

### Frontend Architecture
The app follows Next.js App Router structure with client-side components:
- Main page renders the TiptapEditor component
- Editor uses TipTap with custom extensions for AI text marking
- Client-side state management for completion suggestions and document content
- Auto-saving to local SQLite database with debouncing

### Backend Architecture (API Routes in app/api/)
- **Document Management** (`/api/doc`): GET/POST for saving and retrieving documents
- **AI Completions** (`/api/autocomplete`): POST endpoint for generating text completions using LangChain
- **Model Info** (`/api/models`): GET endpoint for available AI models and pricing
- **Account Balance** (`/api/balance`): GET endpoint for tracking OpenRouter credits

### AI Integration Flow
1. User types in the editor trigger completion requests
2. Frontend sends current document context to `/api/autocomplete`
3. Backend uses LangChain with specified model to generate completions
4. Completions are returned and displayed as selectable words in the editor
5. User can navigate word-by-word using keyboard shortcuts (Tab, Space, arrows)

### Data Persistence
- Documents stored locally in SQLite database (`data.db`)
- Auto-saving functionality ensures minimal data loss
- API endpoints handle document CRUD operations

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

This overview should provide a complete understanding of the Helm project structure, flow, and implementation details for anyone diving into the codebase.
