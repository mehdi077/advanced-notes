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
