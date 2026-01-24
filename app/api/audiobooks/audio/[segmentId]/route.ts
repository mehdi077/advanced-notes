import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readFile } from 'fs/promises';
import audiobookDb from '@/lib/audiobook-db';

function isSafeId(id: string) {
  return /^[a-zA-Z0-9-]+$/.test(id);
}

export async function GET(_req: NextRequest, ctx: { params: { segmentId: string } }) {
  const { segmentId } = ctx.params;
  if (!segmentId || !isSafeId(segmentId)) {
    return NextResponse.json({ error: 'Invalid segmentId' }, { status: 400 });
  }

  const row = audiobookDb
    .prepare('SELECT file_name, mime_type FROM audio_segments WHERE id = ?')
    .get(segmentId) as { file_name: string; mime_type: string } | undefined;

  if (!row?.file_name) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const filePath = path.join(process.cwd(), 'data', 'audiobooks', row.file_name);
    const buf = await readFile(filePath);
    return new NextResponse(buf, {
      headers: {
        'Content-Type': row.mime_type || 'audio/wav',
        'Content-Length': buf.byteLength.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
