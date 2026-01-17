import { NextResponse } from 'next/server';
import db from '@/lib/db';

const DEFAULT_PROMPT = 'Provide a two sentence long completion to this text:';
const DEFAULT_REGEN_PROMPT_TEMPLATE = `This is the already generated text:
{{ATTEMPTS}}

Now generate a drastically  different path to the completion for the next attempt, very far deferent from the ones that are shown in the attempts above.
{{ORIGINAL_PROMPT}}`;

export async function GET() {
  try {
    const promptRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('customPrompt') as { value: string } | undefined;
    const regenRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('regenPromptTemplate') as { value: string } | undefined;

    return NextResponse.json({
      customPrompt: promptRow?.value ?? DEFAULT_PROMPT,
      regenPromptTemplate: regenRow?.value ?? DEFAULT_REGEN_PROMPT_TEMPLATE,
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { customPrompt, regenPromptTemplate } = body;

    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at) 
      VALUES (?, ?, ?) 
      ON CONFLICT(key) DO UPDATE SET 
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    const now = new Date().toISOString();

    if (customPrompt !== undefined) {
      stmt.run('customPrompt', customPrompt, now);
    }

    if (regenPromptTemplate !== undefined) {
      stmt.run('regenPromptTemplate', regenPromptTemplate, now);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
