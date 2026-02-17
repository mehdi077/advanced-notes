import db from '@/lib/db';

const RAG_TOP_K_KEY = 'ragTopK';
const DEFAULT_RAG_TOP_K = 3;
const MIN_RAG_TOP_K = 1;
const MAX_RAG_TOP_K = 50;

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function getRagTopK(): number {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(RAG_TOP_K_KEY) as { value: string } | undefined;
  const parsed = row?.value ? Number.parseInt(row.value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < MIN_RAG_TOP_K) return DEFAULT_RAG_TOP_K;
  return clampInt(parsed, MIN_RAG_TOP_K, MAX_RAG_TOP_K);
}

export function setRagTopK(topK: number): number {
  const value = clampInt(topK, MIN_RAG_TOP_K, MAX_RAG_TOP_K);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  ).run(RAG_TOP_K_KEY, String(value), now);
  return value;
}

export const ragTopKDefaults = {
  key: RAG_TOP_K_KEY,
  defaultValue: DEFAULT_RAG_TOP_K,
  min: MIN_RAG_TOP_K,
  max: MAX_RAG_TOP_K,
};
