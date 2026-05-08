import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { getFallbackModelId, modelExists } from '@/lib/model-store';

export type ChatRole = 'user' | 'assistant';

export type ChatMessageRecord = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  ragContext: string | null;
  modelId: string | null;
  position: number;
  createdAt: string;
  attachments?: ChatAttachmentRecord[];
};

export type ChatAttachmentRecord = {
  id: string;
  messageId: string | null;
  conversationId: string;
  kind: 'upload' | 'screenshot';
  mimeType: string;
  dataUrl: string;
  fileName: string | null;
  createdAt: string;
};

export type ChatConversationRecord = {
  id: string;
  title: string;
  modelId: string;
  systemPrompt: string;
  useRagContext: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ChatSettings = {
  currentConversationId: string;
  selectedModelId: string;
  systemPrompt: string;
  useRagContext: boolean;
};

const KEY_CURRENT_CONVERSATION_ID = 'chat.currentConversationId';
const KEY_SELECTED_MODEL_ID = 'chat.selectedModelId';
const KEY_SYSTEM_PROMPT = 'chat.systemPrompt';
const KEY_USE_RAG_CONTEXT = 'chat.useRagContext';

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful and truthful assistant. Be concise and correct.';

function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setSetting(key: string, value: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
}

function parseBool(raw: string | null | undefined, defaultValue: boolean): boolean {
  if (!raw) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return defaultValue;
}

function rowToConversation(row: {
  id: string;
  title: string;
  model_id: string;
  system_prompt: string;
  use_rag_context: number;
  created_at: string;
  updated_at: string;
}): ChatConversationRecord {
  return {
    id: row.id,
    title: row.title,
    modelId: row.model_id,
    systemPrompt: row.system_prompt,
    useRagContext: Boolean(row.use_rag_context),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: {
  id: string;
  conversation_id: string;
  role: ChatRole;
  content: string;
  rag_context: string | null;
  model_id: string | null;
  position: number;
  created_at: string;
}): ChatMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    ragContext: row.rag_context,
    modelId: row.model_id,
    position: row.position,
    createdAt: row.created_at,
  };
}

function rowToAttachment(row: {
  id: string;
  message_id: string | null;
  conversation_id: string;
  kind: 'upload' | 'screenshot';
  mime_type: string;
  data_url: string;
  file_name: string | null;
  created_at: string;
}): ChatAttachmentRecord {
  return {
    id: row.id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    kind: row.kind,
    mimeType: row.mime_type,
    dataUrl: row.data_url,
    fileName: row.file_name,
    createdAt: row.created_at,
  };
}

export function getChatSelectedModelId(): string {
  const id = getSetting(KEY_SELECTED_MODEL_ID)?.trim();
  if (id && modelExists(id)) return id;
  return getFallbackModelId();
}

export function setChatSelectedModelId(modelId: string): string {
  const id = modelId.trim();
  if (!id || !modelExists(id)) throw new Error('Unknown model id');
  setSetting(KEY_SELECTED_MODEL_ID, id);
  return id;
}

export function getChatSystemPrompt(): string {
  return getSetting(KEY_SYSTEM_PROMPT) ?? DEFAULT_SYSTEM_PROMPT;
}

export function setChatSystemPrompt(prompt: string): string {
  setSetting(KEY_SYSTEM_PROMPT, prompt);
  return prompt;
}

export function getChatUseRagContext(): boolean {
  return parseBool(getSetting(KEY_USE_RAG_CONTEXT), false);
}

export function setChatUseRagContext(enabled: boolean): boolean {
  setSetting(KEY_USE_RAG_CONTEXT, enabled ? '1' : '0');
  return enabled;
}

