import db from '@/lib/db';

export type MentalNoteSource = 'selection' | 'manual';

export interface MentalNote {
  id: string;
  text: string;
  source: MentalNoteSource;
  queueRank: number;
  createdAt: string;
  updatedAt: string;
  lastShownAt: string | null;
  nextEligibleAt: string | null;
  reminderAt: string | null;
  snoozedUntil: string | null;
  rememberedAt: string | null;
  archivedAt: string | null;
  customCooldownMs: number | null;
  shownCount: number;
  status: string;
  readyAt: string | null;
}

export interface MentalNotesConfig {
  paused: boolean;
  initialDelayMinMs: number;
  initialDelayMaxMs: number;
  betweenDelayMinMs: number;
  betweenDelayMaxMs: number;
  visibleDurationMs: number;
  cooldownMs: number;
  snoozeMs: number;
  rememberedCooldownMs: number;
  previewMaxChars: number;
  sessionMaxEnabled: boolean;
  sessionMaxCount: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

type NoteRow = {
  id: string;
  text: string;
  source: string;
  queue_rank: number;
  created_at: string;
  updated_at: string;
  last_shown_at: string | null;
  next_eligible_at: string | null;
  reminder_at: string | null;
  snoozed_until: string | null;
  remembered_at: string | null;
  archived_at: string | null;
  custom_cooldown_ms: number | null;
  shown_count: number;
};

const CONFIG_KEY = 'mentalNotes.config';

export const DEFAULT_MENTAL_NOTES_CONFIG: MentalNotesConfig = {
  paused: false,
  initialDelayMinMs: 60_000,
  initialDelayMaxMs: 180_000,
  betweenDelayMinMs: 8 * 60_000,
  betweenDelayMaxMs: 25 * 60_000,
  visibleDurationMs: 60_000,
  cooldownMs: 3 * 24 * 60 * 60_000,
  snoozeMs: 30 * 60_000,
  rememberedCooldownMs: 30 * 24 * 60 * 60_000,
  previewMaxChars: 220,
  sessionMaxEnabled: false,
  sessionMaxCount: 5,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
};

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setSetting(key: string, value: string) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
}

function numberFrom(raw: unknown, fallback: number, min: number, max: number) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function boolFrom(raw: unknown, fallback: boolean) {
  return typeof raw === 'boolean' ? raw : fallback;
}

function timeFrom(raw: unknown, fallback: string) {
  if (typeof raw !== 'string') return fallback;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : fallback;
}

export function getMentalNotesConfig(): MentalNotesConfig {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(CONFIG_KEY) as { value: string } | undefined;
  if (!row?.value) {
    setMentalNotesConfig(DEFAULT_MENTAL_NOTES_CONFIG);
    return { ...DEFAULT_MENTAL_NOTES_CONFIG };
  }

  let parsed: Partial<MentalNotesConfig> = {};
  try {
    parsed = JSON.parse(row.value) as Partial<MentalNotesConfig>;
  } catch {
    parsed = {};
  }

  return normalizeConfig(parsed);
}

export function normalizeConfig(input: Partial<MentalNotesConfig>): MentalNotesConfig {
  const d = DEFAULT_MENTAL_NOTES_CONFIG;
  const cfg: MentalNotesConfig = {
    paused: boolFrom(input.paused, d.paused),
    initialDelayMinMs: numberFrom(input.initialDelayMinMs, d.initialDelayMinMs, 0, 24 * 60 * 60_000),
    initialDelayMaxMs: numberFrom(input.initialDelayMaxMs, d.initialDelayMaxMs, 0, 24 * 60 * 60_000),
    betweenDelayMinMs: numberFrom(input.betweenDelayMinMs, d.betweenDelayMinMs, 5_000, 7 * 24 * 60 * 60_000),
    betweenDelayMaxMs: numberFrom(input.betweenDelayMaxMs, d.betweenDelayMaxMs, 5_000, 7 * 24 * 60 * 60_000),
    visibleDurationMs: numberFrom(input.visibleDurationMs, d.visibleDurationMs, 5_000, 60 * 60_000),
    cooldownMs: numberFrom(input.cooldownMs, d.cooldownMs, 0, 365 * 24 * 60 * 60_000),
    snoozeMs: numberFrom(input.snoozeMs, d.snoozeMs, 60_000, 30 * 24 * 60 * 60_000),
    rememberedCooldownMs: numberFrom(input.rememberedCooldownMs, d.rememberedCooldownMs, 60_000, 365 * 24 * 60 * 60_000),
    previewMaxChars: numberFrom(input.previewMaxChars, d.previewMaxChars, 40, 2000),
    sessionMaxEnabled: boolFrom(input.sessionMaxEnabled, d.sessionMaxEnabled),
    sessionMaxCount: numberFrom(input.sessionMaxCount, d.sessionMaxCount, 1, 100),
    quietHoursEnabled: boolFrom(input.quietHoursEnabled, d.quietHoursEnabled),
    quietHoursStart: timeFrom(input.quietHoursStart, d.quietHoursStart),
    quietHoursEnd: timeFrom(input.quietHoursEnd, d.quietHoursEnd),
  };
  if (cfg.initialDelayMaxMs < cfg.initialDelayMinMs) cfg.initialDelayMaxMs = cfg.initialDelayMinMs;
  if (cfg.betweenDelayMaxMs < cfg.betweenDelayMinMs) cfg.betweenDelayMaxMs = cfg.betweenDelayMinMs;
  return cfg;
}

