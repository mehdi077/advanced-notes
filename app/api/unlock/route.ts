import { NextRequest, NextResponse } from 'next/server';
import { isPinConfigured, setPin, verifyPin } from '@/lib/pin-auth';
import db from '@/lib/db';
import { issueUnlockToken } from '@/lib/unlock-server';

type AttemptState = {
  count: number;
  windowStartMs: number;
  blockedUntilMs: number;
};

const attemptsByIp = new Map<string, AttemptState>();

function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

function checkRateLimit(ip: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const maxAttempts = 10;
  const blockMs = 60_000;

  const state = attemptsByIp.get(ip) ?? { count: 0, windowStartMs: now, blockedUntilMs: 0 };
  if (state.blockedUntilMs > now) {
    return { ok: false, retryAfterSeconds: Math.ceil((state.blockedUntilMs - now) / 1000) };
  }

  if (now - state.windowStartMs > windowMs) {
    state.count = 0;
    state.windowStartMs = now;
  }

  state.count += 1;
  if (state.count > maxAttempts) {
    state.blockedUntilMs = now + blockMs;
    attemptsByIp.set(ip, state);
    return { ok: false, retryAfterSeconds: Math.ceil(blockMs / 1000) };
  }

  attemptsByIp.set(ip, state);
  return { ok: true };
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(ip);
  if (!limit.ok) {
    try {
      db.prepare('INSERT INTO pin_attempt_logs (ts, success, ip, user_agent) VALUES (?, ?, ?, ?)').run(
        new Date().toISOString(),
        0,
        ip,
        request.headers.get('user-agent') ?? null,
      );
    } catch {}
    return NextResponse.json(
      { error: 'Too many attempts', retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const pin = typeof body.pin === 'string' ? body.pin : '';
  const confirmPin = typeof body.confirmPin === 'string' ? body.confirmPin : undefined;

  try {
    if (!isPinConfigured()) {
      if (!confirmPin) {
        try {
          db.prepare('INSERT INTO pin_attempt_logs (ts, success, ip, user_agent) VALUES (?, ?, ?, ?)').run(
            new Date().toISOString(),
            0,
            ip,
            request.headers.get('user-agent') ?? null,
          );
        } catch {}
        return NextResponse.json({ error: 'PIN not set. Provide pin and confirmPin.' }, { status: 400 });
      }
      if (pin !== confirmPin) {
        try {
          db.prepare('INSERT INTO pin_attempt_logs (ts, success, ip, user_agent) VALUES (?, ?, ?, ?)').run(
            new Date().toISOString(),
            0,
            ip,
            request.headers.get('user-agent') ?? null,
          );
        } catch {}
        return NextResponse.json({ error: 'PINs do not match' }, { status: 400 });
      }
      setPin(pin);
    } else {
      const ok = verifyPin(pin);
      if (!ok) {
        try {
          db.prepare('INSERT INTO pin_attempt_logs (ts, success, ip, user_agent) VALUES (?, ?, ?, ?)').run(
            new Date().toISOString(),
            0,
            ip,
            request.headers.get('user-agent') ?? null,
          );
        } catch {}
        return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
      }
    }

    try {
      db.prepare('INSERT INTO pin_attempt_logs (ts, success, ip, user_agent) VALUES (?, ?, ?, ?)').run(
        new Date().toISOString(),
        1,
        ip,
        request.headers.get('user-agent') ?? null,
      );
    } catch {}

    const token = issueUnlockToken();
    const res = NextResponse.json({ success: true, token });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (e) {
    console.error('Unlock error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
