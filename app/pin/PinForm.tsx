'use client';

import { useActionState, useMemo, useRef, useState } from 'react';
import { unlock } from './actions';

type Props = {
  nextPath: string;
};

export default function PinForm({ nextPath }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pin, setPin] = useState('');

  const initialState = useMemo(() => ({ error: '' as string }), []);
  const [state, formAction, isPending] = useActionState(unlock, initialState);

  const error = state.error ?? '';

  return (
    <form action={formAction} className="mt-6">
      <input type="hidden" name="next" value={nextPath} />

      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-300">PIN</div>
        <div className="text-xs text-zinc-500">6 digits</div>
      </div>

      <div
        className="relative mt-2"
        onClick={() => inputRef.current?.focus()}
        role="presentation"
      >
        <div className="grid grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => {
            const filled = i < pin.length;
            const isActive = i === pin.length;
            return (
              <div
                key={i}
                className={
                  'h-12 select-none rounded-xl border bg-black/40 text-center font-mono text-xl leading-[3rem] ' +
                  (filled
                    ? 'border-white/20 text-white'
                    : isActive
                      ? 'border-blue-500/60 text-zinc-500 shadow-[0_0_0_3px_rgba(59,130,246,0.12)]'
                      : 'border-white/10 text-zinc-600')
                }
              >
                {filled ? '•' : ''}
              </div>
            );
          })}
        </div>

        <label htmlFor="pin" className="sr-only">
          Enter PIN
        </label>
        <input
          ref={inputRef}
          id="pin"
          name="pin"
          value={pin}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, '').slice(0, 6);
            setPin(next);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          autoFocus
          className="absolute inset-0 h-full w-full opacity-0"
          aria-label="PIN"
        />
      </div>

      <div className="mt-3 min-h-[1.25rem] text-sm" aria-live="polite">
        {error ? <span className="text-rose-300">{error}</span> : null}
      </div>

      <button
        type="submit"
        disabled={isPending || pin.length !== 6}
        className={
          'mt-3 w-full rounded-xl px-4 py-3 text-sm font-medium transition ' +
          'bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white ' +
          'shadow-[0_12px_40px_-18px_rgba(168,85,247,0.9)] ' +
          'disabled:cursor-not-allowed disabled:opacity-50 ' +
          'hover:brightness-110 active:brightness-95'
        }
      >
        {isPending ? 'Checking…' : 'Unlock'}
      </button>

      <div className="mt-4 text-center text-xs text-zinc-500">
        This app is locked behind a PIN.
      </div>
    </form>
  );
}