export function setMentalNotesConfig(input: Partial<MentalNotesConfig>): MentalNotesConfig {
  const cfg = normalizeConfig(input);
  setSetting(CONFIG_KEY, JSON.stringify(cfg));
  return cfg;
}

function statusFor(row: NoteRow, now = new Date()) {
  const reminderAt = row.reminder_at ? new Date(row.reminder_at) : null;
  if (row.archived_at) return 'Archived';
  if (reminderAt && reminderAt <= now) return 'Reminder due';
  if (reminderAt && reminderAt > now) return 'Reminder set';

  const nextEligible = row.next_eligible_at ? new Date(row.next_eligible_at) : null;

  if (row.remembered_at) {
    return !nextEligible || nextEligible <= now ? 'Ready' : 'Remembered';
  }

  const snoozedUntil = row.snoozed_until ? new Date(row.snoozed_until) : null;
  if (snoozedUntil && snoozedUntil > now) return 'Snoozed';

  if (!row.last_shown_at) return 'New';
  if (nextEligible && nextEligible > now) return 'Cooldown';
  return 'Ready';
}

function readyAtFor(row: NoteRow): string | null {
  const values = [row.next_eligible_at, row.snoozed_until].filter(Boolean) as string[];
  if (!values.length) return null;
  return values.sort()[values.length - 1];
}

function mapRow(row: NoteRow): MentalNote {
  const source = row.source === 'selection' ? 'selection' : 'manual';
  return {
    id: row.id,
    text: row.text,
    source,
    queueRank: row.queue_rank,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastShownAt: row.last_shown_at,
    nextEligibleAt: row.next_eligible_at,
    reminderAt: row.reminder_at,
    snoozedUntil: row.snoozed_until,
    rememberedAt: row.remembered_at,
    archivedAt: row.archived_at,
    customCooldownMs: row.custom_cooldown_ms,
    shownCount: row.shown_count,
    status: statusFor(row),
    readyAt: readyAtFor(row),
  };
}

function logEvent(noteId: string, eventType: string) {
  db.prepare('INSERT INTO mental_note_events (note_id, event_type, created_at) VALUES (?, ?, ?)').run(noteId, eventType, nowIso());
}

export function createMentalNote(text: string, source: MentalNoteSource = 'manual'): MentalNote {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Note text is required');
  const id = makeId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO mental_notes (id, text, source, queue_rank, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, trimmed, source, Math.random(), now, now);
  logEvent(id, 'created');
  return getMentalNote(id)!;
}

export function getMentalNote(id: string): MentalNote | null {
  const row = db.prepare('SELECT * FROM mental_notes WHERE id = ?').get(id) as NoteRow | undefined;
  return row ? mapRow(row) : null;
}

export function listMentalNotes(opts: { filter?: string; sort?: string } = {}): MentalNote[] {
  const filter = opts.filter || 'active';
  const sort = opts.sort || 'queue';
  const where = filter === 'archived' ? 'archived_at IS NOT NULL' : filter === 'all' ? '1=1' : 'archived_at IS NULL';
  const order =
    sort === 'updated'
      ? 'updated_at DESC'
      : sort === 'created'
        ? 'created_at DESC'
        : 'CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END, queue_rank ASC, created_at DESC';
  const rows = db.prepare(`SELECT * FROM mental_notes WHERE ${where} ORDER BY ${order}`).all() as NoteRow[];
  return rows.map(mapRow);
}

