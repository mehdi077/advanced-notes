import { NextRequest, NextResponse } from 'next/server';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getOpenRouterModel, DEFAULT_MODEL, ModelId } from '@/lib/model-config';
import { requireUnlocked } from '@/lib/unlock-server';

interface FocusRule {
  color: string;
  meaning: string;
}

const DEFAULT_FOCUS_PROMPT = 'If I had to change the color of one or more words in this text so later I just see that colored word and I know what phrase is about, what should I color?';

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function parseRules(value: unknown): FocusRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      const color = obj.color;
      const meaning = obj.meaning;
      if (!isHexColor(color) || typeof meaning !== 'string' || !meaning.trim()) return null;
      return { color: color.toLowerCase(), meaning: meaning.trim() };
    })
    .filter((item): item is FocusRule => item !== null);
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model did not return JSON');
    return JSON.parse(match[0]);
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
    const text = body.text;
    if (typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const selectedModelId = typeof body.modelId === 'string' && body.modelId.trim()
      ? body.modelId.trim()
      : DEFAULT_MODEL;
    const prompt = typeof body.prompt === 'string' && body.prompt.trim()
      ? body.prompt.trim()
      : DEFAULT_FOCUS_PROMPT;
    const rules = parseRules(body.colorRules);

    if (rules.length === 0) {
      return NextResponse.json({ error: 'At least one color rule is required' }, { status: 400 });
    }

    const allowedColors = rules.map(rule => rule.color);
    const systemPromptContent = [
      'You are a text focus colorist.',
      'Your job is to identify the smallest useful exact words or multi-word phrases in the user text that should have their text color changed for later scanning.',
      'Return ONLY valid JSON. Do not return markdown, comments, explanations, or the original full text.',
      'Each highlight.text must be an exact substring copied from the supplied text, preserving spelling, casing, punctuation, and spacing.',
      'A highlight may contain multiple words when the phrase works as one scannable unit.',
      'Choose colors only from the supplied color rules.',
      'Prefer a small number of high-signal highlights over coloring too much text.',
      'JSON shape: {"highlights":[{"text":"exact word or phrase","color":"#facc15"}]}',
      `Allowed color rules:\n${rules.map(rule => `- ${rule.color}: ${rule.meaning}`).join('\n')}`,
    ].join('\n');

    const userMessage = `${prompt}\n\nText:\n${text}`;
    const messages = [
      new SystemMessage(systemPromptContent),
      new HumanMessage(userMessage),
    ];

    const model = getOpenRouterModel(selectedModelId as ModelId);
    const response = await model.invoke(messages);
    const raw = typeof response.content === 'string' ? response.content : '';
    const parsed = extractJson(raw) as Record<string, unknown>;
    const highlightsRaw = Array.isArray(parsed.highlights) ? parsed.highlights : [];
    const highlights = highlightsRaw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const highlightText = typeof obj.text === 'string' ? obj.text.trim() : '';
        const color = typeof obj.color === 'string' ? obj.color.toLowerCase() : '';
        if (!highlightText || !allowedColors.includes(color)) return null;
        if (!text.includes(highlightText)) return null;
        return { text: highlightText, color };
      })
      .filter((item): item is { text: string; color: string } => item !== null);

    const metadata = response.response_metadata as Record<string, unknown> | undefined;
    const usageMetadata = response.usage_metadata as Record<string, unknown> | undefined;
    const usage = (metadata?.usage || usageMetadata || {}) as Record<string, number>;
    const promptTokens = usage.prompt_tokens || usage.input_tokens || 0;
    const completionTokens = usage.completion_tokens || usage.output_tokens || 0;

    return NextResponse.json({
      highlights,
      raw,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      requestPreview: {
        model: selectedModelId,
        useRagContext: false,
        ragContext: null,
        promptText: prompt,
        inputText: text,
        systemPrompt: systemPromptContent,
        userMessage,
        messages: [
          { role: 'system' as const, content: systemPromptContent },
          { role: 'user' as const, content: userMessage },
        ],
      },
    });
  } catch (error) {
    console.error('Focus color error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate focus colors';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
