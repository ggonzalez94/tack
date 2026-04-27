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

    CREATE TABLE IF NOT EXISTS wallet_auth_challenges (
      nonce_hash TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      network TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      domain TEXT NOT NULL,
      uri TEXT NOT NULL,
      message TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS private_objects (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      meta TEXT NOT NULL,
      payment_status TEXT NOT NULL CHECK(payment_status IN ('paid', 'pending', 'failed')),
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      expires_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pins_cid ON pins(cid);
    CREATE INDEX IF NOT EXISTS idx_pins_name ON pins(name);
    CREATE INDEX IF NOT EXISTS idx_pins_status ON pins(status);
    CREATE INDEX IF NOT EXISTS idx_pins_created ON pins(created);
    CREATE INDEX IF NOT EXISTS idx_pins_owner ON pins(owner);
    CREATE INDEX IF NOT EXISTS idx_wallet_auth_challenges_expires_at ON wallet_auth_challenges(expires_at);
    CREATE INDEX IF NOT EXISTS idx_private_objects_owner ON private_objects(owner);
    CREATE INDEX IF NOT EXISTS idx_private_objects_created ON private_objects(created);
    CREATE INDEX IF NOT EXISTS idx_private_objects_expires_at ON private_objects(expires_at);
  `);

  // Migration: add expires_at column if missing
  const columns = db.pragma('table_info(pins)') as Array<{ name: string }>;
  if (!columns.some((col) => col.name === 'expires_at')) {
    db.exec('ALTER TABLE pins ADD COLUMN expires_at TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_pins_expires_at ON pins(expires_at)');

  return db;
}
