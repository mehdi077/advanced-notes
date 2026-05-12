'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, Clock3, ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import { authFetch } from '@/lib/auth-fetch';

type MentalNote = { id: string; text: string };

type MentalNotesConfig = {
  paused: boolean;
  visibleDurationMs: number;
  previewMaxChars: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

const fallbackConfig: MentalNotesConfig = {
  paused: false,
  visibleDurationMs: 60_000,
  previewMaxChars: 220,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
};

function preview(text: string, maxChars: number) {
  const max = Math.max(40, maxChars || fallbackConfig.previewMaxChars);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}...`;
}

// Quiet hours evaluated client-side so it respects the user's local timezone.
function isQuietNow(cfg: MentalNotesConfig): boolean {
  if (!cfg.quietHoursEnabled) return false;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [sH, sM] = cfg.quietHoursStart.split(':').map(Number);
  const [eH, eM] = cfg.quietHoursEnd.split(':').map(Number);
  const start = (sH ?? 22) * 60 + (sM ?? 0);
  const end = (eH ?? 8) * 60 + (eM ?? 0);
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

function tomorrowAt(hour: number): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.getTime() - Date.now();
}

const REMIND_OPTIONS = [
  { label: '30m', ms: () => 30 * 60_000 },
  { label: '1h', ms: () => 60 * 60_000 },
  { label: '3h', ms: () => 3 * 60 * 60_000 },
  { label: '8h', ms: () => 8 * 60 * 60_000 },
  { label: 'Tomorrow 9am', ms: () => tomorrowAt(9) },
];

export default function MentalNotesNotifier() {
  const [note, setNote] = useState<MentalNote | null>(null);
  const [config, setConfig] = useState<MentalNotesConfig>(fallbackConfig);
  const [dismissAt, setDismissAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reminderOpen, setReminderOpen] = useState(false);

  const noteRef = useRef<MentalNote | null>(null);
  const configRef = useRef<MentalNotesConfig>(fallbackConfig);
  const hideRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const canShow = () => {
      if (document.visibilityState !== 'visible') return false;
      if (document.hasFocus()) return true;
      const active = document.activeElement;
      if (active && active !== document.body && document.body.contains(active)) return true;
      if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
      return false;
    };

    const showNote = (incoming: MentalNote, cfg: MentalNotesConfig) => {
      noteRef.current = incoming;
      setNote(incoming);
      setReminderOpen(false);
      if (hideRef.current) window.clearTimeout(hideRef.current);
      setDismissAt(Date.now() + cfg.visibleDurationMs);
      hideRef.current = window.setTimeout(() => {
        noteRef.current = null;
        setNote(null);
        setDismissAt(null);
        setReminderOpen(false);
      }, cfg.visibleDurationMs);
    };

    const fetchNote = async (remindersOnly = false) => {
      if (!canShow()) return;
      if (!remindersOnly && noteRef.current) return;
      if (!remindersOnly && isQuietNow(configRef.current)) return;
      try {
        const res = await authFetch(`/api/mental-notes?action=next${remindersOnly ? '&remindersOnly=1' : ''}`);
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as { note?: MentalNote | null; config?: MentalNotesConfig };
        const cfg = data.config || configRef.current;
        configRef.current = cfg;
        setConfig(cfg);
        if (data.note) showNote(data.note, cfg);
      } catch {}
    };

    const boot = async () => {
      try {
        const res = await authFetch('/api/mental-notes?action=config');
        const data = (await res.json().catch(() => ({}))) as { config?: MentalNotesConfig };
        if (cancelled) return;
        const cfg = data.config || fallbackConfig;
        configRef.current = cfg;
        setConfig(cfg);
      } catch {}
      if (!cancelled) {
        void fetchNote();
        pollRef.current = window.setInterval(() => void fetchNote(), 60_000);
      }
    };

    void boot();

    const onActivity = () => void fetchNote(true);
    document.addEventListener('visibilitychange', onActivity);
    window.addEventListener('focus', onActivity);
    window.addEventListener('pageshow', onActivity);

    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (hideRef.current) window.clearTimeout(hideRef.current);
      document.removeEventListener('visibilitychange', onActivity);
      window.removeEventListener('focus', onActivity);
      window.removeEventListener('pageshow', onActivity);
    };
  }, []);

  useEffect(() => {
    if (!dismissAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [dismissAt]);

  const dismiss = () => {
    noteRef.current = null;
    if (hideRef.current) window.clearTimeout(hideRef.current);
    hideRef.current = null;
    setDismissAt(null);
    setNote(null);
    setReminderOpen(false);
  };

  const snooze = async () => {
    if (!note) return;
    await authFetch('/api/mental-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'snooze', id: note.id }),
    }).catch(() => {});
    dismiss();
  };

  const remindLater = async (ms: number) => {
    if (!note) return;
    await authFetch('/api/mental-notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: note.id, reminderAt: new Date(Date.now() + ms).toISOString() }),
    }).catch(() => {});
    dismiss();
  };

  if (!note) return null;
  const secondsLeft = dismissAt ? Math.max(0, Math.ceil((dismissAt - nowMs) / 1000)) : null;

  return (
    <div className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.9rem)] z-[10000] w-[min(40rem,calc(100vw-1rem))] -translate-x-1/2 animate-[fadeInUp_0.2s_ease-out] rounded-2xl border border-amber-200/45 bg-[linear-gradient(135deg,rgba(69,26,3,0.9),rgba(76,5,25,0.82)_52%,rgba(8,47,73,0.86))] px-4 py-3 text-white shadow-[0_22px_70px_rgba(251,146,60,0.22),0_18px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl ring-1 ring-rose-200/20">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={dismiss}
          className="mt-0.5 rounded-full border border-amber-100/25 bg-amber-100/10 p-1.5 text-amber-100 hover:bg-amber-100/20 hover:text-white"
          title="Dismiss"
        >
          <X size={15} />
        </button>
        <div className="min-w-0 flex-1 text-[15px] font-semibold leading-relaxed text-amber-50 md:text-base">
          {preview(note.text, config.previewMaxChars)}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {secondsLeft !== null && (
            <div className="min-w-8 rounded-full border border-amber-100/25 bg-amber-100/10 px-2 py-1 text-center text-xs font-semibold text-amber-50">
              {secondsLeft}s
            </div>
          )}
          <button
            type="button"
            onClick={snooze}
            className="rounded-full border border-cyan-200/25 bg-cyan-200/10 p-2 text-cyan-100 hover:bg-cyan-200/20 hover:text-white"
            title="Snooze"
          >
            <Clock3 size={16} />
          </button>
          <button
            type="button"
            onClick={() => setReminderOpen(v => !v)}
            className={`rounded-full border p-2 transition-colors ${reminderOpen ? 'border-violet-300/40 bg-violet-400/20 text-violet-50' : 'border-violet-200/25 bg-violet-200/10 text-violet-100 hover:bg-violet-200/20 hover:text-white'}`}
            title="Remind me later"
          >
            <Bell size={16} />
          </button>
          <Link
            href="/mental-notes"
            className="rounded-full border border-rose-100/25 bg-rose-100/10 p-2 text-rose-50 hover:bg-rose-100/20 hover:text-white"
            title="Open"
          >
            <ExternalLink size={16} />
          </Link>
        </div>
      </div>
      {reminderOpen && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-white/10 pt-2.5">
          {REMIND_OPTIONS.map(opt => (
            <button
              key={opt.label}
              type="button"
              onClick={() => void remindLater(opt.ms())}
              className="rounded-lg border border-violet-300/30 bg-violet-900/30 px-3 py-1.5 text-sm text-violet-100 hover:bg-violet-900/50"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
