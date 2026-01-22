import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import crypto from 'crypto';

const DEFAULT_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';
const CHUNK_SIZE = 500; // characters per chunk

const FALLBACK_DOC_IDS = ['infinite-doc-v1', 'main'];

function getDocumentContent(docId?: string | null): string {
  const tryGetById = (id: string) => {
    const row = db.prepare('SELECT content FROM documents WHERE id = ?').get(id) as { content: string } | undefined;
    return row?.content || '';
  };

  if (docId) {
    const byId = tryGetById(docId);
    if (byId) return byId;
  }

  for (const id of FALLBACK_DOC_IDS) {
    const byFallback = tryGetById(id);
    if (byFallback) return byFallback;
  }

  const latest = db.prepare('SELECT content FROM documents ORDER BY updated_at DESC LIMIT 1').get() as { content: string } | undefined;
  return latest?.content || '';
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > CHUNK_SIZE && currentChunk) {
      chunks.push(currentChunk.trim());
      // Keep overlap
      const words = currentChunk.split(' ');
      const overlapWords = words.slice(-Math.floor(words.length * 0.2));
      currentChunk = overlapWords.join(' ') + ' ' + sentence;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  return chunks.filter(c => c.length > 20); // Filter out very small chunks
}

function extractPlainTextFromDocumentContent(content: string): string {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content);
    const extractText = (node: unknown): string => {
      if (typeof node === 'string') return node;
      if (!node || typeof node !== 'object') return '';

      const maybeText = (node as { text?: unknown }).text;
      if (typeof maybeText === 'string') return maybeText;

      const maybeContent = (node as { content?: unknown }).content;
      if (Array.isArray(maybeContent)) {
        return maybeContent.map(extractText).join(' ');
      }

      return '';
    };
    return extractText(parsed);
  } catch {
    return content;
  }
}

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
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || 'Failed to get embedding');
  }

  const data = await response.json();
  return data.data[0].embedding;
}

function ensureEmbeddingModelRegistered(modelId: string) {
  db.prepare('INSERT OR IGNORE INTO embedding_models (model_id) VALUES (?)').run(modelId);
}

function listEmbeddingModels(): string[] {
  const rows = db.prepare('SELECT model_id FROM embedding_models ORDER BY created_at ASC').all() as Array<{ model_id: string }>;
  const models = rows.map(r => r.model_id).filter(Boolean);
  if (!models.includes(DEFAULT_EMBEDDING_MODEL)) {
    ensureEmbeddingModelRegistered(DEFAULT_EMBEDDING_MODEL);
    return [DEFAULT_EMBEDDING_MODEL, ...models];
  }
  return models;
}

// GET - Get embedding status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const docId = searchParams.get('id');
    const modelIdParam = searchParams.get('modelId');
    const embeddingModelId = (modelIdParam && modelIdParam.trim()) ? modelIdParam.trim() : DEFAULT_EMBEDDING_MODEL;

    ensureEmbeddingModelRegistered(embeddingModelId);
    const content = getDocumentContent(docId);
    const textContent = extractPlainTextFromDocumentContent(content);

    const chunks = chunkText(textContent);
    const totalChunks = chunks.length;
    
    // Get chunk hashes that are already embedded
    const existingHashes = new Set(
      (db.prepare('SELECT chunk_hash FROM embeddings WHERE embedding_model_id = ?').all(embeddingModelId) as { chunk_hash: string }[])
        .map(row => row.chunk_hash)
    );
    
    // Count how many current chunks are embedded
    let embeddedCurrentChunks = 0;
    for (const chunk of chunks) {
      if (existingHashes.has(hashText(chunk))) {
        embeddedCurrentChunks++;
      }
    }

    const percentage = totalChunks > 0 ? Math.round((embeddedCurrentChunks / totalChunks) * 100) : 0;

    const availableEmbeddingModels = listEmbeddingModels();

    // Best-effort state row (kept for debugging / future use)
    db.prepare(
      'INSERT OR REPLACE INTO embedding_state (embedding_model_id, last_content_hash, total_chunks, embedded_chunks, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      embeddingModelId,
      hashText(textContent),
      totalChunks,
      embeddedCurrentChunks,
      new Date().toISOString()
    );

    return NextResponse.json({
      embeddingModelId,
      availableEmbeddingModels,
      totalChunks,
      embeddedChunks: embeddedCurrentChunks,
      percentage,
      needsUpdate: totalChunks > 0 && embeddedCurrentChunks < totalChunks,
    });
  } catch (error) {
    console.error('Embedding status error:', error);
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}

