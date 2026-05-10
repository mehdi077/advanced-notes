'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  ChevronLeft,
  Clock3,
  Eye,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Shuffle,
  X,
} from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';

type MentalNote = {
  id: string;
  text: string;
  source: 'selection' | 'manual';
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
};

type Config = {
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
};

const statusTone: Record<string, string> = {
  New: 'border-sky-500/40 text-sky-200 bg-sky-950/20',
  Ready: 'border-emerald-500/40 text-emerald-200 bg-emerald-950/20',
  Cooldown: 'border-zinc-600 text-zinc-300 bg-zinc-900',
  Snoozed: 'border-amber-500/40 text-amber-200 bg-amber-950/20',
  'Reminder set': 'border-violet-500/40 text-violet-200 bg-violet-950/20',
  'Reminder due': 'border-fuchsia-500/50 text-fuchsia-200 bg-fuchsia-950/25',
  Remembered: 'border-green-500/40 text-green-200 bg-green-950/20',
  Archived: 'border-zinc-700 text-zinc-500 bg-zinc-950',
};

function msToMinutes(ms: number) {
  return Math.round(ms / 60_000);
}

function minutesToMs(minutes: number) {
  return Math.max(0, Math.round(minutes * 60_000));
}

function msToSeconds(ms: number) {
  return Math.round(ms / 1000);
}

function secondsToMs(seconds: number) {
  return Math.max(0, Math.round(seconds * 1000));
}

function msToDays(ms: number) {
  return Math.round(ms / 86_400_000);
}

function daysToMs(days: number) {
  return Math.max(0, Math.round(days * 86_400_000));
}

function dateInputValue(iso: string | null) {
  const d = iso ? new Date(iso) : new Date();
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${valid.getFullYear()}-${pad(valid.getMonth() + 1)}-${pad(valid.getDate())}`;
}

function timeInputValue(iso: string | null) {
  const d = iso ? new Date(iso) : new Date();
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(valid.getHours())}:${pad(valid.getMinutes())}`;
}

function currentDateInput() {
  return dateInputValue(null);
}

function clampReminderParts(dateValue: string, timeValue: string) {
  const now = new Date();
  now.setSeconds(0, 0);
  const next = new Date(`${dateValue}T${timeValue}`);
  const valid = Number.isNaN(next.getTime()) ? now : next;
  const clamped = valid < now ? now : valid;
  return {
    date: dateInputValue(clamped.toISOString()),
    time: timeInputValue(clamped.toISOString()),
    iso: clamped.toISOString(),
  };
}

function isPastReminderParts(dateValue: string, timeValue: string) {
  const now = new Date();
  now.setSeconds(0, 0);
  const next = new Date(`${dateValue}T${timeValue}`);
  return Number.isFinite(next.getTime()) && next < now;
}

