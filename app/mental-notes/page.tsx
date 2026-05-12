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
  archivedAt: string | null;
  shownCount: number;
  status: string;
  readyAt: string | null;
};

type Config = {
  paused: boolean;
  frequencyFactor: number;
  visibleDurationMs: number;
  snoozeMs: number;
  previewMaxChars: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

const statusTone: Record<string, string> = {
  New: 'border-sky-500/40 text-sky-200 bg-sky-950/20',
  Scheduled: 'border-blue-500/40 text-blue-200 bg-blue-950/20',
  Ready: 'border-emerald-500/40 text-emerald-200 bg-emerald-950/20',
  Snoozed: 'border-amber-500/40 text-amber-200 bg-amber-950/20',
  'Reminder set': 'border-violet-500/40 text-violet-200 bg-violet-950/20',
  'Reminder due': 'border-fuchsia-500/50 text-fuchsia-200 bg-fuchsia-950/25',
  Archived: 'border-zinc-700 text-zinc-500 bg-zinc-950',
};

// ── Scheduling helpers (mirrors lib/mental-notes.ts, runs client-side for preview) ──

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function spacingFor(f: number) {
  return {
    minMs: lerp(24 * 3_600_000, 1 * 3_600_000, f),
    maxMs: lerp(72 * 3_600_000, 3 * 3_600_000, f),
  };
}

function stableJitter(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h % 100_000) / 100_000;
}

function computePreviewSchedule(notes: MentalNote[], factor: number): Array<MentalNote & { scheduledMs: number }> {
  const eligible = notes
    .filter(n => !n.reminderAt && !n.archivedAt)
    .sort((a, b) => a.queueRank - b.queueRank);
  const { minMs, maxMs } = spacingFor(factor);
  let t = Date.now();
  return eligible.map(note => {
    t += minMs + stableJitter(note.id) * (maxMs - minMs);
    return { ...note, scheduledMs: t };
  });
}

// ── Formatting ──

function msToSeconds(ms: number) { return Math.round(ms / 1000); }
function secondsToMs(s: number) { return Math.max(0, Math.round(s * 1000)); }
function msToMinutes(ms: number) { return Math.round(ms / 60_000); }
function minutesToMs(m: number) { return Math.max(0, Math.round(m * 60_000)); }

function dateInputValue(iso: string | null) {
  const d = iso ? new Date(iso) : new Date();
  const v = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
}

