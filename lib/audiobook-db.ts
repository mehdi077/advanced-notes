import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'audiobook.db');
const audiobookDb = new Database(dbPath);

audiobookDb.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    content TEXT,
    updated_at TEXT
  )
`);

audiobookDb.exec(`
  CREATE TABLE IF NOT EXISTS audio_segments (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    text TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

audiobookDb.exec('CREATE INDEX IF NOT EXISTS audio_segments_doc_id_idx ON audio_segments(doc_id)');

export default audiobookDb;