function futureIso(minutes: number) {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

function countdown(target: string | null, nowMs: number) {
  if (!target) return 'ready';
  let diff = new Date(target).getTime() - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return 'ready';
  const days = Math.floor(diff / 86_400_000);
  diff -= days * 86_400_000;
  const hours = Math.floor(diff / 3_600_000);
  diff -= hours * 3_600_000;
  const minutes = Math.floor(diff / 60_000);
  diff -= minutes * 60_000;
  const seconds = Math.floor(diff / 1000);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

export default function MentalNotesPage() {
  const [notes, setNotes] = useState<MentalNote[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [filter, setFilter] = useState('active');
  const [sort, setSort] = useState('queue');
  const [noteView, setNoteView] = useState<'active' | 'ready' | 'reminders' | 'cooldown' | 'archived' | 'all'>('active');
  const [newText, setNewText] = useState('');
  const [activeTab, setActiveTab] = useState<'notes' | 'config'>('notes');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [previewNote, setPreviewNote] = useState<MentalNote | null>(null);

  const load = useCallback(async () => {
    const res = await authFetch(`/api/mental-notes?filter=${encodeURIComponent(filter)}&sort=${encodeURIComponent(sort)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { notes: MentalNote[]; config: Config };
    setNotes(data.notes || []);
    setConfig(data.config);
  }, [filter, sort]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const saveConfig = async (patch: Partial<Config>) => {
    if (!config) return;
    const next = { ...config, ...patch };
    setConfig(next);
    const res = await authFetch('/api/mental-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'config', config: next }),
    });
    if (res.ok) {
      const data = (await res.json()) as { config: Config };
      setConfig(data.config);
    }
  };

  const addNote = async () => {
    const text = newText.trim();
    if (!text) return;
    setNewText('');
    await authFetch('/api/mental-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, source: 'manual' }),
    });
    await load();
    setIsNewModalOpen(false);
  };

  const updateNote = async (note: MentalNote, patch: Partial<{ text: string; reminderAt: string | null; customCooldownMs: number | null }>) => {
    const res = await authFetch('/api/mental-notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: note.id, ...patch }),
    });
    if (res.ok) await load();
  };

  const noteAction = async (action: string, id: string) => {
    await authFetch('/api/mental-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id }),
    });
    await load();
  };

  const deleteNote = async (id: string) => {
    await authFetch(`/api/mental-notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  };

  const showNextNow = async () => {
    const res = await authFetch('/api/mental-notes?action=next&force=1&peek=1');
    if (!res.ok) return;
    const data = (await res.json()) as { note: MentalNote | null };
    setPreviewNote(data.note || null);
    await load();
  };

  const orderedNotes = useMemo(() => notes, [notes]);
  const visibleNotes = useMemo(() => {
    if (noteView === 'ready') return orderedNotes.filter(note => note.status === 'Ready' || note.status === 'New');
    if (noteView === 'reminders') return orderedNotes.filter(note => note.status === 'Reminder set' || note.status === 'Reminder due');
    if (noteView === 'cooldown') return orderedNotes.filter(note => note.status === 'Cooldown' || note.status === 'Snoozed' || note.status === 'Remembered');
    return orderedNotes;
  }, [noteView, orderedNotes]);
  const setView = (view: typeof noteView) => {
    setNoteView(view);
    if (view === 'archived') setFilter('archived');
    else if (view === 'all') setFilter('all');
    else setFilter('active');
  };

  return (
    <main className="min-h-screen bg-black pb-6 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-2 py-3 md:gap-4 md:px-4 md:py-8">
        <div className="sticky top-0 z-30 -mx-2 border-b border-zinc-800 bg-black/85 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+2.25rem)] backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
            <Link href="/" className="inline-flex h-9 items-center gap-1 rounded border border-zinc-700 px-2.5 text-sm text-zinc-200 hover:bg-zinc-900 md:px-3">
              <ChevronLeft size={16} />
              Back
            </Link>
            <h1 className="min-w-0 truncate text-lg text-zinc-100 md:text-2xl">Mental Notes</h1>
            <button type="button" onClick={() => void load()} className="h-9 rounded border border-zinc-700 px-2.5 text-zinc-300 hover:bg-zinc-900">
              <RefreshCw size={16} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            {[
              ['notes', 'Notes'],
              ['config', 'Config'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id as 'notes' | 'config')}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {config && activeTab === 'config' && (
          <section className="flex flex-col gap-3">
            <div className="rounded-xl border border-amber-300/20 bg-[linear-gradient(135deg,rgba(69,26,3,0.45),rgba(76,5,25,0.35),rgba(8,47,73,0.35))] p-3 shadow-xl md:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-amber-50">Delivery</div>
                  <div className="text-xs text-amber-100/55">When notes appear after you visit or between reminders.</div>
                </div>
                <button type="button" onClick={showNextNow} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-cyan-200/25 bg-cyan-200/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-200/20">
                  <Bell size={16} />
                  Test
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <ToggleField label="Paused" checked={config.paused} onChange={(v) => saveConfig({ paused: v })} icon={config.paused ? <Pause size={15} /> : <Play size={15} />} />
                <NumberField label="First min" value={msToSeconds(config.initialDelayMinMs)} unit="s" onSave={(v) => saveConfig({ initialDelayMinMs: secondsToMs(v) })} />
                <NumberField label="First max" value={msToSeconds(config.initialDelayMaxMs)} unit="s" onSave={(v) => saveConfig({ initialDelayMaxMs: secondsToMs(v) })} />
                <NumberField label="Visible" value={msToSeconds(config.visibleDurationMs)} unit="s" onSave={(v) => saveConfig({ visibleDurationMs: secondsToMs(v) })} />
                <NumberField label="Between min" value={msToSeconds(config.betweenDelayMinMs)} unit="s" onSave={(v) => saveConfig({ betweenDelayMinMs: secondsToMs(v) })} />
                <NumberField label="Between max" value={msToSeconds(config.betweenDelayMaxMs)} unit="s" onSave={(v) => saveConfig({ betweenDelayMaxMs: secondsToMs(v) })} />
                <NumberField label="Preview" value={config.previewMaxChars} onSave={(v) => saveConfig({ previewMaxChars: v })} />
              </div>
            </div>

            <div className="rounded-xl border border-lime-300/15 bg-lime-950/10 p-3 md:p-4">
              <div className="mb-3">
                <div className="text-sm font-semibold text-lime-100">After actions</div>
                <div className="text-xs text-lime-100/45">Cooldowns after a note appears, gets snoozed, or is marked remembered.</div>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <NumberField label="Cooldown" value={msToDays(config.cooldownMs)} unit="d" onSave={(v) => saveConfig({ cooldownMs: daysToMs(v) })} />
                <NumberField label="Snooze" value={msToMinutes(config.snoozeMs)} unit="m" onSave={(v) => saveConfig({ snoozeMs: minutesToMs(v) })} />
                <NumberField label="Remembered" value={msToDays(config.rememberedCooldownMs)} unit="d" onSave={(v) => saveConfig({ rememberedCooldownMs: daysToMs(v) })} />
              </div>
            </div>

            <div className="rounded-xl border border-rose-300/15 bg-rose-950/10 p-3 md:p-4">
              <div className="mb-3">
                <div className="text-sm font-semibold text-rose-100">Limits and quiet hours</div>
                <div className="text-xs text-rose-100/45">Optional controls for future stricter delivery.</div>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <ToggleField label="Session max" checked={config.sessionMaxEnabled} onChange={(v) => saveConfig({ sessionMaxEnabled: v })} />
                <NumberField label="Max/session" value={config.sessionMaxCount} onSave={(v) => saveConfig({ sessionMaxCount: v })} />
                <ToggleField label="Quiet hours" checked={config.quietHoursEnabled} onChange={(v) => saveConfig({ quietHoursEnabled: v })} />
                <input className="min-w-0 rounded-lg border border-rose-200/10 bg-black/40 px-3 py-2 text-sm text-rose-50" type="time" value={config.quietHoursStart} onChange={(e) => void saveConfig({ quietHoursStart: e.target.value })} />
                <input className="min-w-0 rounded-lg border border-rose-200/10 bg-black/40 px-3 py-2 text-sm text-rose-50" type="time" value={config.quietHoursEnd} onChange={(e) => void saveConfig({ quietHoursEnd: e.target.value })} />
              </div>
            </div>
          </section>
        )}

        {previewNote && (
          <div className="rounded-xl border border-white/15 bg-zinc-950/70 p-3 text-sm text-zinc-100 shadow-xl backdrop-blur">
            <div className="mb-1 text-xs text-zinc-500">Previewed now</div>
            {previewNote.text}
          </div>
        )}

        {activeTab === 'notes' && (
          <>
          <section className="flex flex-col gap-2 border-b border-zinc-900 pb-3 md:pb-4">
            <div className="flex gap-1 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-1">
              {[
                ['active', 'Active'],
                ['ready', 'Ready'],
                ['reminders', 'Reminders'],
                ['cooldown', 'Waiting'],
                ['archived', 'Archived'],
                ['all', 'All'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id as typeof noteView)}
                  className={`shrink-0 rounded-md px-3 py-2 text-sm transition-colors ${
                    noteView === id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 rounded-lg border border-zinc-900 bg-black p-1">
              {[
                ['queue', 'Queue'],
                ['updated', 'Recent'],
                ['created', 'Created'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSort(id)}
                  className={`rounded-md px-2 py-1.5 text-xs transition-colors ${
                    sort === id ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-600 hover:text-zinc-300'
                  }`}
                >
                  {label}
                </button>
              ))}
              <button type="button" onClick={() => void load()} className="rounded-md px-2 py-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200">
                <RefreshCw size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setIsNewModalOpen(true)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-amber-300/25 bg-[linear-gradient(135deg,rgba(69,26,3,0.55),rgba(76,5,25,0.4))] px-3 text-sm font-medium text-amber-50 shadow-lg hover:bg-amber-950/30"
            >
              <Plus size={16} />
              New note
            </button>
          </section>

          <section className="flex flex-col gap-3">
            {visibleNotes.map((note, index) => (
              <NoteCard
                key={`${note.id}-${note.updatedAt}`}
                note={note}
                index={index}
                nowMs={nowMs}
                config={config}
                onUpdate={updateNote}
                onAction={noteAction}
                onDelete={deleteNote}
              />
            ))}
          </section>
          </>
        )}

        {isNewModalOpen && (
          <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-2xl border border-amber-200/25 bg-[linear-gradient(135deg,rgba(24,24,27,0.98),rgba(69,26,3,0.92),rgba(76,5,25,0.86))] p-4 shadow-2xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-amber-50">New mental note</div>
                  <div className="text-xs text-amber-100/55">Manual note, separate from editor selection capture.</div>
                </div>
                <button type="button" onClick={() => setIsNewModalOpen(false)} className="rounded-full border border-white/10 bg-white/5 p-2 text-amber-100 hover:bg-white/10">
                  <X size={16} />
                </button>
              </div>
              <textarea
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                className="min-h-44 w-full rounded-xl border border-amber-100/15 bg-black/55 px-3 py-3 text-[15px] leading-relaxed text-amber-50 outline-none placeholder:text-amber-100/30 focus:border-amber-200/40"
                placeholder="Write the text you want resurfaced..."
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-amber-100/45">{newText.trim().length} characters</div>
                <button
                  type="button"
                  onClick={addNote}
                  disabled={!newText.trim()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-amber-100 px-4 text-sm font-semibold text-black hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus size={16} />
                  Add note
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function NumberField({ label, value, unit, onSave }: { label: string; value: number; unit?: string; onSave: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const displayValue = focused ? draft : String(value);
  const commit = () => {
    setFocused(false);
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(String(value));
      return;
    }
    const next = Number(trimmed);
    if (Number.isFinite(next)) onSave(next);
    else setDraft(String(value));
  };

  return (
    <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/35 px-2 py-2 text-sm md:px-3">
      <span className="min-w-0 flex-1 truncate text-white/70">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={displayValue}
        onFocus={() => {
          setFocused(true);
          setDraft(String(value));
        }}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(String(value));
            e.currentTarget.blur();
          }
        }}
        className="w-16 rounded-md border border-white/10 bg-black/60 px-2 py-1 text-right text-white outline-none focus:border-amber-200/40 md:w-20"
      />
      {unit && <span className="text-xs text-white/40">{unit}</span>}
    </label>
  );
}

function ToggleField({ label, checked, icon, onChange }: { label: string; checked: boolean; icon?: React.ReactNode; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm">
      <span className="inline-flex min-w-0 items-center gap-2 truncate text-white/75">
        {icon}
        {label}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-amber-300" />
    </label>
  );
}

function NoteCard({
  note,
  index,
  nowMs,
  config,
  onUpdate,
  onAction,
  onDelete,
}: {
  note: MentalNote;
  index: number;
  nowMs: number;
  config: Config | null;
  onUpdate: (note: MentalNote, patch: Partial<{ text: string; reminderAt: string | null; customCooldownMs: number | null }>) => Promise<void>;
  onAction: (action: string, id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [customCooldownDays, setCustomCooldownDays] = useState(note.customCooldownMs === null ? '' : String(msToDays(note.customCooldownMs)));
  const [reminderDate, setReminderDate] = useState(dateInputValue(note.reminderAt));
  const [reminderTime, setReminderTime] = useState(timeInputValue(note.reminderAt));

  const tone = statusTone[note.status] || statusTone.Queued;
  const reminderCountdown = note.reminderAt ? countdown(note.reminderAt, nowMs) : null;
  const queueCountdown = countdown(note.readyAt, nowMs);
  const customIsPast = isPastReminderParts(reminderDate, reminderTime);
  const applyCustomReminder = () => {
    const clamped = clampReminderParts(reminderDate, reminderTime);
    setReminderDate(clamped.date);
    setReminderTime(clamped.time);
    void onUpdate(note, { reminderAt: clamped.iso });
  };

  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-2.5 md:p-3">
      <div className="min-w-0">
        <div className="mb-2 grid grid-cols-[1fr_auto] items-start gap-2">
          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            <span className="rounded border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-500 md:px-2 md:py-1 md:text-xs">#{index + 1}</span>
            <span className={`rounded border px-1.5 py-0.5 text-[11px] md:px-2 md:py-1 md:text-xs ${tone}`}>{note.status}</span>
            <span className="rounded border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-500 md:px-2 md:py-1 md:text-xs">{note.source}</span>
            <span className="inline-flex items-center gap-1 rounded border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400 md:px-2 md:py-1 md:text-xs">
              <Eye size={12} />
              {note.shownCount}
            </span>
            {!note.reminderAt && (
              <span className="inline-flex items-center gap-1 rounded border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400 md:px-2 md:py-1 md:text-xs">
                <Shuffle size={12} />
                <span className="text-zinc-600">Queue</span> {queueCountdown}
              </span>
            )}
            {reminderCountdown && (
              <span className="inline-flex items-center gap-1 rounded border border-violet-700/50 bg-violet-950/20 px-1.5 py-0.5 text-[11px] text-violet-200 md:px-2 md:py-1 md:text-xs">
                <Clock3 size={12} />
                <span className="text-violet-400">Reminder</span> {reminderCountdown}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="rounded-lg border border-zinc-800 bg-black/40 p-2 text-zinc-300 hover:bg-zinc-900"
            title="Note settings"
          >
            <Settings2 size={16} />
          </button>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-black/45 shadow-inner">
          <div className="border-l-2 border-zinc-500/70 px-3 py-3 md:px-4">
            <p className="whitespace-pre-wrap break-words text-[16px] font-medium leading-7 text-zinc-50 md:text-[17px] md:leading-8">
              {note.text}
            </p>
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-0.5 text-[11px] text-zinc-600 sm:block sm:text-xs">
          <span>Added {new Date(note.createdAt).toLocaleString()}</span>
          <span className="hidden sm:inline"> · </span>
          <span>Updated {new Date(note.updatedAt).toLocaleString()}</span>
        </div>
      </div>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border border-white/15 bg-zinc-950 p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-zinc-100">Note settings</div>
                <div className="text-xs text-zinc-500">{note.status} · shown {note.shownCount}</div>
              </div>
              <button type="button" onClick={() => setIsSettingsOpen(false)} className="rounded-full border border-zinc-800 p-2 text-zinc-300 hover:bg-zinc-900">
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-xs text-zinc-500">
                Text
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="mt-1 min-h-36 w-full rounded-lg border border-zinc-700 bg-black px-3 py-3 text-[15px] leading-relaxed text-zinc-100 outline-none focus:border-zinc-500"
                />
              </label>

              <div className="rounded border border-zinc-800 bg-black/40 p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-500">Reminder</span>
                  {note.reminderAt && (
                    <button type="button" onClick={() => void onUpdate(note, { reminderAt: null })} className="text-xs text-zinc-500 hover:text-zinc-200">
                      Clear
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    ['2m', 2],
                    ['5m', 5],
                    ['15m', 15],
                    ['30m', 30],
                    ['1h', 60],
                    ['3h', 180],
                    ['1d', 1440],
                    ['Now', 0],
                  ].map(([label, minutes]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => void onUpdate(note, { reminderAt: futureIso(Number(minutes)) })}
                      className="rounded border border-violet-800/60 bg-violet-950/10 px-2 py-2 text-xs text-violet-200 hover:bg-violet-950/30 md:py-1.5"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 rounded border border-zinc-800 bg-zinc-950 p-2">
                  <div className="mb-2 text-[11px] text-zinc-500">Custom time</div>
                  <div className="grid grid-cols-[1fr_0.75fr] gap-2">
                    <input
                      type="date"
                      min={currentDateInput()}
                      value={reminderDate}
                      onChange={(e) => {
                        const nextDate = e.target.value < currentDateInput() ? currentDateInput() : e.target.value;
                        setReminderDate(nextDate);
                      }}
                      className="min-w-0 rounded border border-zinc-800 bg-black px-2 py-2 text-sm text-zinc-200 md:py-1.5"
                    />
                    <input
                      type="time"
                      value={reminderTime}
                      onChange={(e) => setReminderTime(e.target.value)}
                      onBlur={() => {
                        const next = clampReminderParts(reminderDate, reminderTime);
                        setReminderDate(next.date);
                        setReminderTime(next.time);
                      }}
                      className="min-w-0 rounded border border-zinc-800 bg-black px-2 py-2 text-sm text-zinc-200 md:py-1.5"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={applyCustomReminder}
                    className={`mt-2 w-full rounded border px-3 py-2 text-sm font-medium hover:bg-violet-950/40 ${
                      customIsPast ? 'border-amber-600/60 bg-amber-950/20 text-amber-100' : 'border-violet-700/60 bg-violet-950/20 text-violet-100'
                    }`}
                  >
                    {customIsPast ? 'Set as now' : 'Set reminder'}
                  </button>
                </div>
              </div>

              <label className="text-xs text-zinc-500">
                Cooldown override
                <input
                  type="number"
                  placeholder={config ? `${msToDays(config.cooldownMs)}d global` : 'global'}
                  value={customCooldownDays}
                  onChange={(e) => setCustomCooldownDays(e.target.value)}
                  onBlur={() => {
                    const value = customCooldownDays.trim();
                    void onUpdate(note, { customCooldownMs: value ? daysToMs(Number(value)) : null });
                  }}
                  className="mt-1 w-full rounded border border-zinc-800 bg-black px-2 py-1.5 text-sm text-zinc-200"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void onUpdate(note, { text: draft })} className="rounded bg-zinc-100 px-3 py-2 text-sm font-medium text-black hover:bg-white">
                  Save text
                </button>
                <button type="button" onClick={() => void onAction(note.archivedAt ? 'restore' : 'archive', note.id)} className="rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900">
                  {note.archivedAt ? 'Restore' : 'Archive'}
                </button>
                <button type="button" onClick={() => void onAction('remember', note.id)} className="rounded border border-emerald-800/60 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-950/20">
                  Remembered
                </button>
                <button type="button" onClick={() => void onDelete(note.id)} className="rounded border border-red-800/60 px-3 py-2 text-sm text-red-300 hover:bg-red-950/20">
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
