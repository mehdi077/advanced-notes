'use client';

import { useEffect, useState } from 'react';

export default function ServerTimeCard() {
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDate(now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!time) return null;

  return (
    <div className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[90] -translate-x-1/2 select-none">
      <div
        className="relative overflow-hidden rounded-xl px-3 py-1.5 md:rounded-2xl md:px-5 md:py-2.5"
        style={{
          background: 'rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(24px) saturate(180%) brightness(1.05)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%) brightness(1.05)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          boxShadow: [
            'inset 0 1.5px 0 rgba(255, 255, 255, 0.35)',
            'inset 0 -1px 0 rgba(0, 0, 0, 0.12)',
            'inset 1px 0 0 rgba(255, 255, 255, 0.08)',
            '0 20px 50px rgba(0, 0, 0, 0.5)',
            '0 2px 8px rgba(0, 0, 0, 0.3)',
          ].join(', '),
        }}
      >
        {/* Diagonal specular highlight — simulates top-left light source */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 40%, transparent 65%)',
            pointerEvents: 'none',
          }}
        />
        {/* Content */}
        <div className="relative flex flex-col items-center gap-0.5 md:gap-1">
          <span
            className="tabular-nums text-sm font-semibold leading-none tracking-[0.12em] text-white md:text-lg md:tracking-[0.14em]"
            style={{
              fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
              textShadow: '0 1px 4px rgba(0,0,0,0.6)',
            }}
          >
            {time}
          </span>
          <span
            className="text-[8px] font-medium leading-none tracking-[0.18em] uppercase text-white/50 md:text-[9px] md:tracking-[0.22em]"
            style={{ fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' }}
          >
            {date}
          </span>
        </div>
      </div>
    </div>
  );
}
