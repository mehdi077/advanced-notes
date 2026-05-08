import { NextResponse } from 'next/server';
import { addStoredModel, deleteStoredModel, getModelSpend, listStoredModels, mergePricing } from '@/lib/model-store';
import { requireUnlocked } from '@/lib/unlock-server';

export interface ModelPricing {
  prompt: number;  // Cost per 1M tokens
  completion: number;  // Cost per 1M tokens
}

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: ModelPricing;
}

async function getOpenRouterModelMeta(id: string, apiKey: string | undefined) {
  if (!apiKey) return null;
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const found = ((data.data || []) as Array<{
      id: string;
      name?: string;
      description?: string;
      pricing?: { prompt?: string; completion?: string; image?: string };
      architecture?: { input_modalities?: string[] };
    }>).find((m) => m.id === id);
    if (!found) return null;
    const inputModalities = Array.isArray(found.architecture?.input_modalities)
      ? found.architecture.input_modalities
      : ['text'];
    return {
      name: found.name,
      description: found.description,
      inputModalities,
      supportsVision: inputModalities.includes('image'),
      pricing: {
        prompt: parseFloat(found.pricing?.prompt || '0') * 1000000,
        completion: parseFloat(found.pricing?.completion || '0') * 1000000,
        image: parseFloat(found.pricing?.image || '0'),
      },
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const storedModels = listStoredModels();
    const apiKey = process.env.OPENROUTER_API_KEY;
    const pricingById: Record<string, ModelPricing | undefined> = {};
    const metaById: Record<string, { name?: string; description?: string; inputModalities?: string[]; supportsVision?: boolean; pricing?: ModelPricing }> = {};

    if (apiKey) {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        interface OpenRouterAPIModel {
          id: string;
          name?: string;
          pricing?: {
            prompt?: string;
            completion?: string;
            image?: string;
          };
          architecture?: {
            input_modalities?: string[];
          };
        }

        const data = await response.json();
        for (const model of (data.data || []) as OpenRouterAPIModel[]) {
          const pricing = {
            prompt: parseFloat(model.pricing?.prompt || '0') * 1000000,
            completion: parseFloat(model.pricing?.completion || '0') * 1000000,
            image: parseFloat(model.pricing?.image || '0'),
          };
          const inputModalities = Array.isArray(model.architecture?.input_modalities)
            ? model.architecture.input_modalities
            : ['text'];
          pricingById[model.id] = pricing;
          metaById[model.id] = {
            name: model.name,
            inputModalities,
            supportsVision: inputModalities.includes('image'),
            pricing,
          };
        }
      } else {
        const errorText = await response.text();
        console.error('OpenRouter models API error:', errorText);
      }
    }

    const refreshed = storedModels.map((m) => {
      const meta = metaById[m.id];
      if (meta) {
        return addStoredModel({
          id: m.id,
          name: m.name || meta.name,
          description: m.description,
          inputModalities: meta.inputModalities,
          supportsVision: meta.supportsVision,
          pricing: meta.pricing,
        });
      }
      return m;
    });

    return NextResponse.json({ models: mergePricing(refreshed, pricingById), spend: getModelSpend() });
  } catch (error) {
    console.error('Models fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) {
      return NextResponse.json({ error: 'Model id is required' }, { status: 400 });
    }
    const meta = await getOpenRouterModelMeta(id, process.env.OPENROUTER_API_KEY);

    const model = addStoredModel({
      id,
      name: typeof body.name === 'string' ? body.name : meta?.name,
      description: typeof body.description === 'string' ? body.description : meta?.description,
      inputModalities: Array.isArray(body.inputModalities) ? body.inputModalities.filter((v): v is string => typeof v === 'string') : meta?.inputModalities,
      supportsVision: typeof body.supportsVision === 'boolean' ? body.supportsVision : meta?.supportsVision,
      pricing: meta?.pricing,
    });

    return NextResponse.json({ model, models: listStoredModels(), spend: getModelSpend() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save model';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const { searchParams } = new URL(request.url);
    const queryId = searchParams.get('id')?.trim();
    const body = queryId ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
    const id = queryId || (typeof body.id === 'string' ? body.id.trim() : '');
    if (!id) {
      return NextResponse.json({ error: 'Model id is required' }, { status: 400 });
    }

    const result = deleteStoredModel(id);
    return NextResponse.json({
      ...result,
      models: listStoredModels(),
      spend: getModelSpend(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete model';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
