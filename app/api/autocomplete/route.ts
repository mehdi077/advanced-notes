import { NextRequest, NextResponse } from 'next/server';
import { getOpenRouterModel, DEFAULT_MODEL, ModelId } from '@/lib/model-config';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

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

    const systemPrompt = new SystemMessage(
      'You are a writing assistant. Your task is to continue the user\'s text naturally. ' +
      'Respond with ONLY the completion text, nothing else. ' +
      'Do not include any explanations, quotes, or the original text.'
    );

    const userPromptText = prompt || 'Provide a two sentence long completion to this text:';
    const userPrompt = new HumanMessage(`${userPromptText} ${text}`);

    console.log('\n========== API CALL ==========');
    console.log('Model:', modelId || DEFAULT_MODEL);
    console.log('==============================\n');
    console.log('Prompt:', userPromptText);
    console.log('==============================\n');
    console.log('Full message:', `${userPromptText} ${text}`);
    console.log('==============================\n');

    const response = await model.invoke([systemPrompt, userPrompt]);

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
