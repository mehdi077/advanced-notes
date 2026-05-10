import { NextRequest, NextResponse } from 'next/server';
import {
  archiveMentalNote,
  createMentalNote,
  deleteMentalNote,
  getMentalNotesConfig,
  getNextMentalNote,
  listMentalNotes,
  rememberMentalNote,
  setMentalNotesConfig,
  snoozeMentalNote,
  updateMentalNote,
  type MentalNoteSource,
} from '@/lib/mental-notes';
import { requireUnlocked } from '@/lib/unlock-server';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const action = request.nextUrl.searchParams.get('action') || '';
    if (action === 'config') {
      return NextResponse.json({ config: getMentalNotesConfig() });
    }
    if (action === 'next') {
      const force = request.nextUrl.searchParams.get('force') === '1';
      const remindersOnly = request.nextUrl.searchParams.get('remindersOnly') === '1';
      const peek = request.nextUrl.searchParams.get('peek') === '1';
      return NextResponse.json({ note: getNextMentalNote({ force, remindersOnly, peek }), config: getMentalNotesConfig() });
    }

    const filter = request.nextUrl.searchParams.get('filter') || 'active';
    const sort = request.nextUrl.searchParams.get('sort') || 'queue';
    return NextResponse.json({
      notes: listMentalNotes({ filter, sort }),
      config: getMentalNotesConfig(),
    });
  } catch (error) {
    console.error('Mental notes GET error:', error);
    return jsonError('Internal Server Error', 500);
  }
}

export async function POST(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : 'create';

    if (action === 'config') {
      return NextResponse.json({ config: setMentalNotesConfig(body.config && typeof body.config === 'object' ? body.config : {}) });
    }

    if (action === 'snooze') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) return jsonError('Missing note id');
      return NextResponse.json({ note: snoozeMentalNote(id) });
    }

    if (action === 'remember') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) return jsonError('Missing note id');
      return NextResponse.json({ note: rememberMentalNote(id) });
    }

    if (action === 'archive' || action === 'restore') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) return jsonError('Missing note id');
      return NextResponse.json({ note: archiveMentalNote(id, action === 'archive') });
    }

    const text = typeof body.text === 'string' ? body.text : '';
    const source: MentalNoteSource = body.source === 'selection' ? 'selection' : 'manual';
    if (!text.trim()) return jsonError('Note text is required');
    return NextResponse.json({ note: createMentalNote(text, source), notes: listMentalNotes() });
  } catch (error) {
    console.error('Mental notes POST error:', error);
    return jsonError(error instanceof Error ? error.message : 'Internal Server Error', 500);
  }
}

export async function PATCH(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return jsonError('Missing note id');

    const customCooldownMs =
      body.customCooldownMs === null
        ? null
        : typeof body.customCooldownMs === 'number' && Number.isFinite(body.customCooldownMs)
          ? Math.max(0, Math.round(body.customCooldownMs))
          : undefined;

    const note = updateMentalNote(id, {
      text: typeof body.text === 'string' ? body.text : undefined,
      reminderAt: body.reminderAt === null || typeof body.reminderAt === 'string' ? body.reminderAt : undefined,
      customCooldownMs,
    });
    if (!note) return jsonError('Note not found', 404);
    return NextResponse.json({ note });
  } catch (error) {
    console.error('Mental notes PATCH error:', error);
    return jsonError(error instanceof Error ? error.message : 'Internal Server Error', 500);
  }
}

export async function DELETE(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    const id = request.nextUrl.searchParams.get('id') || '';
    if (!id) return jsonError('Missing note id');
    deleteMentalNote(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Mental notes DELETE error:', error);
    return jsonError('Internal Server Error', 500);
  }
}