export function updateMentalNote(id: string, input: Partial<{ text: string; reminderAt: string | null; customCooldownMs: number | null }>): MentalNote | null {
  const existing = getMentalNote(id);
  if (!existing) return null;
  const text = typeof input.text === 'string' ? input.text.trim() : existing.text;
  if (!text) throw new Error('Note text is required');
  let reminderAt = input.reminderAt === undefined ? existing.reminderAt : input.reminderAt;
  const hasNewReminder = input.reminderAt !== undefined && Boolean(input.reminderAt);
  if (reminderAt) {
    const parsed = new Date(reminderAt);
    const now = new Date();
    now.setSeconds(0, 0);
    reminderAt = Number.isNaN(parsed.getTime()) ? null : (parsed < now ? now.toISOString() : parsed.toISOString());
  }
  const customCooldownMs = input.customCooldownMs === undefined ? existing.customCooldownMs : input.customCooldownMs;
  const now = nowIso();
  db.prepare(
    `UPDATE mental_notes
     SET text = ?, reminder_at = ?, custom_cooldown_ms = ?, remembered_at = CASE WHEN ? THEN NULL ELSE remembered_at END, updated_at = ?
     WHERE id = ?`
  ).run(text, reminderAt || null, customCooldownMs ?? null, hasNewReminder ? 1 : 0, now, id);
  logEvent(id, 'updated');
  return getMentalNote(id);
}

export function archiveMentalNote(id: string, archived: boolean): MentalNote | null {
  const now = nowIso();
  db.prepare('UPDATE mental_notes SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? now : null, now, id);
  logEvent(id, archived ? 'archived' : 'restored');
  return getMentalNote(id);
}

export function deleteMentalNote(id: string) {
  db.prepare('DELETE FROM mental_notes WHERE id = ?').run(id);
}

export function snoozeMentalNote(id: string, ms?: number): MentalNote | null {
  const cfg = getMentalNotesConfig();
  const now = new Date();
  const until = new Date(now.getTime() + (ms ?? cfg.snoozeMs)).toISOString();
  db.prepare('UPDATE mental_notes SET snoozed_until = ?, next_eligible_at = NULL, updated_at = ? WHERE id = ?').run(until, now.toISOString(), id);
  logEvent(id, 'snoozed');
  return getMentalNote(id);
}

export function rememberMentalNote(id: string, ms?: number): MentalNote | null {
  const cfg = getMentalNotesConfig();
  const now = new Date();
  const next = new Date(now.getTime() + (ms ?? cfg.rememberedCooldownMs)).toISOString();
  db.prepare(
    `UPDATE mental_notes
     SET remembered_at = ?, next_eligible_at = ?, snoozed_until = NULL, reminder_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(now.toISOString(), next, now.toISOString(), id);
  logEvent(id, 'remembered');
  return getMentalNote(id);
}


export function getNextMentalNote(opts: { force?: boolean; remindersOnly?: boolean; peek?: boolean } = {}): MentalNote | null {
  const cfg = getMentalNotesConfig();
  if (!opts.force && !opts.peek && cfg.paused) return null;
  const now = new Date();
  const nowText = now.toISOString();
  // remindersOnly: only due reminders, delivered fast via the 10s poll.
  // Regular queue excludes all reminder notes (past or future) — they're
  // handled exclusively by the reminder poll so timing is predictable.
  const where = opts.remindersOnly
    ? `reminder_at IS NOT NULL AND reminder_at <= ?`
    : `reminder_at IS NULL
       AND (remembered_at IS NULL OR next_eligible_at <= ?)
       AND (next_eligible_at IS NULL OR next_eligible_at <= ?)
       AND (snoozed_until IS NULL OR snoozed_until <= ?)`;
  const order = opts.remindersOnly
    ? 'reminder_at ASC, queue_rank ASC'
    : 'queue_rank ASC, created_at DESC';
  const params: string[] = opts.remindersOnly ? [nowText] : [nowText, nowText, nowText];
  const sql = `SELECT * FROM mental_notes WHERE archived_at IS NULL AND ${where} ORDER BY ${order} LIMIT 1`;

  if (opts.peek) {
    const row = db.prepare(sql).get(...params) as NoteRow | undefined;
    return row ? mapRow(row) : null;
  }

  return db.transaction(() => {
    const row = db.prepare(sql).get(...params) as NoteRow | undefined;
    if (!row) return null;

    const cooldown = row.custom_cooldown_ms ?? cfg.cooldownMs;
    const nextEligible = new Date(now.getTime() + cooldown).toISOString();
    const reminderAt = row.reminder_at && new Date(row.reminder_at) <= now ? null : row.reminder_at;
    db.prepare(
      `UPDATE mental_notes
       SET last_shown_at = ?, next_eligible_at = ?, reminder_at = ?, snoozed_until = NULL, shown_count = shown_count + 1, queue_rank = ?, updated_at = ?
       WHERE id = ?`
    ).run(nowText, nextEligible, reminderAt, Math.random(), nowText, row.id);
    logEvent(row.id, 'shown');
    return getMentalNote(row.id);
  }).immediate();
}
