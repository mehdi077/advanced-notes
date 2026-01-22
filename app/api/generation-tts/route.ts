import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';

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

    const audio = groq.audio as unknown as GroqAudioSpeech;
    const speechResponse = await audio.speech.create({
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
  } catch (error: unknown) {
    const message =
      (typeof (error as { message?: unknown })?.message === 'string' && (error as { message: string }).message) ||
      'Failed to generate audio';
    const status =
      (typeof (error as { response?: { status?: unknown } })?.response?.status === 'number' &&
        (error as { response: { status: number } }).response.status) ||
      500;
    return NextResponse.json({ error: message }, { status });
  }
}
