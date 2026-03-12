import { NextRequest, NextResponse } from 'next/server';
import {
  getEditorCompletionAudio,
  getEditorUseRagContext,
  setEditorCompletionAudio,
  setEditorUseRagContext,
} from '@/lib/editor-settings';
import { requireUnlocked } from '@/lib/unlock-server';

export async function GET(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    return NextResponse.json({
      useRagContext: getEditorUseRagContext(),
      completionAudio: getEditorCompletionAudio(),
    });
  } catch (error) {
    console.error('Editor settings GET error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    let changed = false;
    let useRagContext = getEditorUseRagContext();
    let completionAudio = getEditorCompletionAudio();

    if (typeof body.useRagContext === 'boolean') {
      useRagContext = setEditorUseRagContext(body.useRagContext);
      changed = true;
    }

    if (typeof body.completionAudio === 'boolean') {
      completionAudio = setEditorCompletionAudio(body.completionAudio);
      changed = true;
    }

    if (!changed) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    return NextResponse.json({ useRagContext, completionAudio });
  } catch (error) {
    console.error('Editor settings POST error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