// PUT - Register a new embedding model (no embedding yet)
export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const modelIdRaw = body.modelId;
    if (typeof modelIdRaw !== 'string' || !modelIdRaw.trim()) {
      return NextResponse.json({ error: 'modelId is required' }, { status: 400 });
    }
    const embeddingModelId = modelIdRaw.trim();
    ensureEmbeddingModelRegistered(embeddingModelId);

    // Initialize state row so UI can show 0% immediately
    const { searchParams } = new URL(request.url);
    const docId = searchParams.get('id');
    const content = getDocumentContent(docId);
    const textContent = extractPlainTextFromDocumentContent(content);
    const chunks = chunkText(textContent);
    const totalChunks = chunks.length;

    db.prepare(
      'INSERT OR IGNORE INTO embedding_state (embedding_model_id, last_content_hash, total_chunks, embedded_chunks, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(embeddingModelId, hashText(textContent), totalChunks, 0, new Date().toISOString());

    return NextResponse.json({
      embeddingModelId,
      availableEmbeddingModels: listEmbeddingModels(),
    });
  } catch (error) {
    console.error('Embedding model register error:', error);
    return NextResponse.json({ error: 'Failed to register model' }, { status: 500 });
  }
}

// POST - Embed new chunks
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 });
    }
    const { searchParams } = new URL(request.url);
    const docId = searchParams.get('id');
    const modelIdParam = searchParams.get('modelId');
    const embeddingModelId = (modelIdParam && modelIdParam.trim()) ? modelIdParam.trim() : DEFAULT_EMBEDDING_MODEL;
    ensureEmbeddingModelRegistered(embeddingModelId);
    const content = getDocumentContent(docId);
    const textContent = extractPlainTextFromDocumentContent(content);

    const chunks = chunkText(textContent);
    
    // Get existing chunk hashes
    const existingHashes = new Set(
      (db.prepare('SELECT chunk_hash FROM embeddings WHERE embedding_model_id = ?').all(embeddingModelId) as { chunk_hash: string }[])
        .map(row => row.chunk_hash)
    );

    // Find chunks that need embedding
    const newChunks: { text: string; hash: string }[] = [];
    for (const chunk of chunks) {
      const hash = hashText(chunk);
      if (!existingHashes.has(hash)) {
        newChunks.push({ text: chunk, hash });
      }
    }

    if (newChunks.length === 0) {
      return NextResponse.json({ message: 'All chunks already embedded', embedded: 0 });
    }

    // Embed new chunks
    const insertStmt = db.prepare(
      'INSERT OR IGNORE INTO embeddings (embedding_model_id, chunk_text, chunk_hash, embedding) VALUES (?, ?, ?, ?)'
    );

    let embedded = 0;
    for (const chunk of newChunks) {
      try {
        const embedding = await getEmbedding(chunk.text, embeddingModelId);
        const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);
        insertStmt.run(embeddingModelId, chunk.text, chunk.hash, embeddingBuffer);
        embedded++;
      } catch (error) {
        console.error('Failed to embed chunk:', error);
      }
    }

    const allHashesAfter = new Set(
      (db.prepare('SELECT chunk_hash FROM embeddings WHERE embedding_model_id = ?').all(embeddingModelId) as { chunk_hash: string }[])
        .map(row => row.chunk_hash)
    );
    let embeddedCurrentChunks = 0;
    for (const chunk of chunks) {
      if (allHashesAfter.has(hashText(chunk))) embeddedCurrentChunks++;
    }
    db.prepare(
      'INSERT OR REPLACE INTO embedding_state (embedding_model_id, last_content_hash, total_chunks, embedded_chunks, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(embeddingModelId, hashText(textContent), chunks.length, embeddedCurrentChunks, new Date().toISOString());

    return NextResponse.json({ 
      message: `Embedded ${embedded} new chunks`,
      embedded,
      total: chunks.length 
    });
  } catch (error) {
    console.error('Embedding error:', error);
    return NextResponse.json({ error: 'Failed to embed' }, { status: 500 });
  }
}

// DELETE - Delete embeddings for a model (keeps the model registered)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const modelIdParam = searchParams.get('modelId');
    const embeddingModelId = (modelIdParam && modelIdParam.trim()) ? modelIdParam.trim() : '';
    if (!embeddingModelId) {
      return NextResponse.json({ error: 'modelId is required' }, { status: 400 });
    }

    db.prepare('DELETE FROM embeddings WHERE embedding_model_id = ?').run(embeddingModelId);
    db.prepare(
      'INSERT OR REPLACE INTO embedding_state (embedding_model_id, last_content_hash, total_chunks, embedded_chunks, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(embeddingModelId, null, 0, 0, new Date().toISOString());

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Embedding delete error:', error);
    return NextResponse.json({ error: 'Failed to delete embeddings' }, { status: 500 });
  }
}
