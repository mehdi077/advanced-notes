import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireUnlocked } from '@/lib/unlock-server';

const DEFAULT_PROMPT = 'Provide a two sentence long completion to this text:';
const DEFAULT_REGEN_PROMPT_TEMPLATE = `This is the already generated text:
{{ATTEMPTS}}

Now generate a drastically  different path to the completion for the next attempt, very far deferent from the ones that are shown in the attempts above.
{{ORIGINAL_PROMPT}}`;
const DEFAULT_FOCUS_PROMPT = 'If I had to change the color of one or more words in this text so later I just see that colored word and I know what phrase is about, what should I color?';
const DEFAULT_FOCUS_COLOR_RULES = JSON.stringify({
  '#facc15': 'the What',
  '#4ade80': 'the where',
});

export async function GET(request: Request) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const promptRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('customPrompt') as { value: string } | undefined;
    const regenRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('regenPromptTemplate') as { value: string } | undefined;
    const focusPromptRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('focusPrompt') as { value: string } | undefined;
    const focusColorRulesRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('focusColorRules') as { value: string } | undefined;

    return NextResponse.json({
      customPrompt: promptRow?.value ?? DEFAULT_PROMPT,
      regenPromptTemplate: regenRow?.value ?? DEFAULT_REGEN_PROMPT_TEMPLATE,
      focusPrompt: focusPromptRow?.value ?? DEFAULT_FOCUS_PROMPT,
      focusColorRules: focusColorRulesRow?.value ?? DEFAULT_FOCUS_COLOR_RULES,
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const body = await request.json();
    const { customPrompt, regenPromptTemplate, focusPrompt, focusColorRules } = body;

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

    if (focusPrompt !== undefined) {
      stmt.run('focusPrompt', focusPrompt, now);
    }

    if (focusColorRules !== undefined) {
      stmt.run('focusColorRules', focusColorRules, now);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
