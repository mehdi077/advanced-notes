import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY is not configured' },
        { status: 500 }
      );
    }

    const { text } = await req.json();

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const speechResponse = await (groq.audio as any).speech.create({
      model: 'canopylabs/orpheus-v1-english',
      voice: 'daniel',
      input: text.trim(),
      response_format: 'wav',
    });

    const audioBuffer = await speechResponse.arrayBuffer();

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return NextResponse.json(
        { error: 'Generated audio is empty' },
        { status: 500 }
      );
    }

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.byteLength.toString(),
      },
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to generate audio';
    const status = error?.response?.status || 500;
    return NextResponse.json({ error: message }, { status });
  }
}
