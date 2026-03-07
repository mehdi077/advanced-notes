import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import PinForm from './PinForm';

const PIN_COOKIE_NAME = 'pin_unlocked';
const PIN_COOKIE_VALUE = '1';

function sanitizeNext(next: unknown) {
  if (typeof next !== 'string') return '/';
  if (!next.startsWith('/')) return '/';
  if (next.startsWith('//')) return '/';
  return next;
}

export default async function PinPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const nextPath = sanitizeNext(searchParams?.next);
  const cookieStore = await cookies();
  const unlocked = cookieStore.get(PIN_COOKIE_NAME)?.value === PIN_COOKIE_VALUE;
  if (unlocked) redirect(nextPath);

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-80 [background:radial-gradient(circle_at_15%_20%,rgba(59,130,246,0.18),transparent_45%),radial-gradient(circle_at_85%_25%,rgba(168,85,247,0.18),transparent_50%),radial-gradient(circle_at_50%_85%,rgba(244,114,182,0.12),transparent_55%)]" />
        <div className="absolute inset-0 opacity-15 [background-image:linear-gradient(rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.10)_1px,transparent_1px)] [background-size:40px_40px]" />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
        <section className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/55 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_30px_90px_-40px_rgba(59,130,246,0.55)] backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Enter PIN</h1>
              <p className="mt-1 text-sm text-zinc-400">Unlock access to the app.</p>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
              Protected
            </div>
          </div>

          <PinForm nextPath={nextPath} />
        </section>
      </div>
    </main>
  );
}

