import { NextRequest, NextResponse } from 'next/server';
import { getChatSettings, updateChatSettings } from '@/lib/chat-store';
import { requireUnlocked } from '@/lib/unlock-server';

export async function GET(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;
  return NextResponse.json(getChatSettings());
}

export async function POST(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const settings = updateChatSettings({
      selectedModelId: typeof body.selectedModelId === 'string' ? body.selectedModelId : undefined,
      systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
      useRagContext: typeof body.useRagContext === 'boolean' ? body.useRagContext : undefined,
    });
    return NextResponse.json(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save chat settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
