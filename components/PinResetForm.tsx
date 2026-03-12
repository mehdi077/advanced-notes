'use client';

import { useCallback, useState } from 'react';
import { authFetch } from '@/lib/auth-fetch';
import { useUnlockStore } from '@/lib/stores/unlock-store';

export default function PinResetForm() {
  const setUnlockToken = useUnlockStore((s) => s.setUnlockToken);

  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const reset = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);

    try {
      const res = await authFetch('/api/unlock/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPin, newPin, confirmPin }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; token?: string };
      if (!res.ok || !data.token) {
        throw new Error(data.error || 'Failed to reset PIN');
      }
      setUnlockToken(data.token);
      setOldPin('');
      setNewPin('');
      setConfirmPin('');
      setOkMsg('PIN updated');
    } catch (e: unknown) {
      const msg = (typeof (e as { message?: unknown })?.message === 'string' && (e as { message: string }).message) || 'Failed to reset PIN';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [busy, oldPin, newPin, confirmPin, setUnlockToken]);

  return (
    <div className="flex flex-col gap-2 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
      <div className="text-sm text-zinc-400">Reset PIN</div>

      <div className="flex flex-col gap-2">
        <input
          value={oldPin}
          onChange={(e) => setOldPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="Old PIN"
          type="password"
          inputMode="numeric"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 font-mono"
        />
        <input
          value={newPin}
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="New PIN"
          type="password"
          inputMode="numeric"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 font-mono"
        />
        <input
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="Confirm new PIN"
          type="password"
          inputMode="numeric"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 font-mono"
        />
      </div>

      <button
        type="button"
        onClick={reset}
        disabled={busy}
        className="mt-1 flex items-center justify-center px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-white text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
      >
        {busy ? 'Updating…' : 'Update PIN'}
      </button>

      {error && <div className="text-xs text-red-300">{error}</div>}
      {okMsg && <div className="text-xs text-emerald-300">{okMsg}</div>}
    </div>
  );
}
