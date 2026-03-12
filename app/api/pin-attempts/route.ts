import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireUnlocked } from '@/lib/unlock-server';

export async function GET(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  const { searchParams } = new URL(request.url);
  const limitRaw = searchParams.get('limit');
  const result = searchParams.get('result'); // success | failure | all
  const limit = Math.max(1, Math.min(200, Number(limitRaw ?? '50') || 50));

  const where =
    result === 'success' ? 'WHERE success = 1' : result === 'failure' ? 'WHERE success = 0' : '';

  const rows = db
    .prepare(
      `SELECT id, ts, success, ip, user_agent
       FROM pin_attempt_logs
       ${where}
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ id: number; ts: string; success: number; ip: string | null; user_agent: string | null }>;

  return NextResponse.json({ logs: rows.map(r => ({ ...r, success: Boolean(r.success) })) });
}
