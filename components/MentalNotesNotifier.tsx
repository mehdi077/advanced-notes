'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Clock3, ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import { authFetch } from '@/lib/auth-fetch';

type MentalNote = {
  id: string;
  text: string;
};

type MentalNotesConfig = {
  paused: boolean;
  initialDelayMinMs: number;
  initialDelayMaxMs: number;
  betweenDelayMinMs: number;
  betweenDelayMaxMs: number;
  visibleDurationMs: number;
  previewMaxChars: number;
  sessionMaxEnabled: boolean;
  sessionMaxCount: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

const fallbackConfig: MentalNotesConfig = {
  paused: false,
  initialDelayMinMs: 60_000,
  initialDelayMaxMs: 180_000,
  betweenDelayMinMs: 8 * 60_000,
  betweenDelayMaxMs: 25 * 60_000,
  visibleDurationMs: 60_000,
  previewMaxChars: 220,
  sessionMaxEnabled: false,
  sessionMaxCount: 5,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
};

function randomBetween(min: number, max: number) {
  const lo = Math.max(0, Math.min(min, max));
  const hi = Math.max(lo, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function preview(text: string, maxChars: number) {
  const max = Math.max(40, maxChars || fallbackConfig.previewMaxChars);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}...`;
}

// Quiet hours evaluated client-side so it uses the user's local timezone, not the server's.
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

function msUntilQuietHoursEnd(cfg: MentalNotesConfig): number {
  const now = new Date();
  const [eH, eM] = cfg.quietHoursEnd.split(':').map(Number);
  const end = new Date(now);
  end.setHours(eH ?? 8, eM ?? 0, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return Math.max(60_000, end.getTime() - now.getTime());
}

// Shared daily shown-count across all tabs via localStorage.
const COUNT_KEY = 'advanced-notes.mn.count';
const COUNT_DATE_KEY = 'advanced-notes.mn.count.date';

function readSharedCount(): number {
  try {
    if (localStorage.getItem(COUNT_DATE_KEY) !== new Date().toDateString()) return 0;
    return parseInt(localStorage.getItem(COUNT_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function incrementSharedCount(): void {
  try {
    const today = new Date().toDateString();
    localStorage.setItem(COUNT_DATE_KEY, today);
    localStorage.setItem(COUNT_KEY, String(readSharedCount() + 1));
  } catch {}
}

export default function MentalNotesNotifier() {
  const [note, setNote] = useState<MentalNote | null>(null);
  const [config, setConfig] = useState<MentalNotesConfig>(fallbackConfig);
  const [dismissAt, setDismissAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const configRef = useRef<MentalNotesConfig>(fallbackConfig);
  const noteRef = useRef<MentalNote | null>(null);
  const scheduleRef = useRef<number | null>(null);
  const hideRef = useRef<number | null>(null);
  const reminderPollRef = useRef<number | null>(null);
  // Exposes schedule() to dismiss() which lives outside the effect closure.
  const scheduleCallbackRef = useRef<((cfg: MentalNotesConfig, first?: boolean) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const canShow = () => {
      if (document.visibilityState !== 'visible') return false;
      if (document.hasFocus()) return true;
      // hasFocus() returns false on iOS Safari when a child element has focus.
      const active = document.activeElement;
      if (active && active !== document.body && document.body.contains(active)) return true;
      // On touch-primary devices visibility alone is the right signal —
      // the browser is in the foreground if and only if the page is visible.
      if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
      return false;
    };

    const clearTimers = () => {
      if (scheduleRef.current) window.clearTimeout(scheduleRef.current);
      if (hideRef.current) window.clearTimeout(hideRef.current);
      if (reminderPollRef.current) window.clearInterval(reminderPollRef.current);
      scheduleRef.current = null;
      hideRef.current = null;
      reminderPollRef.current = null;
    };

    const schedule = (cfg: MentalNotesConfig, first = false) => {
      if (cancelled || cfg.paused) return;
      if (cfg.sessionMaxEnabled && readSharedCount() >= cfg.sessionMaxCount) return;
      if (scheduleRef.current) window.clearTimeout(scheduleRef.current);
      if (isQuietNow(cfg)) {
        // Sleep until quiet hours end rather than burning polling cycles returning null.
        scheduleRef.current = window.setTimeout(() => void fetchNext(), msUntilQuietHoursEnd(cfg) + 5_000);
        return;
      }
      const delay = first
        ? randomBetween(cfg.initialDelayMinMs, cfg.initialDelayMaxMs)
        : randomBetween(cfg.betweenDelayMinMs, cfg.betweenDelayMaxMs);
      scheduleRef.current = window.setTimeout(() => void fetchNext(), delay);
    };
    scheduleCallbackRef.current = schedule;

    const hideAndSchedule = (cfg: MentalNotesConfig) => {
      noteRef.current = null;
      setNote(null);
      setDismissAt(null);
      if (hideRef.current) window.clearTimeout(hideRef.current);
      hideRef.current = null;
      schedule(cfg);
    };

    const fetchNext = async (remindersOnly = false) => {
      if (!canShow()) return;
      // Don't let the regular schedule overwrite a currently-visible note
      // (reminder poll may have already fired and shown something).
      if (!remindersOnly && noteRef.current) return;
      try {
        const res = await authFetch(`/api/mental-notes?action=next${remindersOnly ? '&remindersOnly=1' : ''}`);
        if (!res.ok) {
          if (!remindersOnly) schedule(configRef.current);
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { note?: MentalNote | null; config?: MentalNotesConfig };
        const nextConfig = data.config || configRef.current;
        configRef.current = nextConfig;
        setConfig(nextConfig);
        if (!data.note) {
          if (!remindersOnly) schedule(nextConfig);
          return;
        }
        // Reminders are user-set, so they don't count against the daily session max.
        if (!remindersOnly) incrementSharedCount();
        noteRef.current = data.note;
        setNote(data.note);
        if (hideRef.current) window.clearTimeout(hideRef.current);
        setDismissAt(Date.now() + nextConfig.visibleDurationMs);
        hideRef.current = window.setTimeout(() => hideAndSchedule(nextConfig), nextConfig.visibleDurationMs);
      } catch {
        if (!remindersOnly) schedule(configRef.current);
      }
    };

    let debounceTimer: number | null = null;
    const fetchDueReminderNow = () => {
      if (cancelled || noteRef.current || !canShow()) return;
      void fetchNext(true);
    };
    // Debounced so rapid keydown/pointerdown bursts collapse into one request.
    const fetchDueReminderSoon = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        fetchDueReminderNow();
      }, 500);
    };

    const boot = async () => {
      try {
        const res = await authFetch('/api/mental-notes?action=config');
        const data = (await res.json().catch(() => ({}))) as { config?: MentalNotesConfig };
        if (cancelled) return;
        const cfg = data.config || fallbackConfig;
        configRef.current = cfg;
        setConfig(cfg);
        schedule(cfg, true);
        window.setTimeout(fetchDueReminderNow, 250);
      } catch {
        schedule(fallbackConfig, true);
        window.setTimeout(fetchDueReminderNow, 250);
      }
    };

    void boot();
    reminderPollRef.current = window.setInterval(fetchDueReminderNow, 10_000);
    document.addEventListener('visibilitychange', fetchDueReminderSoon);
    document.addEventListener('focusin', fetchDueReminderSoon);
    document.addEventListener('pointerdown', fetchDueReminderSoon, { passive: true });
    document.addEventListener('keydown', fetchDueReminderSoon);
    window.addEventListener('focus', fetchDueReminderSoon);
    window.addEventListener('pageshow', fetchDueReminderSoon);
    return () => {
      cancelled = true;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      scheduleCallbackRef.current = null;
      document.removeEventListener('visibilitychange', fetchDueReminderSoon);
      document.removeEventListener('focusin', fetchDueReminderSoon);
      document.removeEventListener('pointerdown', fetchDueReminderSoon);
      document.removeEventListener('keydown', fetchDueReminderSoon);
      window.removeEventListener('focus', fetchDueReminderSoon);
      window.removeEventListener('pageshow', fetchDueReminderSoon);
      clearTimers();
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
    scheduleCallbackRef.current?.(configRef.current);
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

  const remember = async () => {
    if (!note) return;
    await authFetch('/api/mental-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remember', id: note.id }),
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
          title="Close"
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
          <button type="button" onClick={snooze} className="rounded-full border border-cyan-200/25 bg-cyan-200/10 p-2 text-cyan-100 hover:bg-cyan-200/20 hover:text-white" title="Snooze">
            <Clock3 size={16} />
          </button>
          <button type="button" onClick={remember} className="rounded-full border border-lime-200/25 bg-lime-200/10 p-2 text-lime-100 hover:bg-lime-200/20 hover:text-white" title="Remembered">
            <Check size={16} />
          </button>
          <Link href="/mental-notes" className="rounded-full border border-rose-100/25 bg-rose-100/10 p-2 text-rose-50 hover:bg-rose-100/20 hover:text-white" title="Open">
            <ExternalLink size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}
