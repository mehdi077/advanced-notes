import db from '@/lib/db';

export type JumpButtonConfig = {
  id: string;
  label: string;
  bookmarkId: string | null;
  color: string; // hex (e.g. #3b82f6)
  autoJump: boolean;
};

function keyForDoc(docId: string): string {
  return `nav.jumpButtons.${docId}`;
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

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

export function getJumpButtons(docId: string): JumpButtonConfig[] {
  const id = String(docId ?? '').trim();
  if (!id) return [];

  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(keyForDoc(id)) as { value: string } | undefined;
  if (!row?.value) return [];

  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];

    const out: JumpButtonConfig[] = [];
    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      const bid = typeof obj.id === 'string' ? obj.id.trim() : '';
      const label = typeof obj.label === 'string' ? obj.label.trim() : '';
      const bookmarkId = typeof obj.bookmarkId === 'string' ? obj.bookmarkId.trim() : null;
      const color = isHexColor(obj.color) ? obj.color.trim() : '#3b82f6';
      const autoJump = obj.autoJump === true;
      if (!bid || !label) continue;
      out.push({ id: bid, label, bookmarkId: bookmarkId || null, color, autoJump });
      if (out.length >= 50) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function setJumpButtons(docId: string, buttons: JumpButtonConfig[]): JumpButtonConfig[] {
  const id = String(docId ?? '').trim();
  if (!id) return [];

  const safe: JumpButtonConfig[] = [];
  for (const b of buttons || []) {
    const bid = typeof b?.id === 'string' ? b.id.trim() : '';
    const label = typeof b?.label === 'string' ? b.label.trim() : '';
    const bookmarkId = typeof b?.bookmarkId === 'string' ? b.bookmarkId.trim() : null;
    const color = isHexColor((b as JumpButtonConfig | undefined)?.color) ? String(b.color).trim() : '#3b82f6';
    const autoJump = (b as JumpButtonConfig | undefined)?.autoJump === true;
    if (!bid || !label) continue;
    safe.push({ id: bid, label, bookmarkId: bookmarkId || null, color, autoJump });
    if (safe.length >= 50) break;
  }

  setSetting(keyForDoc(id), JSON.stringify(safe));
  return safe;
}
