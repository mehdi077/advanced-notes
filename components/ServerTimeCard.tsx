'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth-fetch';

export default function ServerTimeCard() {
  const [time, setTime] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const res = await authFetch('/api/server-time').catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json().catch(() => ({}))) as { time?: string };
      if (!cancelled && typeof data.time === 'string') setTime(data.time);
    };

    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!time) return null;

  return (
    <div className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[90] -translate-x-1/2 rounded-md border border-white/10 bg-zinc-950/60 px-2.5 py-1 text-xs font-medium text-zinc-200 shadow-lg backdrop-blur-md">
      {time}
    </div>
  );
}

