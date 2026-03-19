import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export function createDb(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS pins (
      requestid TEXT PRIMARY KEY,
      cid TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued', 'pinning', 'pinned', 'failed')),
      origins TEXT NOT NULL,
      meta TEXT NOT NULL,
      delegates TEXT NOT NULL,
      info TEXT NOT NULL,
      owner TEXT NOT NULL,
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cid_owners (
      cid TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      created TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pins_cid ON pins(cid);
    CREATE INDEX IF NOT EXISTS idx_pins_name ON pins(name);
    CREATE INDEX IF NOT EXISTS idx_pins_status ON pins(status);
    CREATE INDEX IF NOT EXISTS idx_pins_created ON pins(created);
    CREATE INDEX IF NOT EXISTS idx_pins_owner ON pins(owner);
  `);

  // Migration: add expires_at column if missing
  const columns = db.pragma('table_info(pins)') as Array<{ name: string }>;
  if (!columns.some((col) => col.name === 'expires_at')) {
    db.exec('ALTER TABLE pins ADD COLUMN expires_at TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_pins_expires_at ON pins(expires_at)');

  return db;
}
