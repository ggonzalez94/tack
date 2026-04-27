import type Database from 'better-sqlite3';

export type PrivateObjectPaymentStatus = 'paid' | 'pending' | 'failed';

interface DbPrivateObjectRow {
  id: string;
  owner: string;
  name: string | null;
  content_type: string;
  size_bytes: number;
  sha256: string;
  storage_key: string;
  meta: string;
  payment_status: PrivateObjectPaymentStatus;
  created: string;
  updated: string;
  expires_at: string | null;
}

export interface StoredPrivateObjectRecord {
  id: string;
  owner: string;
  name: string | null;
  content_type: string;
  size_bytes: number;
  sha256: string;
  storage_key: string;
  meta: Record<string, string>;
  payment_status: PrivateObjectPaymentStatus;
  created: string;
  updated: string;
  expires_at: string | null;
}

export interface PrivateObjectListFilters {
  owner: string;
  name?: string;
  before?: string;
  after?: string;
  limit: number;
  offset: number;
  now: string;
}

export interface PrivateObjectListResult {
  totalCount: number;
  rows: StoredPrivateObjectRecord[];
}

export class PrivateObjectRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: StoredPrivateObjectRecord): void {
    this.db
      .prepare(`
        INSERT INTO private_objects (
          id, owner, name, content_type, size_bytes, sha256, storage_key, meta,
          payment_status, created, updated, expires_at
        ) VALUES (
          @id, @owner, @name, @content_type, @size_bytes, @sha256, @storage_key, @meta,
          @payment_status, @created, @updated, @expires_at
        )
      `)
      .run({
        ...record,
        meta: JSON.stringify(record.meta)
      });
  }

  update(id: string, patch: Partial<Omit<StoredPrivateObjectRecord, 'id'>>): void {
    const existing = this.findById(id);
    if (!existing) {
      return;
    }

    const next: StoredPrivateObjectRecord = {
      ...existing,
      ...patch,
      id
    };

    this.db
      .prepare(`
        UPDATE private_objects
        SET owner = @owner,
            name = @name,
            content_type = @content_type,
            size_bytes = @size_bytes,
            sha256 = @sha256,
            storage_key = @storage_key,
            meta = @meta,
            payment_status = @payment_status,
            created = @created,
            updated = @updated,
            expires_at = @expires_at
        WHERE id = @id
      `)
      .run({
        ...next,
        meta: JSON.stringify(next.meta)
      });
  }

  findById(id: string): StoredPrivateObjectRecord | null {
    const row = this.db
      .prepare(`
        SELECT id, owner, name, content_type, size_bytes, sha256, storage_key, meta,
               payment_status, created, updated, expires_at
        FROM private_objects
        WHERE id = ?
      `)
      .get(id) as DbPrivateObjectRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  findVisibleByIdAndOwner(id: string, owner: string, now: string): StoredPrivateObjectRecord | null {
    const row = this.db
      .prepare(`
        SELECT id, owner, name, content_type, size_bytes, sha256, storage_key, meta,
               payment_status, created, updated, expires_at
        FROM private_objects
        WHERE id = ?
          AND owner = ?
          AND payment_status = 'paid'
          AND (expires_at IS NULL OR expires_at > ?)
      `)
      .get(id, owner, now) as DbPrivateObjectRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  listByOwner(filters: PrivateObjectListFilters): PrivateObjectListResult {
    const where = [
      'owner = ?',
      "payment_status = 'paid'",
      '(expires_at IS NULL OR expires_at > ?)'
    ];
    const params: Array<string | number> = [filters.owner, filters.now];

    if (filters.name) {
      where.push('name = ?');
      params.push(filters.name);
    }

    if (filters.before) {
      where.push('created <= ?');
      params.push(filters.before);
    }

    if (filters.after) {
      where.push('created >= ?');
      params.push(filters.after);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const total = this.db
      .prepare(`SELECT COUNT(*) as count FROM private_objects ${whereClause}`)
      .get(...params) as { count: number };

    const rows = this.db
      .prepare(`
        SELECT id, owner, name, content_type, size_bytes, sha256, storage_key, meta,
               payment_status, created, updated, expires_at
        FROM private_objects
        ${whereClause}
        ORDER BY created DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, filters.limit, filters.offset) as DbPrivateObjectRow[];

    return {
      totalCount: total.count,
      rows: rows.map((row) => this.mapRow(row))
    };
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM private_objects WHERE id = ?').run(id).changes > 0;
  }

  private mapRow(row: DbPrivateObjectRow): StoredPrivateObjectRecord {
    return {
      id: row.id,
      owner: row.owner,
      name: row.name,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
      sha256: row.sha256,
      storage_key: row.storage_key,
      meta: JSON.parse(row.meta) as Record<string, string>,
      payment_status: row.payment_status,
      created: row.created,
      updated: row.updated,
      expires_at: row.expires_at
    };
  }
}
