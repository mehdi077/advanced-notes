import { NextResponse } from 'next/server';
import audiobookDb from '@/lib/audiobook-db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  }

  try {
    const row = audiobookDb
      .prepare('SELECT content FROM documents WHERE id = ?')
      .get(id) as { content: string } | undefined;

    if (row) return NextResponse.json(JSON.parse(row.content));
    return NextResponse.json(null);
  } catch (error) {
    console.error('Audiobook DB error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, content } = body as { id?: unknown; content?: unknown };

    if (typeof id !== 'string' || !id.trim() || content === undefined) {
      return NextResponse.json({ error: 'Missing id or content' }, { status: 400 });
    }

    audiobookDb
      .prepare(
        `
        INSERT INTO documents (id, content, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content,
          updated_at = excluded.updated_at
      `
      )
      .run(id, JSON.stringify(content), new Date().toISOString());

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Audiobook DB error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
