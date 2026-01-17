# Helm - AI-Powered Infinite Document

Helm is a sophisticated writing application that integrates advanced AI text completion capabilities into a modern, minimalist editor interface. Built with Next.js and TipTap, this application transforms the writing process by providing intelligent, context-aware text suggestions that users can selectively accept or modify.

![Helm Editor](https://via.placeholder.com/800x400/1a1a1a/ffffff?text=Helm+AI+Editor)

## Key Features

### AI-Powered Text Completion
- **Contextual Generation**: Our AI assistant analyzes your current text and generates relevant two-sentence completions based on your custom prompts
- **Word-by-Word Selection**: Navigate through AI-generated text word by word, selectively accepting only the portions you need
- **Regeneration Options**: Don't like the suggestion? Regenerate it with a single keystroke, maintaining context from previous attempts
- **Multiple AI Models**: Choose from various language models with real-time pricing information

### Interactive Editing Experience
- **Keyboard-Navigation**: Full keyboard control for rapid text manipulation
- **Visual Word Selection**: See highlighted suggestions that blend seamlessly with your document
- **Intelligent Cursor Positioning**: Automatically positions your cursor for optimal workflow
- **Cost Tracking**: Monitor token usage and generation costs in real-time

### Document Management
- **Auto-Saving**: Your work is automatically saved to local storage with debounced persistence
- **Clean Interface**: Minimalist design focused on writing without distractions
- **Custom Prompts**: Develop and save custom prompts for different writing scenarios

## Technology Stack

- **Frontend**: Next.js 16 with React 19
- **Editor**: TipTap rich text editor with custom extensions
- **Styling**: Tailwind CSS with custom dark theme
- **Database**: SQLite for document persistence
- **AI Integration**: LangChain.js with OpenRouter API
- **TypeScript**: Full type safety throughout the application

## Getting Started

### Prerequisites
- Node.js 18 or later
- npm, yarn, pnpm, or bun
- OpenRouter API key for AI functionality

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/helm.git
cd helm
```

2. Install dependencies:
```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

3. Create a `.env.local` file:
```bash
# Required for AI functionality
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Optional: Custom database path
DATABASE_PATH=./data.db
```

4. Start the development server:
```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

5. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Usage Guide

### Basic Text Completion
1. Start typing in the editor
2. Press `Tab` to generate AI completion for the current sentence
3. Use `→` and `←` arrow keys to navigate through suggested words
4. Press `Space` to select all suggested words at once
5. Press `Tab` again to confirm your selection, or `Esc` to cancel

### Advanced Features
- **Custom Prompts**: Use the left sidebar to customize prompts for different writing styles
- **Regeneration**: With no words selected, press `Tab` to regenerate a new completion
- **Model Selection**: Choose different AI models based on your needs and budget
- **Balance Tracking**: Monitor your OpenRouter credit usage in real-time

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `Tab` | Generate completion / Confirm selection / Regenerate |
| `→` | Select next word |
| `←` | Deselect last word |
| `Space` | Select all words |
| `Esc` | Cancel completion |

## API Endpoints

### Document Management
```
GET /api/doc?id={documentId}  # Fetch document
POST /api/doc                  # Save document
```

### AI Services
```
POST /api/autocomplete         # Generate text completion
GET /api/models               # Fetch available AI models and pricing
GET /api/balance              # Fetch account balance
```

## Configuration

### Model Selection
Configure available AI models in `lib/model-config.ts`. Default models include:
- OpenAI GPT-4 Turbo
- Anthropic Claude 3 Sonnet
- Google Gemini Pro

### Custom Prompts
Enhance your writing experience with custom prompts:
- **Default**: "Provide a two sentence long completion to this text:"
- **Technical Writing**: Focus on precise, technical explanations
- **Creative**: Emphasize descriptive, imaginative language
- **Business**: Professional tone with clear, concise messaging

## Architecture

### Frontend Structure
```
/
├── app/
│   ├── page.tsx              # Main application entry point
│   ├── layout.tsx            # Global layout configuration
│   └── globals.css           # Global styles
├── components/
│   └── TiptapEditor.tsx      # Main editor component
└── lib/
    ├── model-config.ts       # AI model configuration
    └── completion-mark.ts    # Custom TipTap extension
```

### Backend Services
```
app/api/
├── doc/                      # Document persistence endpoints
├── autocomplete/             # AI completion service
├── models/                   # Model and pricing information
└── balance/                  # Account balance tracking
```

## Contributing

We welcome contributions to Helm! Please feel free to submit pull requests, create issues, or suggest new features.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Development

### Project Setup
This project uses standard Next.js development patterns with additional configuration for:
- Custom TipTap extensions for text completion
- SQLite integration for local document storage
- API route handlers for AI services

### Local Development
```bash
# Install dependencies
npm install

# Start development server with hot reload
npm run dev

# Run linting
npm run lint

# Build for production
npm run build

# Start production server
npm start
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Next.js](https://nextjs.org/) for the robust framework
- [TipTap](https://tiptap.dev/) for the editor foundation
- [LangChain](https://js.langchain.com/) for AI integration
- [OpenRouter](https://openrouter.ai/) for model access and management
- [Tailwind CSS](https://tailwindcss.com/) for utility-first styling
