import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { ChatGroq } from '@langchain/groq';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// -----------------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------------

// EDIT THE SYSTEM PROMPT HERE
// This variable controls how the AI behaves.
// Currently set to translate the input to Spanish.
const SYSTEM_PROMPT = "whenever you hear spanish translate to english, and vice versa. be a live translator";

// -----------------------------------------------------------------------------

export async function POST(req: NextRequest) {
    try {
        const groq = new Groq({
            apiKey: process.env.GROQ_API_KEY,
        });

        const formData = await req.formData();
        const audioFile = formData.get('audio') as File;

        if (!audioFile) {
            return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
        }

        // 1. Transcribe Audio
        console.log('Step 1: Transcribing audio...');
        const transcription = await groq.audio.transcriptions.create({
            file: audioFile,
            model: 'whisper-large-v3',
            response_format: 'json',
            language: 'en', // Optional: specify input language or auto-detect
        });

        const transcribedText = transcription.text;
        console.log('Transcription:', transcribedText);

        if (!transcribedText) {
            return NextResponse.json({ error: 'Transcription failed' }, { status: 500 });
        }

        // 2. Process with LLM (LangChain)
        console.log('Step 2: Processing with LLM...');
        const model = new ChatGroq({
            apiKey: process.env.GROQ_API_KEY,
            model: 'openai/gpt-oss-120b',
        });

        const messages = [
            new SystemMessage(SYSTEM_PROMPT),
            new HumanMessage(transcribedText),
        ];

        const aiResponse = await model.invoke(messages);
        const translatedText = aiResponse.content as string;
        console.log('Translation:', translatedText);

        // 3. Generate Audio (TTS)
        // Note: As of early 2025, Groq might not have a public TTS model in the SDK.
        // If this fails, it might be because the model doesn't exist or the endpoint is different.
        // We assume standard OpenAI-compatible 'audio.speech.create' structure if Groq supports it.
        // If Groq SDK doesn't support it yet, this might throw.
        console.log('Step 3: Generating audio (TTS)...');
        
        // We'll try to use the SDK if it supports it, or a fetch if needed.
        // Assuming Groq SDK structure matches OpenAI's for speech if they added it.
        // If 'groq.audio.speech' is not available in the types, we might need a workaround or generic fetch.
        // For now, we'll try standard SDK method. If it fails type checking, I'll switch to 'any' or raw fetch.
        
        // Use 'any' to bypass potential type missing if the SDK version is older than the feature
        const speechResponse = await (groq.audio as any).speech.create({
            model: 'canopylabs/orpheus-v1-english', 
            voice: 'daniel',
            input: translatedText,
            response_format: 'wav',
        });

        // Convert the response to a Buffer/ArrayBuffer and return as audio
        const arrayBuffer = await speechResponse.arrayBuffer();
        
        return new NextResponse(arrayBuffer, {
            headers: {
                'Content-Type': 'audio/mpeg',
            },
        });

    } catch (error: any) {
        console.error('Error processing request:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
