import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { unlink } from 'fs/promises';
import audiobookDb from '@/lib/audiobook-db';

function isSafeId(id: string) {
  return /^[a-zA-Z0-9-]+$/.test(id);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ segmentId: string }> }) {
  try {
    const { segmentId } = await ctx.params;
    if (!segmentId || !isSafeId(segmentId)) {
      return NextResponse.json({ error: 'Invalid segmentId' }, { status: 400 });
    }

    const row = audiobookDb
      .prepare('SELECT file_name FROM audio_segments WHERE id = ?')
      .get(segmentId) as { file_name: string } | undefined;

    if (row?.file_name) {
      const filePath = path.join(process.cwd(), 'data', 'audiobooks', row.file_name);
      try {
        await unlink(filePath);
      } catch (e: unknown) {
        const code = (e as { code?: unknown })?.code;
        if (code !== 'ENOENT') throw e;
      }
    }

    audiobookDb.prepare('DELETE FROM audio_segments WHERE id = ?').run(segmentId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Audiobook segment delete error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
