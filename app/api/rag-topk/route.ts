import { NextRequest, NextResponse } from 'next/server';
import { getRagTopK, setRagTopK, ragTopKDefaults } from '@/lib/rag-settings';
import { requireUnlocked } from '@/lib/unlock-server';

export async function GET(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    return NextResponse.json({
      topK: getRagTopK(),
      defaultTopK: ragTopKDefaults.defaultValue,
      min: ragTopKDefaults.min,
      max: ragTopKDefaults.max,
    });
  } catch (error) {
    console.error('RAG topK GET error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const topKRaw = body.topK;
    const topKNum = typeof topKRaw === 'number' ? topKRaw : typeof topKRaw === 'string' ? Number.parseInt(topKRaw, 10) : NaN;
    if (!Number.isFinite(topKNum)) {
      return NextResponse.json({ error: 'topK must be a number' }, { status: 400 });
    }

    const topK = setRagTopK(topKNum);
    return NextResponse.json({ topK });
  } catch (error) {
    console.error('RAG topK POST error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
