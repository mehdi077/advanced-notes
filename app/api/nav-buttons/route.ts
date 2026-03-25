import { NextRequest, NextResponse } from 'next/server';
import { getJumpButtons, setJumpButtons, type JumpButtonConfig } from '@/lib/nav-buttons';
import { requireUnlocked } from '@/lib/unlock-server';

export async function GET(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const docId = request.nextUrl.searchParams.get('docId')?.trim() || '';
    if (!docId) {
      return NextResponse.json({ error: 'Missing docId' }, { status: 400 });
    }
    return NextResponse.json({ docId, buttons: getJumpButtons(docId) });
  } catch (error) {
    console.error('Nav buttons GET error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const docId = typeof body.docId === 'string' ? body.docId.trim() : '';
    if (!docId) return NextResponse.json({ error: 'Missing docId' }, { status: 400 });

    const buttons = Array.isArray(body.buttons) ? (body.buttons as JumpButtonConfig[]) : [];
    const saved = setJumpButtons(docId, buttons);
    return NextResponse.json({ docId, buttons: saved });
  } catch (error) {
    console.error('Nav buttons POST error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
