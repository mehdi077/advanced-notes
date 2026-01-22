import { NextRequest, NextResponse } from 'next/server';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getOpenRouterModel, DEFAULT_MODEL, ModelId } from '@/lib/model-config';
import db from '@/lib/db';

const DEFAULT_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';
const TOP_K = 3;

type ChatRole = 'user' | 'assistant';
interface ChatMessageDTO {
  role: ChatRole;
  content: string;
}

async function getEmbedding(text: string, embeddingModelId: string): Promise<number[]> {
  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    },
    body: JSON.stringify({
      model: embeddingModelId,
      input: text,
    }),
  });

  if (!response.ok) return [];
  const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  return data.data?.[0]?.embedding || [];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getRAGContext(query: string, embeddingModelId: string): Promise<string> {
  try {
    const queryEmbedding = await getEmbedding(query, embeddingModelId);
    if (queryEmbedding.length === 0) return '';

    const rows = db
      .prepare('SELECT chunk_text, embedding FROM embeddings WHERE embedding_model_id = ?')
      .all(embeddingModelId) as {
      chunk_text: string;
      embedding: Buffer;
    }[];
    if (rows.length === 0) return '';

    const similarities = rows.map((row) => {
      const embedding = Array.from(
        new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4)
      );
      return { text: row.chunk_text, score: cosineSimilarity(queryEmbedding, embedding) };
    });

    similarities.sort((a, b) => b.score - a.score);
    const relevant = similarities.slice(0, TOP_K).filter((c) => c.score > 0.3);
    return relevant.map((c) => c.text).join('\n\n');
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

    const body = (await request.json()) as Record<string, unknown>;
    const modelIdRaw = body.modelId;
    const embeddingModelIdRaw = body.embeddingModelId;
    const useRagContext = body.useRagContext !== false;
    const messagesRaw = body.messages;

    if (!Array.isArray(messagesRaw)) {
      return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
    }

    const messages = (messagesRaw as unknown[])
      .map((m): ChatMessageDTO | null => {
        if (!m || typeof m !== 'object') return null;
        const role = (m as { role?: unknown }).role;
        const content = (m as { content?: unknown }).content;
        if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
        return { role, content };
      })
      .filter((m): m is ChatMessageDTO => m !== null && m.content.trim().length > 0);

    if (messages.length === 0) {
      return NextResponse.json({ error: 'At least one message is required' }, { status: 400 });
    }

    const selectedModelId =
      typeof modelIdRaw === 'string' && modelIdRaw.trim() ? modelIdRaw.trim() : DEFAULT_MODEL;
    const model = getOpenRouterModel(selectedModelId as ModelId);

    const embeddingModelId =
      typeof embeddingModelIdRaw === 'string' && embeddingModelIdRaw.trim()
        ? embeddingModelIdRaw.trim()
        : DEFAULT_EMBEDDING_MODEL;

    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const ragContext = useRagContext && lastUserMessage ? await getRAGContext(lastUserMessage, embeddingModelId) : '';

    let systemPromptContent =
      'You are a helpful assistant. Be concise and correct. If the user asks about the document, use the provided context.';
    if (ragContext) {
      systemPromptContent +=
        '\n\nHere is relevant context from the document:\n\n' +
        '---RELEVANT CONTEXT---\n' +
        ragContext +
        '\n---END CONTEXT---\n\n' +
        'Prefer using the context above when it is relevant.';
    }

    const lcMessages: BaseMessage[] = [new SystemMessage(systemPromptContent)];
    for (const m of messages) {
      if (m.role === 'user') lcMessages.push(new HumanMessage(m.content));
      else lcMessages.push(new AIMessage(m.content));
    }

    const response = await model.invoke(lcMessages);
    const content = typeof response.content === 'string' ? response.content : '';

    return NextResponse.json({
      message: { role: 'assistant', content },
      model: selectedModelId,
      useRagContext,
      embeddingModelId,
      ragContext: ragContext || null,
    });
  } catch (error) {
    console.error('Chat error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate response';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
