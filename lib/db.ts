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

export default db;
