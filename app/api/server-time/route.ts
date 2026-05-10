import { NextRequest, NextResponse } from 'next/server';
import { requireUnlocked } from '@/lib/unlock-server';

export async function GET(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date());

  return NextResponse.json({ time });
}

