import { NextResponse } from 'next/server';

export interface ModelPricing {
  prompt: number;  // Cost per 1M tokens
  completion: number;  // Cost per 1M tokens
}

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: ModelPricing;
}

export async function GET() {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENROUTER_API_KEY not configured' },
        { status: 500 }
      );
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter models API error:', errorText);
      return NextResponse.json(
        { error: 'Failed to fetch models' },
        { status: response.status }
      );
    }

    interface OpenRouterAPIModel {
      id: string;
      name?: string;
      pricing?: {
        prompt?: string;
        completion?: string;
      };
    }

    const data = await response.json();
    
    // Extract relevant model info with pricing
    const models: OpenRouterModel[] = ((data.data || []) as OpenRouterAPIModel[]).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      pricing: {
        prompt: parseFloat(model.pricing?.prompt || '0') * 1000000,  // Convert to per 1M tokens
        completion: parseFloat(model.pricing?.completion || '0') * 1000000,
      },
    }));
    
    return NextResponse.json({ models });
  } catch (error) {
    console.error('Models fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    );
  }
}
