import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireUnlocked, clearAllUnlockTokens, issueUnlockToken } from '@/lib/unlock-server';
import { isPinConfigured, setPin, verifyPin } from '@/lib/pin-auth';

function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

function logAttempt(request: NextRequest, success: boolean) {
  try {
    db.prepare('INSERT INTO pin_attempt_logs (ts, success, ip, user_agent) VALUES (?, ?, ?, ?)').run(
      new Date().toISOString(),
      success ? 1 : 0,
      getClientIp(request),
      request.headers.get('user-agent') ?? null,
    );
  } catch {}
}

export async function POST(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  if (!isPinConfigured()) {
    logAttempt(request, false);
    return NextResponse.json({ error: 'PIN not configured' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const oldPin = typeof body.oldPin === 'string' ? body.oldPin : '';
  const newPin = typeof body.newPin === 'string' ? body.newPin : '';
  const confirmPin = typeof body.confirmPin === 'string' ? body.confirmPin : '';

  if (!/^\d{6}$/.test(oldPin) || !/^\d{6}$/.test(newPin)) {
    logAttempt(request, false);
    return NextResponse.json({ error: 'PIN must be exactly 6 digits' }, { status: 400 });
  }

  if (newPin !== confirmPin) {
    logAttempt(request, false);
    return NextResponse.json({ error: 'New PINs do not match' }, { status: 400 });
  }

  const ok = verifyPin(oldPin);
  if (!ok) {
    logAttempt(request, false);
    return NextResponse.json({ error: 'Old PIN is incorrect' }, { status: 401 });
  }

  try {
    setPin(newPin);
    logAttempt(request, true);

    // Invalidate other active unlock tokens.
    clearAllUnlockTokens();
    const token = issueUnlockToken();

    const res = NextResponse.json({ success: true, token });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (e) {
    console.error('PIN reset error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
