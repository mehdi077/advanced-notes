import { ChatOpenAI } from '@langchain/openai';

export type ModelId = 
  | 'openai/gpt-4o'
  | 'openai/gpt-4o-mini'
  | 'anthropic/claude-3.5-sonnet'
  | 'x-ai/grok-4.1-fast'
  | 'deepseek/deepseek-v3.2-exp'
  | 'meta-llama/llama-3.1-70b-instruct';

export interface ModelPricing {
  prompt: number;  // Cost per 1M tokens
  completion: number;  // Cost per 1M tokens
}

export interface ModelConfig {
  id: ModelId;
  name: string;
  description: string;
  pricing?: ModelPricing;
}

export const AVAILABLE_MODELS: ModelConfig[] = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'Most capable OpenAI model' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Excellent writing quality' },
  { id: 'x-ai/grok-4.1-fast', name: 'grok-4.1-fast', description: 'Xai model' },
  { id: 'deepseek/deepseek-v3.2-exp', name: 'Deepseek v3.2 exp', description: 'deepseek/deepseek-v3.2-exp' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', description: 'Open source model' },
];

export function formatCost(cost: number): string {
  if (cost === 0) return 'Free';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

// Default model - change this to use a different model throughout the project
export const DEFAULT_MODEL: ModelId = 'openai/gpt-4o-mini';

export function getOpenRouterModel(modelId: ModelId = DEFAULT_MODEL): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set');
  }

  return new ChatOpenAI({
    modelName: modelId,
    apiKey: apiKey,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'Helm Editor',
      },
    },
    temperature: 0.7,
    maxTokens: 200,
  });
}
