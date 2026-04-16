import { NextResponse } from 'next/server';
import { requireUnlocked } from '@/lib/unlock-server';

const GATEWAY = process.env.OPENCLAW_GATEWAY ?? 'http://144.202.59.252:18789';
const TOKEN = process.env.OPENCLAW_TOKEN ?? '';

export async function POST(request: Request) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const body = (await request.json()) as { text?: string };
    const { text } = body;
    if (!text?.trim()) {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 });
    }

    const prefixedText = `this is one of my writings, do your thing: ${text}`;

    const response = await fetch(`${GATEWAY}/hooks/wake`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: prefixedText, mode: 'now' }),
    });

    const responseBody = await response.text();

    if (!response.ok) {
      return NextResponse.json({ error: responseBody || 'Webhook failed' }, { status: 502 });
    }

    return NextResponse.json({ success: true, response: responseBody });
  } catch (e) {
    console.error('Webhook error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
