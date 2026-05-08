import { ChatOpenAI } from '@langchain/openai';

export type ModelId = string;

export interface ModelPricing {
  prompt: number;  // Cost per 1M tokens
  completion: number;  // Cost per 1M tokens
  image?: number; // Cost per image input when reported by OpenRouter
}

export interface ModelConfig {
  id: ModelId;
  name: string;
  description: string;
  pricing?: ModelPricing;
  inputModalities?: string[];
  supportsVision?: boolean;
}

export function formatCost(cost: number): string {
  if (cost === 0) return 'Free';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

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
    maxTokens: 2000,
  });
}
