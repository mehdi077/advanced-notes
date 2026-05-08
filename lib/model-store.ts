import db from '@/lib/db';
import { DEFAULT_MODEL, type ModelConfig, type ModelPricing } from '@/lib/model-config';

export type StoredModel = ModelConfig;

type ModelRow = {
  id: string;
  name: string;
  description: string;
  input_modalities: string;
  supports_vision: number;
  prompt_price_per_million: number | null;
  completion_price_per_million: number | null;
  image_price: number | null;
};

function parseModalities(raw: string | null | undefined): string[] {
  if (!raw) return ['text'];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const out = parsed.filter((v): v is string => typeof v === 'string' && Boolean(v.trim()));
      return out.length ? out : ['text'];
    }
  } catch {
    // ignore
  }
  return ['text'];
}

export function listStoredModels(): StoredModel[] {
  const rows = db
    .prepare('SELECT id, name, description, input_modalities, supports_vision, prompt_price_per_million, completion_price_per_million, image_price FROM llm_models ORDER BY created_at ASC, id ASC')
    .all() as ModelRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name || row.id,
    description: row.description || '',
    inputModalities: parseModalities(row.input_modalities),
    supportsVision: Boolean(row.supports_vision),
    pricing: row.prompt_price_per_million !== null || row.completion_price_per_million !== null || row.image_price !== null
      ? {
          prompt: row.prompt_price_per_million ?? 0,
          completion: row.completion_price_per_million ?? 0,
          image: row.image_price ?? undefined,
        }
      : undefined,
  }));
}

export function addStoredModel(input: {
  id: string;
  name?: string;
  description?: string;
  inputModalities?: string[];
  supportsVision?: boolean;
  pricing?: ModelPricing;
}): StoredModel {
  const id = input.id.trim();
  if (!id) throw new Error('Model id is required');

  const name = input.name?.trim() || id;
  const description = input.description?.trim() || 'Custom OpenRouter model';
  const inputModalities = input.inputModalities?.length ? input.inputModalities : ['text'];
  const supportsVision = input.supportsVision ?? inputModalities.includes('image');
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO llm_models (
       id, name, description, input_modalities, supports_vision,
       prompt_price_per_million, completion_price_per_million, image_price,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       input_modalities = excluded.input_modalities,
       supports_vision = excluded.supports_vision,
       prompt_price_per_million = excluded.prompt_price_per_million,
       completion_price_per_million = excluded.completion_price_per_million,
       image_price = excluded.image_price,
       updated_at = excluded.updated_at`
  ).run(
    id,
    name,
    description,
    JSON.stringify(inputModalities),
    supportsVision ? 1 : 0,
    input.pricing?.prompt ?? null,
    input.pricing?.completion ?? null,
    input.pricing?.image ?? null,
    now,
    now,
  );

  return { id, name, description, inputModalities, supportsVision, pricing: input.pricing };
}

export function modelExists(modelId: string): boolean {
  const row = db.prepare('SELECT id FROM llm_models WHERE id = ?').get(modelId) as { id: string } | undefined;
  return Boolean(row?.id);
}

export function getFallbackModelId(): string {
  const row = db.prepare('SELECT id FROM llm_models ORDER BY created_at ASC, id ASC LIMIT 1').get() as { id: string } | undefined;
  return row?.id || DEFAULT_MODEL;
}

export function deleteStoredModel(modelId: string): { deleted: boolean; fallbackModelId: string } {
  const id = modelId.trim();
  if (!id) throw new Error('Model id is required');

  const count = db.prepare('SELECT COUNT(*) AS count FROM llm_models').get() as { count: number };
  if (count.count <= 1) {
    throw new Error('Cannot delete the last model');
  }

  const existing = db.prepare('SELECT id FROM llm_models WHERE id = ?').get(id) as { id: string } | undefined;
  if (!existing) {
    return { deleted: false, fallbackModelId: getFallbackModelId() };
  }

  const fallbackRow = db
    .prepare('SELECT id FROM llm_models WHERE id != ? ORDER BY created_at ASC, id ASC LIMIT 1')
    .get(id) as { id: string } | undefined;
  const fallbackModelId = fallbackRow?.id || DEFAULT_MODEL;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM llm_models WHERE id = ?').run(id);
    db.prepare('UPDATE chat_conversations SET model_id = ?, updated_at = ? WHERE model_id = ?').run(fallbackModelId, now, id);
    db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key IN (?, ?) AND value = ?').run(
      fallbackModelId,
      now,
      'chat.selectedModelId',
      'editor.selectedModelId',
      id,
    );
  });
  tx();

  return { deleted: true, fallbackModelId };
}

export function mergePricing(
  models: StoredModel[],
  pricingById: Record<string, ModelPricing | undefined>
): Array<StoredModel & { pricing?: ModelPricing }> {
  return models.map((model) => ({
    ...model,
    pricing: pricingById[model.id] ?? model.pricing,
  }));
}

export function getStoredModel(modelId: string): StoredModel | null {
  return listStoredModels().find((m) => m.id === modelId) ?? null;
}

export function getModelSpend() {
  return db
    .prepare(
      `SELECT model_id AS modelId,
              SUM(prompt_tokens) AS promptTokens,
              SUM(completion_tokens) AS completionTokens,
              SUM(total_tokens) AS totalTokens,
              SUM(total_cost) AS totalCost,
              SUM(image_cost) AS imageCost
       FROM openrouter_usage
       GROUP BY model_id
       ORDER BY totalCost DESC, model_id ASC`
    )
    .all() as Array<{
      modelId: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      totalCost: number;
      imageCost: number;
    }>;
}
