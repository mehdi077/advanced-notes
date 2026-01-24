import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import path from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import audiobookDb from '@/lib/audiobook-db';

type GroqTtsResponse = {
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type GroqAudioSpeech = {
  speech: {
    create: (args: {
      model: string;
      voice: string;
      input: string;
      response_format: 'wav';
    }) => Promise<GroqTtsResponse>;
  };
};

const DEFAULT_TTS_MODEL = 'canopylabs/orpheus-v1-english';
const DEFAULT_TTS_VOICE = 'daniel';

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({ error: 'GROQ_API_KEY is not configured' }, { status: 500 });
    }

    const body = (await req.json()) as {
      docId?: unknown;
      text?: unknown;
      model?: unknown;
      voice?: unknown;
    };

    const docId = typeof body.docId === 'string' ? body.docId.trim() : '';
    const text = typeof body.text === 'string' ? body.text : '';
    const model = typeof body.model === 'string' ? body.model.trim() : DEFAULT_TTS_MODEL;
    const voice = typeof body.voice === 'string' ? body.voice.trim() : DEFAULT_TTS_VOICE;

    if (!docId) {
      return NextResponse.json({ error: 'docId is required' }, { status: 400 });
    }

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const segmentId = randomUUID();

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const audio = groq.audio as unknown as GroqAudioSpeech;
    const speechResponse = await audio.speech.create({
      model,
      voice,
      input: text.trim(),
      response_format: 'wav',
    });

    const audioBuffer = await speechResponse.arrayBuffer();
    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'Generated audio is empty' }, { status: 500 });
    }

    const dir = path.join(process.cwd(), 'data', 'audiobooks');
    await mkdir(dir, { recursive: true });

    const fileName = `${segmentId}.wav`;
    const filePath = path.join(dir, fileName);
    await writeFile(filePath, Buffer.from(audioBuffer));

    audiobookDb
      .prepare(
        `
        INSERT INTO audio_segments (id, doc_id, text, file_name, mime_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(segmentId, docId, text, fileName, 'audio/wav', new Date().toISOString());

    return NextResponse.json({
      segmentId,
      audioUrl: `/api/audiobooks/audio/${segmentId}`,
    });
  } catch (error: unknown) {
    const message =
      (typeof (error as { message?: unknown })?.message === 'string' && (error as { message: string }).message) ||
      'Failed to generate audio';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
