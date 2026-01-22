declare module '@langchain/openai' {
  export class ChatOpenAI {
    constructor(fields: Record<string, unknown>);
    invoke(messages: unknown): Promise<{
      content: unknown;
      response_metadata?: unknown;
      usage_metadata?: unknown;
    }>;
  }
}