export function createConversation(opts?: {
  title?: string;
  modelId?: string;
  systemPrompt?: string;
  useRagContext?: boolean;
}): ChatConversationRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  const modelId = opts?.modelId && modelExists(opts.modelId) ? opts.modelId : getChatSelectedModelId();
  const systemPrompt = opts?.systemPrompt ?? getChatSystemPrompt();
  const useRagContext = opts?.useRagContext ?? getChatUseRagContext();
  const title = opts?.title?.trim() || 'New chat';

  db.prepare(
    `INSERT INTO chat_conversations (id, title, model_id, system_prompt, use_rag_context, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, modelId, systemPrompt, useRagContext ? 1 : 0, now, now);

  return {
    id,
    title,
    modelId,
    systemPrompt,
    useRagContext,
    createdAt: now,
    updatedAt: now,
  };
}

export function getConversation(id: string): ChatConversationRecord | null {
  const row = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id) as Parameters<typeof rowToConversation>[0] | undefined;
  return row ? rowToConversation(row) : null;
}

export function getOrCreateCurrentConversation(): ChatConversationRecord {
  const currentId = getSetting(KEY_CURRENT_CONVERSATION_ID)?.trim();
  if (currentId) {
    const existing = getConversation(currentId);
    if (existing) return existing;
  }
  const created = createConversation();
  setCurrentConversationId(created.id);
  return created;
}

export function setCurrentConversationId(id: string): string {
  if (!getConversation(id)) throw new Error('Unknown conversation id');
  setSetting(KEY_CURRENT_CONVERSATION_ID, id);
  return id;
}

export function getChatSettings(): ChatSettings {
  const current = getOrCreateCurrentConversation();
  return {
    currentConversationId: current.id,
    selectedModelId: getChatSelectedModelId(),
    systemPrompt: getChatSystemPrompt(),
    useRagContext: getChatUseRagContext(),
  };
}

export function updateChatSettings(opts: {
  selectedModelId?: string;
  systemPrompt?: string;
  useRagContext?: boolean;
}): ChatSettings {
  if (opts.selectedModelId !== undefined) setChatSelectedModelId(opts.selectedModelId);
  if (opts.systemPrompt !== undefined) setChatSystemPrompt(opts.systemPrompt);
  if (opts.useRagContext !== undefined) setChatUseRagContext(opts.useRagContext);
  return getChatSettings();
}

export function listConversations(): Array<ChatConversationRecord & { messageCount: number }> {
  const rows = db
    .prepare(
      `SELECT c.*, COUNT(m.id) AS message_count
       FROM chat_conversations c
       LEFT JOIN chat_messages m ON m.conversation_id = c.id
       GROUP BY c.id
       ORDER BY c.updated_at DESC`
    )
    .all() as Array<Parameters<typeof rowToConversation>[0] & { message_count: number }>;
  return rows.map((row) => ({ ...rowToConversation(row), messageCount: row.message_count }));
}

export function listMessages(conversationId: string): ChatMessageRecord[] {
  const rows = db
    .prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY position ASC')
    .all(conversationId) as Array<Parameters<typeof rowToMessage>[0]>;
  const messages = rows.map(rowToMessage);
  const attachments = listAttachments(conversationId);
  const byMessage = new Map<string, ChatAttachmentRecord[]>();
  for (const a of attachments) {
    if (!a.messageId) continue;
    const existing = byMessage.get(a.messageId) ?? [];
    existing.push(a);
    byMessage.set(a.messageId, existing);
  }
  return messages.map((m) => ({ ...m, attachments: byMessage.get(m.id) ?? [] }));
}

export function listAttachments(conversationId: string): ChatAttachmentRecord[] {
  const rows = db
    .prepare('SELECT * FROM chat_attachments WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId) as Array<Parameters<typeof rowToAttachment>[0]>;
  return rows.map(rowToAttachment);
}

function nextMessagePosition(conversationId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM chat_messages WHERE conversation_id = ?')
    .get(conversationId) as { next: number };
  return row.next;
}

function titleFromUserText(text: string): string {
  const single = text.trim().replace(/\s+/g, ' ');
  if (!single) return 'New chat';
  return single.length > 60 ? `${single.slice(0, 57)}...` : single;
}

export function appendMessage(input: {
  conversationId: string;
  role: ChatRole;
  content: string;
  ragContext?: string | null;
  modelId?: string | null;
  attachments?: Array<{
    kind: 'upload' | 'screenshot';
    mimeType: string;
    dataUrl: string;
    fileName?: string | null;
  }>;
}): ChatMessageRecord {
  const conversation = getConversation(input.conversationId);
  if (!conversation) throw new Error('Unknown conversation id');

  const id = randomUUID();
  const now = new Date().toISOString();
  const position = nextMessagePosition(input.conversationId);
  db.prepare(
    `INSERT INTO chat_messages (id, conversation_id, role, content, rag_context, model_id, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.conversationId,
    input.role,
    input.content,
    input.ragContext ?? null,
    input.modelId ?? null,
    position,
    now,
  );

  const title =
    conversation.title === 'New chat' && input.role === 'user'
      ? titleFromUserText(input.content)
      : conversation.title;
  db.prepare('UPDATE chat_conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, now, input.conversationId);

  const savedAttachments: ChatAttachmentRecord[] = [];
  if (input.attachments?.length) {
    const insertAttachment = db.prepare(
      `INSERT INTO chat_attachments (id, message_id, conversation_id, kind, mime_type, data_url, file_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const attachment of input.attachments) {
      const attachmentId = randomUUID();
      insertAttachment.run(
        attachmentId,
        id,
        input.conversationId,
        attachment.kind,
        attachment.mimeType,
        attachment.dataUrl,
        attachment.fileName ?? null,
        now,
      );
      savedAttachments.push({
        id: attachmentId,
        messageId: id,
        conversationId: input.conversationId,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        dataUrl: attachment.dataUrl,
        fileName: attachment.fileName ?? null,
        createdAt: now,
      });
    }
  }

  return {
    id,
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    ragContext: input.ragContext ?? null,
    modelId: input.modelId ?? null,
    position,
    createdAt: now,
    attachments: savedAttachments,
  };
}

export function recordOpenRouterUsage(input: {
  conversationId: string;
  messageId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  imageCount: number;
  promptPricePerMillion?: number;
  completionPricePerMillion?: number;
  imagePrice?: number;
}) {
  const promptCost = (input.promptTokens / 1_000_000) * (input.promptPricePerMillion ?? 0);
  const completionCost = (input.completionTokens / 1_000_000) * (input.completionPricePerMillion ?? 0);
  const imageCost = input.imageCount * (input.imagePrice ?? 0);
  const totalCost = promptCost + completionCost + imageCost;
  const totalTokens = input.promptTokens + input.completionTokens;
  db.prepare(
    `INSERT INTO openrouter_usage (
      conversation_id, message_id, model_id,
      prompt_tokens, completion_tokens, total_tokens,
      prompt_cost, completion_cost, image_cost, total_cost, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.conversationId,
    input.messageId,
    input.modelId,
    input.promptTokens,
    input.completionTokens,
    totalTokens,
    promptCost,
    completionCost,
    imageCost,
    totalCost,
    new Date().toISOString(),
  );
}

export function updateConversationRuntime(
  conversationId: string,
  opts: { modelId?: string; systemPrompt?: string; useRagContext?: boolean }
): ChatConversationRecord {
  const current = getConversation(conversationId);
  if (!current) throw new Error('Unknown conversation id');
  const modelId = opts.modelId !== undefined ? opts.modelId.trim() : current.modelId;
  if (!modelId || !modelExists(modelId)) throw new Error('Unknown model id');
  const systemPrompt = opts.systemPrompt !== undefined ? opts.systemPrompt : current.systemPrompt;
  const useRagContext = opts.useRagContext !== undefined ? opts.useRagContext : current.useRagContext;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE chat_conversations
     SET model_id = ?, system_prompt = ?, use_rag_context = ?, updated_at = ?
     WHERE id = ?`
  ).run(modelId, systemPrompt, useRagContext ? 1 : 0, now, conversationId);
  return getConversation(conversationId)!;
}

export function deleteConversation(conversationId: string): { deleted: boolean } {
  const id = conversationId.trim();
  if (!id) throw new Error('Conversation id is required');

  const existing = getConversation(id);
  if (!existing) {
    return { deleted: false };
  }

  const wasCurrent = getSetting(KEY_CURRENT_CONVERSATION_ID)?.trim() === id;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM chat_attachments WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM openrouter_usage WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(id);

    if (wasCurrent) {
      const created = createConversation();
      setSetting(KEY_CURRENT_CONVERSATION_ID, created.id);
    }
  });

  tx();
  return { deleted: true };
}