function timeInputValue(iso: string | null) {
  const d = iso ? new Date(iso) : new Date();
  const v = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(v.getHours())}:${pad(v.getMinutes())}`;
}

function currentDateInput() { return dateInputValue(null); }

function clampReminderParts(dateValue: string, timeValue: string) {
  const now = new Date(); now.setSeconds(0, 0);
  const next = new Date(`${dateValue}T${timeValue}`);
  const valid = Number.isNaN(next.getTime()) ? now : next;
  const clamped = valid < now ? now : valid;
  return { date: dateInputValue(clamped.toISOString()), time: timeInputValue(clamped.toISOString()), iso: clamped.toISOString() };
}

function isPastReminderParts(dateValue: string, timeValue: string) {
  const now = new Date(); now.setSeconds(0, 0);
  const next = new Date(`${dateValue}T${timeValue}`);
  return Number.isFinite(next.getTime()) && next < now;
}

function futureIso(minutes: number) {
  const d = new Date(); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

function countdown(target: string | null, nowMs: number) {
  if (!target) return 'ready';
  let diff = new Date(target).getTime() - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return 'ready';
  const days = Math.floor(diff / 86_400_000); diff -= days * 86_400_000;
  const hours = Math.floor(diff / 3_600_000); diff -= hours * 3_600_000;
  const minutes = Math.floor(diff / 60_000); diff -= minutes * 60_000;
  const seconds = Math.floor(diff / 1000);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

// ── Timeline component ──

const TIMELINE_DAYS = 14;
const ZOOM_MIN_PX = 10;   // px/hour at fully zoomed out
const ZOOM_MAX_PX = 200;  // px/hour at fully zoomed in
const ZOOM_DEFAULT = 58;  // slider 0–100, maps to ~60 px/hour

function zoomToHourPx(z: number): number {
  return Math.round(ZOOM_MIN_PX * Math.pow(ZOOM_MAX_PX / ZOOM_MIN_PX, z / 100));
}

// How many hours between each tick label given current scale.
function tickInterval(hourPx: number): number {
  if (hourPx >= 90) return 1;
  if (hourPx >= 35) return 3;
  if (hourPx >= 15) return 6;
  if (hourPx >= 7)  return 12;
  return 24;
}

// How many days between each date label.
function dayInterval(hourPx: number): number {
  if (hourPx >= 12) return 1;
  if (hourPx >= 5)  return 2;
  return 4;
}

type TimelineDot = { id: string; text: string; ms: number; isReminder: boolean };

const TIMELINE_BASELINE = 52;
const TIMELINE_HEIGHT = 108;

function Timeline({ dots, nowMs, hourPx }: { dots: TimelineDot[]; nowMs: number; hourPx: number }) {
  const [hoveredDot, setHoveredDot] = useState<(TimelineDot & { cx: number; cy: number }) | null>(null);
  const totalMs = TIMELINE_DAYS * 24 * 3_600_000;
  const totalWidth = TIMELINE_DAYS * 24 * hourPx;
  const tick = tickInterval(hourPx);
  const dayStep = dayInterval(hourPx);

  const dayMarks = useMemo(() => {
    const marks: { x: number; label: string }[] = [];
    for (let h = 0; h <= TIMELINE_DAYS * 24; h++) {
      const d = new Date(nowMs + h * 3_600_000);
      if (d.getHours() === 0) {
        const dayIndex = Math.round(h / 24);
        if (dayIndex % dayStep === 0) {
          marks.push({
            x: h * hourPx,
            label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
          });
        }
      }
    }
    return marks;
  }, [nowMs, hourPx, dayStep]);

  const hourMarks = useMemo(() => {
    const marks: { x: number; label: string; isDay: boolean }[] = [];
    for (let h = tick; h <= TIMELINE_DAYS * 24; h += tick) {
      const d = new Date(nowMs + h * 3_600_000);
      const isDay = d.getHours() === 0;
      marks.push({ x: h * hourPx, label: isDay ? '' : `${d.getHours()}h`, isDay });
    }
    return marks;
  }, [nowMs, hourPx, tick]);

  const visibleDots = dots.filter(d => d.ms > nowMs && d.ms < nowMs + totalMs);

  const nowTimeLabel = new Date(nowMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-black/60">
      <div style={{ width: totalWidth, position: 'relative', height: TIMELINE_HEIGHT }}>
        {/* Day separator lines — full height to baseline, clearly distinct */}
        {hourMarks.filter(m => m.isDay).map(m => (
          <div
            key={`day-sep-${m.x}`}
            style={{ position: 'absolute', left: m.x, top: 0, height: TIMELINE_BASELINE }}
            className="w-px bg-zinc-500/40"
          />
        ))}
        {/* Hour tick lines — short marks near baseline, subtle */}
        {hourMarks.filter(m => !m.isDay).map(m => (
          <div
            key={`hr-${m.x}`}
            style={{ position: 'absolute', left: m.x, top: TIMELINE_BASELINE - 12, height: 12 }}
            className="w-px bg-zinc-700/60"
          />
        ))}
        {/* Day labels */}
        {dayMarks.map(m => (
          <div
            key={m.x}
            style={{ position: 'absolute', left: m.x, top: 4, transform: 'translateX(-50%)' }}
            className="whitespace-nowrap text-[10px] font-medium text-zinc-400"
          >
            {m.label}
          </div>
        ))}
        {/* Hour labels */}
        {hourMarks.filter(m => m.label).map(m => (
          <div
            key={`lbl-${m.x}`}
            style={{ position: 'absolute', left: m.x, top: 22, transform: 'translateX(-50%)' }}
            className="text-[9px] text-zinc-600"
          >
            {m.label}
          </div>
        ))}
        {/* Now marker — full height, amber */}
        <div style={{ position: 'absolute', left: 0, top: 0, height: TIMELINE_HEIGHT }} className="w-0.5 bg-amber-500/70" />
        {/* Now label */}
        <div
          style={{ position: 'absolute', left: 5, top: 4 }}
          className="whitespace-nowrap text-[10px] font-semibold text-amber-400"
        >
          ▶ {nowTimeLabel}
        </div>
        {/* Baseline */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: TIMELINE_BASELINE }} className="h-px bg-zinc-700/70" />
        {/* Dots */}
        {visibleDots.map(dot => {
          const x = ((dot.ms - nowMs) / 3_600_000) * hourPx;
          return (
            <div
              key={dot.id}
              onMouseEnter={(e) => setHoveredDot({ ...dot, cx: e.clientX, cy: e.clientY })}
              onMouseMove={(e) => setHoveredDot(h => h ? { ...h, cx: e.clientX, cy: e.clientY } : null)}
              onMouseLeave={() => setHoveredDot(null)}
              style={{ position: 'absolute', left: x, top: TIMELINE_BASELINE, transform: 'translate(-50%, -50%)' }}
              className={`h-3 w-3 cursor-default rounded-full border-2 transition-all hover:scale-125 ${
                dot.isReminder
                  ? 'border-violet-400 bg-violet-500/80'
                  : 'border-amber-400/80 bg-amber-500/80'
              }`}
            />
          );
        })}
        {/* Hover tooltip — rendered fixed so it escapes overflow-x:auto clipping */}
        {hoveredDot && (() => {
          const W = 192;
          const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
          const vh = typeof window !== 'undefined' ? window.innerHeight : 600;
          const left = Math.max(8, Math.min(vw - W - 8, hoveredDot.cx - W / 2));
          const top = hoveredDot.cy + 18 > vh - 80 ? hoveredDot.cy - 70 : hoveredDot.cy + 18;
          const timeStr = new Date(hoveredDot.ms).toLocaleString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          });
          const textPreview = hoveredDot.text.length > 65
            ? `${hoveredDot.text.slice(0, 65)}…`
            : hoveredDot.text;
          return (
            <div
              style={{ position: 'fixed', left, top, width: W, zIndex: 99999 }}
              className="pointer-events-none rounded-lg border border-zinc-700 bg-zinc-900/98 px-2.5 py-2 text-xs shadow-2xl backdrop-blur"
            >
              <div className={`mb-0.5 font-semibold ${hoveredDot.isReminder ? 'text-violet-300' : 'text-amber-300'}`}>
                {timeStr}
              </div>
              <div className="leading-snug text-zinc-300">{textPreview}</div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function TimelineScheduler({ notes, config, onScheduled }: { notes: MentalNote[]; config: Config; onScheduled: () => void }) {
  const [draftFactor, setDraftFactor] = useState(config.frequencyFactor ?? 0.35);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const hourPx = zoomToHourPx(zoom);
  const nowMs = useMemo(() => Date.now(), []);

  const previewSchedule = useMemo(() => computePreviewSchedule(notes, draftFactor), [notes, draftFactor]);
  const reminderDots: TimelineDot[] = useMemo(() =>
    notes
      .filter(n => n.reminderAt && !n.archivedAt)
      .map(n => ({ id: n.id, text: n.text, ms: new Date(n.reminderAt!).getTime(), isReminder: true })),
    [notes]
  );

  const allDots: TimelineDot[] = useMemo(() => [
    ...previewSchedule.map(n => ({ id: n.id, text: n.text, ms: n.scheduledMs, isReminder: false })),
    ...reminderDots,
  ], [previewSchedule, reminderDots]);

  const handleSave = async () => {
    setSaving(true);
    await authFetch('/api/mental-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'schedule', frequencyFactor: draftFactor }),
    });
    setSaving(false);
    setIsDirty(false);
    onScheduled();
  };

  const visibleCount = previewSchedule.filter(n => n.scheduledMs > nowMs && n.scheduledMs < nowMs + TIMELINE_DAYS * 24 * 3_600_000).length;

  return (
    <div className="flex flex-col gap-3">
      <Timeline dots={allDots} nowMs={nowMs} hourPx={hourPx} />
      <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-black/40 p-3">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Less frequent</span>
          <span className="text-zinc-400">
            {visibleCount} note{visibleCount !== 1 ? 's' : ''} in next {TIMELINE_DAYS} days
            {reminderDots.length > 0 && (
              <span className="ml-1.5 text-violet-400">· {reminderDots.length} reminder{reminderDots.length !== 1 ? 's' : ''}</span>
            )}
          </span>
          <span>More frequent</span>
        </div>
        <input
          type="range"
          min="0" max="1" step="0.01"
          value={draftFactor}
          onChange={e => { setDraftFactor(Number(e.target.value)); setIsDirty(true); }}
          className="w-full accent-amber-400"
        />
        {isDirty && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-amber-400/70">Preview — click save to apply</span>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-lg border border-amber-300/30 bg-amber-950/40 px-4 py-1.5 text-sm text-amber-100 hover:bg-amber-950/60 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save schedule'}
            </button>
          </div>
        )}
        {/* Zoom */}
        <div className="flex items-center gap-2 border-t border-zinc-800/60 pt-2">
          <span className="text-[11px] text-zinc-600 select-none">−</span>
          <input
            type="range"
            min="0" max="100" step="1"
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="flex-1 accent-zinc-500"
          />
          <span className="text-[11px] text-zinc-600 select-none">+</span>
          <span className="w-12 text-right text-[10px] text-zinc-600">{hourPx}px/h</span>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──

export default function MentalNotesPage() {
  const [notes, setNotes] = useState<MentalNote[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [filter, setFilter] = useState('active');
  const [sort, setSort] = useState('queue');
  const [noteView, setNoteView] = useState<'active' | 'scheduled' | 'ready' | 'reminders' | 'snoozed' | 'archived' | 'all'>('active');
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

  useEffect(() => { void Promise.resolve().then(load); }, [load]);
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

  const updateNote = async (note: MentalNote, patch: Partial<{ text: string; reminderAt: string | null }>) => {
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

  const visibleNotes = useMemo(() => {
    if (noteView === 'scheduled') return notes.filter(n => n.status === 'Scheduled');
    if (noteView === 'ready') return notes.filter(n => n.status === 'Ready' || n.status === 'New');
    if (noteView === 'reminders') return notes.filter(n => n.status === 'Reminder set' || n.status === 'Reminder due');
    if (noteView === 'snoozed') return notes.filter(n => n.status === 'Snoozed');
    return notes;
  }, [noteView, notes]);

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
            {(['notes', 'config'] as const).map(id => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${activeTab === id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'}`}
              >
                {id === 'notes' ? 'Notes' : 'Schedule'}
              </button>
            ))}
          </div>
        </div>

        {config && activeTab === 'config' && (
          <section className="flex flex-col gap-3">
            {/* Timeline scheduler */}
            <div className="rounded-xl border border-amber-300/20 bg-[linear-gradient(135deg,rgba(69,26,3,0.45),rgba(76,5,25,0.35),rgba(8,47,73,0.35))] p-3 shadow-xl md:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-amber-50">Delivery schedule</div>
                  <div className="text-xs text-amber-100/55">Drag the slider to adjust frequency, then save. Violet dots are reminders.</div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={showNextNow} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-cyan-200/25 bg-cyan-200/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-200/20">
                    <Bell size={16} />
                    Test
                  </button>
                  <button
                    type="button"
                    onClick={() => saveConfig({ paused: !config.paused })}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm ${config.paused ? 'border-amber-400/40 bg-amber-950/30 text-amber-100' : 'border-zinc-700 bg-zinc-900/50 text-zinc-300'}`}
                  >
                    {config.paused ? <><Pause size={15} /> Paused</> : <><Play size={15} /> Active</>}
                  </button>
                </div>
              </div>
              <TimelineScheduler notes={notes.filter(n => !n.archivedAt)} config={config} onScheduled={() => void load()} />
            </div>

            {/* After actions */}
            <div className="rounded-xl border border-lime-300/15 bg-lime-950/10 p-3 md:p-4">
              <div className="mb-3">
                <div className="text-sm font-semibold text-lime-100">After actions</div>
                <div className="text-xs text-lime-100/45">How long a note stays hidden after snooze, and how long notes stay visible.</div>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <NumberField label="Snooze" value={msToMinutes(config.snoozeMs)} unit="m" onSave={v => saveConfig({ snoozeMs: minutesToMs(v) })} />
                <NumberField label="Visible" value={msToSeconds(config.visibleDurationMs)} unit="s" onSave={v => saveConfig({ visibleDurationMs: secondsToMs(v) })} />
                <NumberField label="Preview chars" value={config.previewMaxChars} onSave={v => saveConfig({ previewMaxChars: v })} />
              </div>
            </div>

            {/* Quiet hours */}
            <div className="rounded-xl border border-rose-300/15 bg-rose-950/10 p-3 md:p-4">
              <div className="mb-3">
                <div className="text-sm font-semibold text-rose-100">Quiet hours</div>
                <div className="text-xs text-rose-100/45">Notes won't surface during these hours.</div>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <ToggleField label="Quiet hours" checked={config.quietHoursEnabled} onChange={v => saveConfig({ quietHoursEnabled: v })} />
                <input className="min-w-0 rounded-lg border border-rose-200/10 bg-black/40 px-3 py-2 text-sm text-rose-50" type="time" value={config.quietHoursStart} onChange={e => void saveConfig({ quietHoursStart: e.target.value })} />
                <input className="min-w-0 rounded-lg border border-rose-200/10 bg-black/40 px-3 py-2 text-sm text-rose-50" type="time" value={config.quietHoursEnd} onChange={e => void saveConfig({ quietHoursEnd: e.target.value })} />
              </div>
            </div>
          </section>
        )}

        {previewNote && (
          <div className="rounded-xl border border-white/15 bg-zinc-950/70 p-3 text-sm text-zinc-100 shadow-xl backdrop-blur">
            <div className="mb-1 text-xs text-zinc-500">Next up (peek — not marked as shown)</div>
            {previewNote.text}
          </div>
        )}

        {activeTab === 'notes' && (
          <>
            <section className="flex flex-col gap-2 border-b border-zinc-900 pb-3 md:pb-4">
              <div className="flex gap-1 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-1">
                {([
                  ['active', 'Active'],
                  ['scheduled', 'Scheduled'],
                  ['ready', 'Ready'],
                  ['reminders', 'Reminders'],
                  ['snoozed', 'Snoozed'],
                  ['archived', 'Archived'],
                  ['all', 'All'],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setView(id)}
                    className={`shrink-0 rounded-md px-3 py-2 text-sm transition-colors ${noteView === id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 rounded-lg border border-zinc-900 bg-black p-1">
                {([['queue', 'Queue'], ['updated', 'Recent'], ['created', 'Created']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSort(id)}
                    className={`rounded-md px-2 py-1.5 text-xs transition-colors ${sort === id ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-600 hover:text-zinc-300'}`}
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
                onChange={e => setNewText(e.target.value)}
                className="min-h-44 w-full rounded-xl border border-amber-100/15 bg-black/55 px-3 py-3 text-[15px] leading-relaxed text-amber-50 outline-none placeholder:text-amber-100/30 focus:border-amber-200/40"
                placeholder="Write the text you want resurfaced..."
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-amber-100/45">{newText.trim().length} characters</div>
                <button
                  type="button"
                  onClick={() => void addNote()}
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
    if (!trimmed) { setDraft(String(value)); return; }
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
        onFocus={() => { setFocused(true); setDraft(String(value)); }}
        onChange={e => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(String(value)); e.currentTarget.blur(); }
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
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-amber-300" />
    </label>
  );
}

function NoteCard({
  note, index, nowMs, onUpdate, onAction, onDelete,
}: {
  note: MentalNote;
  index: number;
  nowMs: number;
  onUpdate: (note: MentalNote, patch: Partial<{ text: string; reminderAt: string | null }>) => Promise<void>;
  onAction: (action: string, id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [reminderDate, setReminderDate] = useState(dateInputValue(note.reminderAt));
  const [reminderTime, setReminderTime] = useState(timeInputValue(note.reminderAt));

  const tone = statusTone[note.status] || statusTone.Scheduled;
  const reminderCountdown = note.reminderAt ? countdown(note.reminderAt, nowMs) : null;
  const scheduleCountdown = countdown(note.readyAt, nowMs);
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
            {!note.reminderAt && note.readyAt && (
              <span className="inline-flex items-center gap-1 rounded border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400 md:px-2 md:py-1 md:text-xs">
                <Clock3 size={12} />
                {scheduleCountdown}
              </span>
            )}
            {reminderCountdown && (
              <span className="inline-flex items-center gap-1 rounded border border-violet-700/50 bg-violet-950/20 px-1.5 py-0.5 text-[11px] text-violet-200 md:px-2 md:py-1 md:text-xs">
                <Bell size={12} />
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
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
                <div className="text-xs text-zinc-500">{note.status} · shown {note.shownCount}×</div>
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
                  onChange={e => setDraft(e.target.value)}
                  className="mt-1 min-h-36 w-full rounded-lg border border-zinc-700 bg-black px-3 py-3 text-[15px] leading-relaxed text-zinc-100 outline-none focus:border-zinc-500"
                />
              </label>

              <div className="rounded border border-zinc-800 bg-black/40 p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-500">Remind me later</span>
                  {note.reminderAt && (
                    <button type="button" onClick={() => void onUpdate(note, { reminderAt: null })} className="text-xs text-zinc-500 hover:text-zinc-200">
                      Clear
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {([['2m', 2], ['5m', 5], ['15m', 15], ['30m', 30], ['1h', 60], ['3h', 180], ['1d', 1440], ['Now', 0]] as const).map(([label, minutes]) => (
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
                      onChange={e => {
                        const nextDate = e.target.value < currentDateInput() ? currentDateInput() : e.target.value;
                        setReminderDate(nextDate);
                      }}
                      className="min-w-0 rounded border border-zinc-800 bg-black px-2 py-2 text-sm text-zinc-200 md:py-1.5"
                    />
                    <input
                      type="time"
                      value={reminderTime}
                      onChange={e => setReminderTime(e.target.value)}
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
                    className={`mt-2 w-full rounded border px-3 py-2 text-sm font-medium hover:bg-violet-950/40 ${customIsPast ? 'border-amber-600/60 bg-amber-950/20 text-amber-100' : 'border-violet-700/60 bg-violet-950/20 text-violet-100'}`}
                  >
                    {customIsPast ? 'Set as now' : 'Set reminder'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void onUpdate(note, { text: draft })} className="rounded bg-zinc-100 px-3 py-2 text-sm font-medium text-black hover:bg-white">
                  Save text
                </button>
                <button type="button" onClick={() => void onAction(note.archivedAt ? 'restore' : 'archive', note.id)} className="rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900">
                  {note.archivedAt ? 'Restore' : 'Archive'}
                </button>
                <button type="button" onClick={() => void onDelete(note.id)} className="col-span-2 rounded border border-red-800/60 px-3 py-2 text-sm text-red-300 hover:bg-red-950/20">
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
