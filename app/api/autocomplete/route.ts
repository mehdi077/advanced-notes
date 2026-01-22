import { NextRequest, NextResponse } from 'next/server';
import { getOpenRouterModel, DEFAULT_MODEL, ModelId } from '@/lib/model-config';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import db from '@/lib/db';

const EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';
const TOP_K = 3;

async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) return [];
  const data = await response.json();
  return data.data?.[0]?.embedding || [];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getRAGContext(query: string): Promise<string> {
  try {
    const queryEmbedding = await getEmbedding(query);
    if (queryEmbedding.length === 0) return '';

    const rows = db.prepare('SELECT chunk_text, embedding FROM embeddings').all() as { 
      chunk_text: string; embedding: Buffer;
    }[];
    if (rows.length === 0) return '';

    const similarities = rows.map(row => {
      const embedding = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4));
      return { text: row.chunk_text, score: cosineSimilarity(queryEmbedding, embedding) };
    });

    similarities.sort((a, b) => b.score - a.score);
    const relevant = similarities.slice(0, TOP_K).filter(c => c.score > 0.3);
    return relevant.map(c => c.text).join('\n\n');
  } catch (error) {
    console.error('RAG error:', error);
    return '';
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json(
        { error: 'OPENROUTER_API_KEY environment variable is not set. Create a .env.local file with your API key.' },
        { status: 500 }
      );
    }

    const { text, modelId, prompt } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    const model = getOpenRouterModel((modelId as ModelId) || DEFAULT_MODEL);

    // Get RAG context
    const ragContext = await getRAGContext(text);

    let systemPromptContent = 'You are a writing assistant. Your task is to continue the user\'s text naturally. ' +
      'Respond with ONLY the completion text, nothing else. ' +
      'Do not include any explanations, quotes, or the original text.';

    if (ragContext) {
      systemPromptContent += '\n\nHere is some relevant context from the document that may help you write a more coherent continuation:\n\n' +
        '---RELEVANT CONTEXT---\n' + ragContext + '\n---END CONTEXT---\n\n' +
        'Use this context to ensure your continuation is consistent with the themes and information already established in the document.';
    }

    const systemPrompt = new SystemMessage(systemPromptContent);

    const userPromptText = prompt || 'Provide a two sentence long completion to this text:';
    const userPrompt = new HumanMessage(`${userPromptText} ${text}`);

    const messages = [systemPrompt, userPrompt];

    console.log('\n========== API CALL ==========');
    console.log('Model:', modelId || DEFAULT_MODEL);
    console.log('==============================\n');
    console.log('Client text (used as query + generation seed):', text);
    console.log('Prompt (custom/user):', userPromptText);
    console.log('RAG context included:', ragContext ? 'YES' : 'NO');
    if (ragContext) {
      console.log('---RAG CONTEXT START---\n' + ragContext + '\n---RAG CONTEXT END---');
    }
    console.log('==============================\n');
    console.log('---SYSTEM PROMPT START---\n' + systemPromptContent + '\n---SYSTEM PROMPT END---');
    console.log('==============================\n');
    console.log('---USER MESSAGE START---\n' + `${userPromptText} ${text}` + '\n---USER MESSAGE END---');
    console.log('==============================\n');

    const response = await model.invoke(messages);

    const completion = typeof response.content === 'string' 
      ? response.content 
      : '';

    // Extract token usage from response metadata
    const metadata = response.response_metadata as Record<string, unknown> | undefined;
    const usageMetadata = response.usage_metadata as Record<string, unknown> | undefined;
    const usage = (metadata?.usage || usageMetadata || {}) as Record<string, number>;
    const promptTokens = usage.prompt_tokens || usage.input_tokens || 0;
    const completionTokens = usage.completion_tokens || usage.output_tokens || 0;

    return NextResponse.json({ 
      completion,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      }
    });
  } catch (error) {
    console.error('Autocomplete error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate completion';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
