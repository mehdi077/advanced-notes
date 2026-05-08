import { NextRequest, NextResponse } from 'next/server';
import {
  createConversation,
  deleteConversation,
  getChatSettings,
  getConversation,
  listConversations,
  listMessages,
  setCurrentConversationId,
  updateConversationRuntime,
} from '@/lib/chat-store';
import { requireUnlocked } from '@/lib/unlock-server';

function conversationPayload(id: string) {
  const conversation = getConversation(id);
  if (!conversation) return null;
  return {
    conversation,
    messages: listMessages(id),
  };
}

export async function GET(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (id) {
    const payload = conversationPayload(id);
    if (!payload) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(payload);
  }

  const settings = getChatSettings();
  const current = conversationPayload(settings.currentConversationId);
  return NextResponse.json({
    conversations: listConversations(),
    current,
    settings,
  });
}

export async function POST(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const settings = getChatSettings();
    const conversation = createConversation({
      modelId: settings.selectedModelId,
      systemPrompt: settings.systemPrompt,
      useRagContext: settings.useRagContext,
      title: typeof body.title === 'string' ? body.title : undefined,
    });
    setCurrentConversationId(conversation.id);
    return NextResponse.json({
      conversation,
      messages: [],
      conversations: listConversations(),
      settings: getChatSettings(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create chat';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    if (body.setCurrent === true) {
      setCurrentConversationId(id);
    }

    const updated = updateConversationRuntime(id, {
      modelId: typeof body.modelId === 'string' ? body.modelId : undefined,
      systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
      useRagContext: typeof body.useRagContext === 'boolean' ? body.useRagContext : undefined,
    });

    return NextResponse.json({
      conversation: updated,
      messages: listMessages(id),
      conversations: listConversations(),
      settings: getChatSettings(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update chat';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const id = request.nextUrl.searchParams.get('id')?.trim();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const result = deleteConversation(id);
    if (!result.deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const settings = getChatSettings();
    const current = conversationPayload(settings.currentConversationId);
    return NextResponse.json({
      conversations: listConversations(),
      current,
      settings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete chat';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
