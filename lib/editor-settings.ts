import db from '@/lib/db';
import { getFallbackModelId, modelExists } from '@/lib/model-store';

const KEY_USE_RAG_CONTEXT = 'editor.useRagContext';
const KEY_COMPLETION_AUDIO = 'editor.completionAudio';
const KEY_SELECTED_MODEL_ID = 'editor.selectedModelId';

function parseBool(raw: string | null | undefined, defaultValue: boolean): boolean {
  if (!raw) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return defaultValue;
}

function setSetting(key: string, value: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  ).run(key, value, now);
}

export function getEditorUseRagContext(): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY_USE_RAG_CONTEXT) as { value: string } | undefined;
  return parseBool(row?.value, true);
}

export function setEditorUseRagContext(enabled: boolean): boolean {
  setSetting(KEY_USE_RAG_CONTEXT, enabled ? '1' : '0');
  return enabled;
}

export function getEditorCompletionAudio(): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY_COMPLETION_AUDIO) as { value: string } | undefined;
  return parseBool(row?.value, true);
}

export function setEditorCompletionAudio(enabled: boolean): boolean {
  setSetting(KEY_COMPLETION_AUDIO, enabled ? '1' : '0');
  return enabled;
}

export function getEditorSelectedModelId(): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY_SELECTED_MODEL_ID) as { value: string } | undefined;
  const modelId = row?.value?.trim();
  if (modelId && modelExists(modelId)) return modelId;
  return getFallbackModelId();
}

export function setEditorSelectedModelId(modelId: string): string {
  const id = modelId.trim();
  if (!id || !modelExists(id)) {
    throw new Error('Unknown model id');
  }
  setSetting(KEY_SELECTED_MODEL_ID, id);
  return id;
}
