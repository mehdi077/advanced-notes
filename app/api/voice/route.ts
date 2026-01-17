import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { ChatGroq } from '@langchain/groq';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';

// System prompt for the voice assistant
const SYSTEM_PROMPT = "You are a helpful AI assistant engaged in a conversation with the user. Provide concise, natural responses suitable for voice interaction. Keep your responses brief and to the point.";

export async function POST(req: NextRequest) {
    try {
        const groq = new Groq({
            apiKey: process.env.GROQ_API_KEY,
        });

        const formData = await req.formData();
        const audioFile = formData.get('audio') as File;
        const conversationHistoryJson = formData.get('conversationHistory') as string;

        if (!audioFile) {
            return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
        }

        // Parse conversation history
        let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        if (conversationHistoryJson) {
            try {
                conversationHistory = JSON.parse(conversationHistoryJson);
            } catch (e) {
                console.warn('Failed to parse conversation history:', e);
            }
        }

        // 1. Transcribe Audio
        console.log('Step 1: Transcribing audio...');
        const transcription = await groq.audio.transcriptions.create({
            file: audioFile,
            model: 'whisper-large-v3',
            response_format: 'json',
        });

        const transcribedText = transcription.text;
        console.log('Transcription:', transcribedText);

        if (!transcribedText) {
            return NextResponse.json({ error: 'Transcription failed' }, { status: 500 });
        }

        // 2. Process with LLM using LangChain in CHAT mode
        console.log('Step 2: Processing with LLM in chat mode...');
        const model = new ChatGroq({
            apiKey: process.env.GROQ_API_KEY,
            model: 'llama-3.3-70b-versatile',
            temperature: 0.7,
        });

        // Build message history for LangChain
        const messages = [
            new SystemMessage(SYSTEM_PROMPT),
        ];

        // Add conversation history
        for (const msg of conversationHistory) {
            if (msg.role === 'user') {
                messages.push(new HumanMessage(msg.content));
            } else {
                messages.push(new AIMessage(msg.content));
            }
        }

        // Add current user message
        messages.push(new HumanMessage(transcribedText));

        const aiResponse = await model.invoke(messages);
        const responseText = aiResponse.content as string;
        console.log('AI Response:', responseText);

        // 3. Generate Audio (TTS)
        console.log('Step 3: Generating audio (TTS)...');
        
        const speechResponse = await (groq.audio as any).speech.create({
            model: 'canopylabs/orpheus-v1-english', 
            voice: 'daniel',
            input: responseText,
            response_format: 'wav',
        });

        // Convert the response to a Buffer/ArrayBuffer and return as audio
        const arrayBuffer = await speechResponse.arrayBuffer();
        
        return new NextResponse(arrayBuffer, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'X-Transcription': encodeURIComponent(transcribedText),
                'X-Response-Text': encodeURIComponent(responseText),
            },
        });

    } catch (error: any) {
        console.error('Error processing voice request:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
