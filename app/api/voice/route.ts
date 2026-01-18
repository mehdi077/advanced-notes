import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { ChatGroq } from '@langchain/groq';
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';

// System prompt for the voice assistant
const SYSTEM_PROMPT = `You are a helpful voice assistant. Provide clear, concise responses suitable for spoken conversation. Keep responses brief and natural.`;

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    
    try {
        // Debug: Log all environment variables starting with GROQ
        console.log('🔍 Environment check:', {
            hasGroqKey: !!process.env.GROQ_API_KEY,
            nodeEnv: process.env.NODE_ENV,
            allEnvKeys: Object.keys(process.env).filter(k => k.includes('GROQ') || k.includes('API'))
        });
        
        // Validate API key
        const apiKey = process.env.GROQ_API_KEY;
        
        if (!apiKey) {
            console.error('❌ GROQ_API_KEY is not set in environment variables');
            console.error('Available env keys:', Object.keys(process.env).join(', '));
            return NextResponse.json({ 
                error: 'API configuration error: GROQ_API_KEY is missing',
                debug: {
                    nodeEnv: process.env.NODE_ENV,
                    hasNextRuntime: !!process.env.NEXT_RUNTIME
                }
            }, { status: 500 });
        }

        console.log('✅ API Key found:', apiKey.substring(0, 10) + '...');

        const groq = new Groq({
            apiKey: apiKey,
        });

        // Parse form data
        const formData = await req.formData();
        const audioFile = formData.get('audio') as File;
        const conversationHistoryJson = formData.get('conversationHistory') as string;

        if (!audioFile) {
            console.error('❌ No audio file provided');
            return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
        }

        console.log(`📁 Received audio file: ${audioFile.name} (${audioFile.size} bytes)`);

        // Parse conversation history
        let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        if (conversationHistoryJson) {
            try {
                conversationHistory = JSON.parse(conversationHistoryJson);
                console.log(`💬 Conversation history: ${conversationHistory.length} messages`);
            } catch (e) {
                console.warn('⚠️ Failed to parse conversation history:', e);
            }
        }

        // 1. Transcribe Audio with Whisper
        console.log('🎤 Step 1: Transcribing audio...');
        const transcriptionStart = Date.now();
        
        let transcription;
        try {
            transcription = await groq.audio.transcriptions.create({
                file: audioFile,
                model: 'whisper-large-v3-turbo',
                language: 'en',
                response_format: 'json',
                temperature: 0.0,
            });
        } catch (error: any) {
            console.error('❌ Transcription error:', error);
            return NextResponse.json({ 
                error: 'Failed to transcribe audio: ' + (error.message || 'Unknown error') 
            }, { status: 500 });
        }

        const transcribedText = transcription.text?.trim();
        console.log(`✅ Transcription (${Date.now() - transcriptionStart}ms):`, transcribedText);

        if (!transcribedText) {
            return NextResponse.json({ error: 'No speech detected in audio' }, { status: 400 });
        }

        // 2. Process with LLM
        console.log('🤖 Step 2: Processing with LLM...');
        const llmStart = Date.now();
        
        let responseText: string;
        try {
            const model = new ChatGroq({
                apiKey: process.env.GROQ_API_KEY,
                model: 'llama-3.3-70b-versatile',
                temperature: 0.7,
                maxTokens: 150,
            });

            // Build message history
            const messages: BaseMessage[] = [
                new SystemMessage(SYSTEM_PROMPT),
            ];

            // Add conversation history (limit to last 10 messages for context)
            const recentHistory = conversationHistory.slice(-10);
            for (const msg of recentHistory) {
                if (msg.role === 'user') {
                    messages.push(new HumanMessage(msg.content));
                } else {
                    messages.push(new AIMessage(msg.content));
                }
            }

            // Add current user message
            messages.push(new HumanMessage(transcribedText));

            const aiResponse = await model.invoke(messages);
            responseText = (aiResponse.content as string).trim();
            
            console.log(`✅ LLM Response (${Date.now() - llmStart}ms):`, responseText);
        } catch (error: any) {
            console.error('❌ LLM error:', error);
            return NextResponse.json({ 
                error: 'Failed to generate response: ' + (error.message || 'Unknown error') 
            }, { status: 500 });
        }

        if (!responseText) {
            return NextResponse.json({ error: 'No response generated' }, { status: 500 });
        }

        // 3. Generate Speech (TTS)
        console.log('🔊 Step 3: Generating speech...');
        const ttsStart = Date.now();
        
        let audioArrayBuffer: ArrayBuffer;
        let audioFormat = 'mp3'; // Use MP3 for better browser compatibility
        
        try {
            const speechResponse = await (groq.audio as any).speech.create({
                model: 'canopylabs/orpheus-v1-english', 
                voice: 'daniel',
                input: responseText,
                response_format: audioFormat,
            });

            audioArrayBuffer = await speechResponse.arrayBuffer();
            console.log(`✅ TTS complete (${Date.now() - ttsStart}ms): ${audioArrayBuffer.byteLength} bytes, format: ${audioFormat}`);
            
            // Validate audio data
            if (!audioArrayBuffer || audioArrayBuffer.byteLength === 0) {
                throw new Error('Generated audio is empty');
            }
            
            // Validate MP3 header (should start with 0xFF 0xFB or ID3)
            const headerView = new Uint8Array(audioArrayBuffer.slice(0, 3));
            const hasMP3Header = (headerView[0] === 0xFF && (headerView[1] & 0xE0) === 0xE0);
            const hasID3Header = (String.fromCharCode(...headerView) === 'ID3');
            
            if (!hasMP3Header && !hasID3Header) {
                console.warn('⚠️ Audio may not be valid MP3 format');
            } else {
                console.log('✅ Valid MP3 header detected');
            }
        } catch (error: any) {
            console.error('❌ TTS error:', error);
            return NextResponse.json({ 
                error: 'Failed to generate speech: ' + (error.message || 'Unknown error') 
            }, { status: 500 });
        }

        console.log(`⚡ Total processing time: ${Date.now() - startTime}ms`);

        // Return audio with metadata in headers
        return new NextResponse(audioArrayBuffer, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioArrayBuffer.byteLength.toString(),
                'X-Transcription': encodeURIComponent(transcribedText),
                'X-Response-Text': encodeURIComponent(responseText),
            },
        });

    } catch (error: any) {
        console.error('❌ Voice API error:', error);
        return NextResponse.json({ 
            error: error.message || 'Internal server error' 
        }, { status: 500 });
    }
}
