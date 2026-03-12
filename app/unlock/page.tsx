'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type UnlockStatus = { configured: boolean };

function isDigitKey(key: string): boolean {
  return key.length === 1 && key >= '0' && key <= '9';
}

export default function UnlockPage() {
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') || '/';

  const [status, setStatus] = useState<UnlockStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [setStep, setSetStep] = useState<1 | 2>(1);

  const configured = status?.configured ?? true;
  const activeValue = configured ? pin : setStep === 1 ? pin : confirmPin;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/unlock/status', { cache: 'no-store' });
        const data = (await res.json()) as UnlockStatus;
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus({ configured: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const title = useMemo(() => {
    if (configured) return 'Enter Passcode';
    return setStep === 1 ? 'Set a Passcode' : 'Re-enter Passcode';
  }, [configured, setStep]);

  const handleBackspace = useCallback(() => {
    setError(null);
    if (configured) {
      setPin(p => p.slice(0, -1));
      return;
    }

    if (setStep === 1) {
      setPin(p => p.slice(0, -1));
    } else {
      setConfirmPin(p => p.slice(0, -1));
    }
  }, [configured, setStep]);

  const handleClear = useCallback(() => {
    setError(null);
    if (configured) {
      setPin('');
      return;
    }
    if (setStep === 1) {
      setPin('');
    } else {
      setConfirmPin('');
    }
  }, [configured, setStep]);

  const handleDigit = useCallback(
    (d: string) => {
    setError(null);

    if (configured) {
      setPin(prev => (prev.length >= 6 ? prev : prev + d));
      return;
    }

    if (setStep === 1) {
      setPin(prev => (prev.length >= 6 ? prev : prev + d));
    } else {
      setConfirmPin(prev => (prev.length >= 6 ? prev : prev + d));
    }
    },
    [configured, setStep],
  );

  const submit = useCallback(async (finalPin: string, finalConfirmPin?: string) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: finalPin, confirmPin: finalConfirmPin }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setError(data.error || 'Failed to unlock');
        setPin('');
        setConfirmPin('');
        setSetStep(1);
        return;
      }

      window.location.href = nextPath;
    } catch {
      setError('Failed to unlock');
      setPin('');
      setConfirmPin('');
      setSetStep(1);
    } finally {
      setIsSubmitting(false);
    }
  }, [nextPath]);

  useEffect(() => {
    if (configured) {
      if (pin.length === 6 && !isSubmitting) void submit(pin);
      return;
    }

    if (setStep === 1) {
      if (pin.length === 6) {
        setSetStep(2);
        setConfirmPin('');
      }
      return;
    }

    if (confirmPin.length === 6 && !isSubmitting) {
      if (confirmPin !== pin) {
        setError('Passcodes do not match');
        setConfirmPin('');
      } else {
        void submit(pin, confirmPin);
      }
    }
  }, [configured, pin, confirmPin, setStep, isSubmitting, submit]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isSubmitting) return;

      if (isDigitKey(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        handleClear();
        return;
      }

      if (e.key === 'Enter') {
        if (configured && pin.length === 6 && !isSubmitting) {
          e.preventDefault();
          void submit(pin);
          return;
        }
        if (!configured && setStep === 2 && confirmPin.length === 6 && confirmPin === pin && !isSubmitting) {
          e.preventDefault();
          void submit(pin, confirmPin);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [configured, pin, confirmPin, setStep, isSubmitting, handleBackspace, handleClear, handleDigit, submit]);

  const keypad: Array<{ label: string; value: string; kind: 'digit' | 'empty' | 'backspace' }> = [
    { label: '1', value: '1', kind: 'digit' },
    { label: '2', value: '2', kind: 'digit' },
    { label: '3', value: '3', kind: 'digit' },
    { label: '4', value: '4', kind: 'digit' },
    { label: '5', value: '5', kind: 'digit' },
    { label: '6', value: '6', kind: 'digit' },
    { label: '7', value: '7', kind: 'digit' },
    { label: '8', value: '8', kind: 'digit' },
    { label: '9', value: '9', kind: 'digit' },
    { label: '', value: '', kind: 'empty' },
    { label: '0', value: '0', kind: 'digit' },
    { label: '⌫', value: '', kind: 'backspace' },
  ];

  return (
    <main className="min-h-screen w-full bg-black text-white flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <h1 className="text-xl font-medium text-white">{title}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            {configured ? 'Enter your 6-digit passcode' : 'Choose a 6-digit passcode for this database'}
          </p>
        </div>

        <div className="mt-8 flex items-center justify-center gap-3">
          {Array.from({ length: 6 }).map((_, i) => {
            const filled = i < activeValue.length;
            return (
              <div
                key={i}
                className={
                  'h-3 w-3 rounded-full border ' +
                  (filled ? 'bg-white border-white' : 'bg-transparent border-zinc-600')
                }
              />
            );
          })}
        </div>

        <div className="mt-6 min-h-[1.25rem] text-center text-sm">
          {error ? <span className="text-red-400">{error}</span> : <span className="text-transparent">.</span>}
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4 justify-items-center">
          {keypad.map((k, idx) => {
            if (k.kind === 'empty') {
              return <div key={idx} className="h-16 w-16" />;
            }

            const onClick = () => {
              if (isSubmitting) return;
              if (k.kind === 'digit') handleDigit(k.value);
              else handleBackspace();
            };

            return (
              <button
                key={idx}
                type="button"
                onClick={onClick}
                className={
                  'h-16 w-16 rounded-full border border-zinc-600 text-xl font-medium ' +
                  'text-white active:scale-[0.98] active:bg-zinc-800 transition ' +
                  (isSubmitting ? 'opacity-50 cursor-not-allowed' : 'hover:bg-zinc-900')
                }
                aria-label={k.kind === 'backspace' ? 'Delete' : `Digit ${k.label}`}
              >
                {k.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={handleClear}
            className="text-zinc-400 hover:text-white transition"
            disabled={isSubmitting}
          >
            Clear
          </button>
          <div className="text-zinc-500">{isSubmitting ? 'Checking…' : 'Keyboard: 0–9, ⌫, Enter'}</div>
        </div>
      </div>
    </main>
  );
}
