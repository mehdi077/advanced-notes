'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth-fetch';

type PinAttemptLogRow = {
  id: number;
  ts: string;
  success: boolean;
  ip: string | null;
  user_agent: string | null;
};

type Filter = 'all' | 'success' | 'failure';

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function PinAttemptLog() {
  const [filter, setFilter] = useState<Filter>('all');
  const resultParam = filter === 'all' ? 'all' : filter;

  const queryKey = useMemo(() => ['pin-attempts', resultParam], [resultParam]);

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await authFetch(`/api/pin-attempts?limit=60&result=${encodeURIComponent(resultParam)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed');
      return (await res.json()) as { logs: PinAttemptLogRow[] };
    },
    refetchInterval: 3000,
  });

  const logs = data?.logs ?? [];

  return (
    <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-800/40 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-300">PIN log</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter('success')}
            className={
              'h-6 w-6 rounded-full border transition ' +
              (filter === 'success'
                ? 'border-emerald-300 bg-emerald-500/30'
                : 'border-zinc-600 bg-transparent hover:bg-zinc-700/40')
            }
            title="Show successful"
            aria-label="Show successful"
          />
          <button
            type="button"
            onClick={() => setFilter('failure')}
            className={
              'h-6 w-6 rounded-full border transition ' +
              (filter === 'failure'
                ? 'border-red-300 bg-red-500/30'
                : 'border-zinc-600 bg-transparent hover:bg-zinc-700/40')
            }
            title="Show failures"
            aria-label="Show failures"
          />
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={
              'px-2 py-1 text-[11px] rounded border transition ' +
              (filter === 'all'
                ? 'border-zinc-400 text-zinc-200'
                : 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500')
            }
            title="Clear filter"
          >
            All
          </button>
        </div>
      </div>

      <div className="mt-2 h-40 overflow-auto rounded border border-zinc-700 bg-black/20 p-2">
        {isLoading && <div className="text-xs text-zinc-500">Loading…</div>}
        {isError && <div className="text-xs text-red-400">Failed to load logs</div>}
        {!isLoading && !isError && logs.length === 0 && (
          <div className="text-xs text-zinc-500">No logs yet</div>
        )}

        <div className="flex flex-col gap-2">
          {logs.map((l) => (
            <div key={l.id} className="flex items-start gap-2 text-xs">
              <div
                className={
                  'mt-1 h-2 w-2 rounded-full ' + (l.success ? 'bg-emerald-400' : 'bg-red-400')
                }
              />
              <div className="flex-1">
                <div className={l.success ? 'text-emerald-200' : 'text-red-200'}>
                  {l.success ? 'PIN accepted' : 'Wrong PIN'}
                </div>
                <div className="text-zinc-500">{formatTs(l.ts)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
