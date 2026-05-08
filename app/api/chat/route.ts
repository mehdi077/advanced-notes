import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getRagTopK } from '@/lib/rag-settings';
import { requireUnlocked } from '@/lib/unlock-server';
import {
  appendMessage,
  getChatSettings,
  getConversation,
  listMessages,
  recordOpenRouterUsage,
  updateConversationRuntime,
} from '@/lib/chat-store';
import { getStoredModel } from '@/lib/model-store';

const DEFAULT_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';

type IncomingAttachment = {
  kind: 'upload' | 'screenshot';
  mimeType: string;
  dataUrl: string;
  fileName?: string | null;
};

type OpenRouterMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant';
  content: OpenRouterMessageContent;
};

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
    const topK = getRagTopK();
    const relevant = similarities.slice(0, topK).filter((c) => c.score > 0.3);
    return relevant.map((c) => c.text).join('\n\n');
  } catch (error) {
    console.error('RAG error:', error);
    return '';
  }
}

export async function POST(request: NextRequest) {
  const locked = requireUnlocked(request);
  if (locked) return locked;

  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json(
        { error: 'OPENROUTER_API_KEY environment variable is not set. Create a .env.local file with your API key.' },
        { status: 500 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const conversationIdRaw = body.conversationId;
    const modelIdRaw = body.modelId;
    const embeddingModelIdRaw = body.embeddingModelId;
    const messageRaw = body.message;
    const settings = getChatSettings();

    const conversationId =
      typeof conversationIdRaw === 'string' && conversationIdRaw.trim()
        ? conversationIdRaw.trim()
        : settings.currentConversationId;
    const conversation = getConversation(conversationId);
    if (!conversation) {
      return NextResponse.json({ error: 'Unknown conversation id' }, { status: 404 });
    }

    const attachmentsRaw = Array.isArray(body.attachments) ? body.attachments : [];
    const attachments: IncomingAttachment[] = attachmentsRaw
      .map((a): IncomingAttachment | null => {
        if (!a || typeof a !== 'object') return null;
        const obj = a as Record<string, unknown>;
        const kind = obj.kind === 'screenshot' ? 'screenshot' : obj.kind === 'upload' ? 'upload' : null;
        const mimeType = typeof obj.mimeType === 'string' ? obj.mimeType : '';
        const dataUrl = typeof obj.dataUrl === 'string' ? obj.dataUrl : '';
        const fileName = typeof obj.fileName === 'string' ? obj.fileName : null;
        if (!kind || !mimeType.startsWith('image/') || !dataUrl.startsWith('data:image/')) return null;
        return { kind, mimeType, dataUrl, fileName };
      })
      .filter((a): a is IncomingAttachment => Boolean(a));

    const userMessageText = typeof messageRaw === 'string' ? messageRaw.trim() : '';
    if (!userMessageText && attachments.length === 0) {
      return NextResponse.json({ error: 'message or image is required' }, { status: 400 });
    }

    const selectedModelId =
      typeof modelIdRaw === 'string' && modelIdRaw.trim() ? modelIdRaw.trim() : conversation.modelId;
    const selectedModel = getStoredModel(selectedModelId);
    if (attachments.length > 0 && !selectedModel?.supportsVision) {
      return NextResponse.json({ error: 'Selected model does not support image input' }, { status: 400 });
    }

    const embeddingModelId =
      typeof embeddingModelIdRaw === 'string' && embeddingModelIdRaw.trim()
        ? embeddingModelIdRaw.trim()
        : DEFAULT_EMBEDDING_MODEL;

    const useRagContext = body.useRagContext === true;
    const systemPrompt =
      typeof body.systemPrompt === 'string'
        ? body.systemPrompt
        : conversation.systemPrompt || settings.systemPrompt;
    const ragContext = useRagContext ? await getRAGContext(userMessageText, embeddingModelId) : '';

    let systemPromptContent = systemPrompt || 'You are a helpful and truthful assistant. Be concise and correct.';
    if (ragContext) {
      systemPromptContent +=
        '\n\nHere is relevant context from the document:\n\n' +
        '---RELEVANT CONTEXT---\n' +
        ragContext +
        '\n---END CONTEXT---\n\n' +
        'Prefer using the context above when it is relevant.';
    }

    const messages: OpenRouterMessage[] = [{ role: 'system', content: systemPromptContent }];
    const persistedBefore = listMessages(conversationId);
    for (const m of persistedBefore) {
      if (m.role === 'user' && m.attachments?.length) {
        messages.push({
          role: 'user',
          content: [
            ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
            ...m.attachments.map((a) => ({
              type: 'image_url' as const,
              image_url: { url: a.dataUrl },
            })),
          ],
        });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }

    const outgoingUserContent: OpenRouterMessageContent = attachments.length
      ? [
          ...(userMessageText ? [{ type: 'text' as const, text: userMessageText }] : []),
          ...attachments.map((a) => ({
            type: 'image_url' as const,
            image_url: { url: a.dataUrl },
          })),
        ]
      : userMessageText;
    messages.push({ role: 'user', content: outgoingUserContent });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'Helm Editor',
      },
      body: JSON.stringify({
        model: selectedModelId,
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return NextResponse.json({ error: errorText || 'OpenRouter request failed' }, { status: response.status });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const rawContent = data.choices?.[0]?.message?.content;
    const content = typeof rawContent === 'string' ? rawContent : '';
    const userMessage = appendMessage({
      conversationId,
      role: 'user',
      content: userMessageText,
      modelId: selectedModelId,
      attachments,
    });
    const assistantMessage = appendMessage({
      conversationId,
      role: 'assistant',
      content,
      ragContext: ragContext || null,
      modelId: selectedModelId,
    });
    recordOpenRouterUsage({
      conversationId,
      messageId: assistantMessage.id,
      modelId: selectedModelId,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      imageCount: attachments.length,
      promptPricePerMillion: selectedModel?.pricing?.prompt,
      completionPricePerMillion: selectedModel?.pricing?.completion,
      imagePrice: selectedModel?.pricing?.image,
    });
    const updatedConversation = updateConversationRuntime(conversationId, {
      modelId: selectedModelId,
      systemPrompt,
      useRagContext,
    });

    return NextResponse.json({
      userMessage,
      message: assistantMessage,
      conversation: updatedConversation,
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
