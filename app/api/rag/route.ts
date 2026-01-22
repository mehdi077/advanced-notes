import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

const DEFAULT_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';
const TOP_K = 3; // Number of relevant chunks to retrieve

async function getEmbedding(text: string, embeddingModelId: string): Promise<number[]> {
  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    },
    body: JSON.stringify({
      model: embeddingModelId,
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to get embedding');
  }

  const data = await response.json();
  return data.data[0].embedding;
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

// POST - Retrieve relevant context
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const query = body.query;
    const embeddingModelIdRaw = body.embeddingModelId;
    if (!query) {
      return NextResponse.json({ error: 'Query required' }, { status: 400 });
    }

    if (typeof query !== 'string') {
      return NextResponse.json({ error: 'Query required' }, { status: 400 });
    }

    const embeddingModelId =
      typeof embeddingModelIdRaw === 'string' && embeddingModelIdRaw.trim()
        ? embeddingModelIdRaw.trim()
        : DEFAULT_EMBEDDING_MODEL;

    // Get query embedding
    const queryEmbedding = await getEmbedding(query, embeddingModelId);

    // Get all embeddings from database
    const rows = db
      .prepare('SELECT chunk_text, embedding FROM embeddings WHERE embedding_model_id = ?')
      .all(embeddingModelId) as {
      chunk_text: string;
      embedding: Buffer;
    }[];

    if (rows.length === 0) {
      return NextResponse.json({ context: '', chunks: [] });
    }

    // Calculate similarities
    const similarities: { text: string; score: number }[] = rows.map(row => {
      const embedding = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4));
      return {
        text: row.chunk_text,
        score: cosineSimilarity(queryEmbedding, embedding),
      };
    });

    // Sort by similarity and get top K
    similarities.sort((a, b) => b.score - a.score);
    const topChunks = similarities.slice(0, TOP_K);

    // Filter out low similarity chunks
    const relevantChunks = topChunks.filter(c => c.score > 0.3);
    const context = relevantChunks.map(c => c.text).join('\n\n---\n\n');

    return NextResponse.json({
      context,
      chunks: relevantChunks,
      embeddingModelId,
    });
  } catch (error) {
    console.error('RAG retrieval error:', error);
    return NextResponse.json({ error: 'Failed to retrieve context' }, { status: 500 });
  }
}
