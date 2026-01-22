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
db.exec(`
  CREATE TABLE IF NOT EXISTS embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_text TEXT NOT NULL,
    chunk_hash TEXT UNIQUE NOT NULL,
    embedding BLOB NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Track last embedded content hash to detect changes
db.exec(`
  CREATE TABLE IF NOT EXISTS embedding_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_content_hash TEXT,
    total_chunks INTEGER DEFAULT 0,
    embedded_chunks INTEGER DEFAULT 0,
    updated_at TEXT
  )
`);

export default db;
