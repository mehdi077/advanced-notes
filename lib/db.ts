import Database from 'better-sqlite3';
import path from 'path';

// Initialize the database
// We use a singleton pattern to avoid multiple connections in dev mode hot-reloading
// although better-sqlite3 is synchronous and fast, it's good practice.

const dbPath = path.join(process.cwd(), 'data.db');
const db = new Database(dbPath);

// Create tables if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    content TEXT,
    updated_at TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS pin_attempt_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    success INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS llm_models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model_id TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '',
    use_rag_context INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    rag_context TEXT,
    model_id TEXT,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx ON chat_messages(conversation_id, position)');
db.exec('CREATE INDEX IF NOT EXISTS chat_conversations_updated_idx ON chat_conversations(updated_at DESC)');

(() => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM llm_models').get() as { count: number };
  if (count.count > 0) return;

  const now = new Date().toISOString();
  const seed = db.prepare(
    `INSERT OR IGNORE INTO llm_models (id, name, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const defaults: Array<{ id: string; name: string; description: string }> = [
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable' },
    { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'Most capable OpenAI model' },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Excellent writing quality' },
    { id: 'x-ai/grok-4.1-fast', name: 'grok-4.1-fast', description: 'Xai model' },
    { id: 'deepseek/deepseek-v3.2-exp', name: 'Deepseek v3.2 exp', description: 'deepseek/deepseek-v3.2-exp' },
    { id: 'x-ai/grok-4.20', name: 'grok-4.20', description: 'grok-4.20' },
    { id: 'openai/gpt-5.4', name: 'gpt-5.4', description: 'gpt-5.4' },
    { id: 'anthropic/claude-sonnet-4.6', name: 'claude-sonnet-4.6', description: 'claude-sonnet-4.6' },
  ];
  for (const m of defaults) seed.run(m.id, m.name, m.description, now, now);
})();

// Embeddings table for RAG system
// Embeddings table for RAG system (supports multiple embedding models)
// NOTE: We migrate older schema (single-model) to this schema on startup.

const DEFAULT_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';

function tableHasColumn(tableName: string, columnName: string): boolean {
  try {
    const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return cols.some(c => c.name === columnName);
  } catch {
    return false;
  }
}

function tableExists(tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(tableName) as { name: string } | undefined;
  return Boolean(row?.name);
}

if (!tableHasColumn('llm_models', 'input_modalities')) {
  db.exec("ALTER TABLE llm_models ADD COLUMN input_modalities TEXT NOT NULL DEFAULT '[\"text\"]'");
}

if (!tableHasColumn('llm_models', 'supports_vision')) {
  db.exec('ALTER TABLE llm_models ADD COLUMN supports_vision INTEGER NOT NULL DEFAULT 0');
}

if (!tableHasColumn('llm_models', 'prompt_price_per_million')) {
  db.exec('ALTER TABLE llm_models ADD COLUMN prompt_price_per_million REAL');
}

if (!tableHasColumn('llm_models', 'completion_price_per_million')) {
  db.exec('ALTER TABLE llm_models ADD COLUMN completion_price_per_million REAL');
}

if (!tableHasColumn('llm_models', 'image_price')) {
  db.exec('ALTER TABLE llm_models ADD COLUMN image_price REAL');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT,
    conversation_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('upload', 'screenshot')),
    mime_type TEXT NOT NULL,
    data_url TEXT NOT NULL,
    file_name TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
    FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS chat_attachments_conversation_idx ON chat_attachments(conversation_id, created_at)');

db.exec(`
  CREATE TABLE IF NOT EXISTS openrouter_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    message_id TEXT,
    model_id TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    prompt_cost REAL NOT NULL DEFAULT 0,
    completion_cost REAL NOT NULL DEFAULT 0,
    image_cost REAL NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id) ON DELETE SET NULL,
    FOREIGN KEY(message_id) REFERENCES chat_messages(id) ON DELETE SET NULL
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS openrouter_usage_model_idx ON openrouter_usage(model_id, created_at)');

// Ensure the multi-model schema exists; migrate legacy tables if needed.
(() => {
  // Create new tables if they don't exist (new installs)
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      embedding_model_id TEXT NOT NULL,
      chunk_text TEXT NOT NULL,
      chunk_hash TEXT NOT NULL,
      embedding BLOB NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(embedding_model_id, chunk_hash)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS embedding_state (
      embedding_model_id TEXT PRIMARY KEY,
      last_content_hash TEXT,
      total_chunks INTEGER DEFAULT 0,
      embedded_chunks INTEGER DEFAULT 0,
      updated_at TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS embedding_models (
      model_id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // If this repo was previously using the legacy schema, migrate it.
  // Legacy embeddings schema had UNIQUE(chunk_hash) and no embedding_model_id column.
  const needsEmbeddingsMigration = tableExists('embeddings') && !tableHasColumn('embeddings', 'embedding_model_id');
  if (needsEmbeddingsMigration) {
    db.exec(`
      ALTER TABLE embeddings RENAME TO embeddings_legacy;

      CREATE TABLE embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        embedding_model_id TEXT NOT NULL,
        chunk_text TEXT NOT NULL,
        chunk_hash TEXT NOT NULL,
        embedding BLOB NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(embedding_model_id, chunk_hash)
      );

      INSERT INTO embeddings (embedding_model_id, chunk_text, chunk_hash, embedding, created_at)
      SELECT '${DEFAULT_EMBEDDING_MODEL}', chunk_text, chunk_hash, embedding, created_at
      FROM embeddings_legacy;

      DROP TABLE embeddings_legacy;
    `);
  }

  // Legacy embedding_state schema used a single row with id=1 and no embedding_model_id.
  const needsStateMigration = tableExists('embedding_state') && !tableHasColumn('embedding_state', 'embedding_model_id');
  if (needsStateMigration) {
    db.exec(`
      ALTER TABLE embedding_state RENAME TO embedding_state_legacy;

      CREATE TABLE embedding_state (
        embedding_model_id TEXT PRIMARY KEY,
        last_content_hash TEXT,
        total_chunks INTEGER DEFAULT 0,
        embedded_chunks INTEGER DEFAULT 0,
        updated_at TEXT
      );

      INSERT INTO embedding_state (embedding_model_id, last_content_hash, total_chunks, embedded_chunks, updated_at)
      SELECT '${DEFAULT_EMBEDDING_MODEL}', last_content_hash, total_chunks, embedded_chunks, updated_at
      FROM embedding_state_legacy
      WHERE id = 1;

      DROP TABLE embedding_state_legacy;
    `);
  }

  // Ensure default embedding model is registered.
  db.prepare('INSERT OR IGNORE INTO embedding_models (model_id) VALUES (?)').run(DEFAULT_EMBEDDING_MODEL);

  // Also register any models that already exist in embedding_state (in case user added models before this table existed).
  const models = db.prepare('SELECT embedding_model_id FROM embedding_state').all() as Array<{ embedding_model_id: string }>;
  const insertModel = db.prepare('INSERT OR IGNORE INTO embedding_models (model_id) VALUES (?)');
  for (const m of models) {
    if (m.embedding_model_id) insertModel.run(m.embedding_model_id);
  }
})();

export default db;
