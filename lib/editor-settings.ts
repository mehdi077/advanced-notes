import db from '@/lib/db';

const KEY_USE_RAG_CONTEXT = 'editor.useRagContext';
const KEY_COMPLETION_AUDIO = 'editor.completionAudio';

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
