import type Database from 'better-sqlite3';
import type { PinStatusValue, StoredPinRecord } from '../types';

interface DbPinRow {
  requestid: string;
  cid: string;
  name: string | null;
  status: PinStatusValue;
  origins: string;
  meta: string;
  delegates: string;
  info: string;
  owner: string;
  created: string;
  updated: string;
  expires_at: string | null;
}

interface DbCidOwnerRow {
  cid: string;
  owner: string;
  created: string;
}

interface HistoricalCidOwnerResolution {
  kind: 'none' | 'unique' | 'ambiguous';
  row?: DbCidOwnerRow;
}

export interface PinListFilters {
  cid?: string;
  name?: string;
  status?: PinStatusValue[];
  before?: string;
  after?: string;
  limit: number;
  offset: number;
  owner?: string;
}

export interface PinListResult {
  totalCount: number;
  rows: StoredPinRecord[];
}

export class PinRepository {
  constructor(private readonly db: Database.Database) {}

  claimCidOwner(cid: string, owner: string, claimedAt: string): void {
    const existing = this.findCidOwnerRow(cid);
    if (existing) {
      return;
    }

    const historicalOwner = this.resolveHistoricalCidOwner(cid);
    if (historicalOwner.kind === 'ambiguous') {
      return;
    }

    const canonicalOwner = historicalOwner.kind === 'unique' ? historicalOwner.row!.owner : owner;
    const canonicalCreated = historicalOwner.kind === 'unique' ? historicalOwner.row!.created : claimedAt;

    this.db
      .prepare(`
        INSERT OR IGNORE INTO cid_owners (cid, owner, created)
        VALUES (?, ?, ?)
      `)
      .run(cid, canonicalOwner, canonicalCreated);
  }

  findCidOwner(cid: string): string | null {
    const row = this.findCidOwnerRow(cid);
    if (row) {
      return row.owner;
    }

    const historicalOwner = this.resolveHistoricalCidOwner(cid);
    return historicalOwner.kind === 'unique' ? historicalOwner.row!.owner : null;
  }

  create(record: StoredPinRecord): void {
    const statement = this.db.prepare(`
      INSERT INTO pins (
        requestid, cid, name, status, origins, meta, delegates, info, owner, created, updated, expires_at
      ) VALUES (
        @requestid, @cid, @name, @status, @origins, @meta, @delegates, @info, @owner, @created, @updated, @expires_at
      )
    `);

    statement.run({
      ...record,
      origins: JSON.stringify(record.origins),
      meta: JSON.stringify(record.meta),
      delegates: JSON.stringify(record.delegates),
      info: JSON.stringify(record.info)
    });
  }

  update(requestid: string, patch: Partial<Omit<StoredPinRecord, 'requestid'>>): void {
    const existing = this.findByRequestId(requestid);
    if (!existing) {
      return;
    }

    const nextRecord: StoredPinRecord = {
      ...existing,
      ...patch,
      requestid
    };

    const statement = this.db.prepare(`
      UPDATE pins
      SET cid = @cid,
          name = @name,
          status = @status,
          origins = @origins,
          meta = @meta,
          delegates = @delegates,
          info = @info,
          owner = @owner,
          created = @created,
          updated = @updated,
          expires_at = @expires_at
      WHERE requestid = @requestid
    `);

    statement.run({
      ...nextRecord,
      origins: JSON.stringify(nextRecord.origins),
      meta: JSON.stringify(nextRecord.meta),
      delegates: JSON.stringify(nextRecord.delegates),
      info: JSON.stringify(nextRecord.info)
    });
  }

  delete(requestid: string): boolean {
    const statement = this.db.prepare('DELETE FROM pins WHERE requestid = ?');
    return statement.run(requestid).changes > 0;
  }

  findByRequestId(requestid: string): StoredPinRecord | null {
    const row = this.db
      .prepare('SELECT requestid, cid, name, status, origins, meta, delegates, info, owner, created, updated, expires_at FROM pins WHERE requestid = ?')
      .get(requestid) as DbPinRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  findLatestByCid(cid: string): StoredPinRecord | null {
    const pinnedRow = this.db
      .prepare(
        `
          SELECT requestid, cid, name, status, origins, meta, delegates, info, owner, created, updated, expires_at
          FROM pins
          WHERE cid = ? AND status = 'pinned'
          ORDER BY updated DESC, created DESC, rowid DESC
          LIMIT 1
        `
      )
      .get(cid) as DbPinRow | undefined;

    if (pinnedRow) {
      return this.mapRow(pinnedRow);
    }

    const fallbackRow = this.db
      .prepare(
        `
          SELECT requestid, cid, name, status, origins, meta, delegates, info, owner, created, updated, expires_at
          FROM pins
          WHERE cid = ?
          ORDER BY updated DESC, created DESC, rowid DESC
          LIMIT 1
        `
      )
      .get(cid) as DbPinRow | undefined;

    return fallbackRow ? this.mapRow(fallbackRow) : null;
  }

  findLatestByCidAndOwner(cid: string, owner: string): StoredPinRecord | null {
    const pinnedRow = this.db
      .prepare(
        `
          SELECT requestid, cid, name, status, origins, meta, delegates, info, owner, created, updated, expires_at
          FROM pins
          WHERE cid = ? AND owner = ? AND status = 'pinned'
          ORDER BY updated DESC, created DESC, rowid DESC
          LIMIT 1
        `
      )
      .get(cid, owner) as DbPinRow | undefined;

    if (pinnedRow) {
      return this.mapRow(pinnedRow);
    }

    const fallbackRow = this.db
      .prepare(
        `
          SELECT requestid, cid, name, status, origins, meta, delegates, info, owner, created, updated, expires_at
          FROM pins
          WHERE cid = ? AND owner = ?
          ORDER BY updated DESC, created DESC, rowid DESC
          LIMIT 1
        `
      )
      .get(cid, owner) as DbPinRow | undefined;

    return fallbackRow ? this.mapRow(fallbackRow) : null;
  }

  list(filters: PinListFilters): PinListResult {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (filters.cid) {
      where.push('cid = ?');
      params.push(filters.cid);
    }

    if (filters.name) {
      where.push('name = ?');
      params.push(filters.name);
    }

    if (filters.status && filters.status.length > 0) {
      const placeholders = filters.status.map(() => '?').join(', ');
      where.push(`status IN (${placeholders})`);
      params.push(...filters.status);
    }

    if (filters.before) {
      where.push('created <= ?');
      params.push(filters.before);
    }

    if (filters.after) {
      where.push('created >= ?');
      params.push(filters.after);
    }

    if (filters.owner) {
      where.push('owner = ?');
      params.push(filters.owner);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*) as count FROM pins ${whereClause}`;
    const total = this.db.prepare(countQuery).get(...params) as { count: number };

    const listQuery = `
      SELECT requestid, cid, name, status, origins, meta, delegates, info, owner, created, updated, expires_at
      FROM pins
      ${whereClause}
      ORDER BY created DESC
      LIMIT ? OFFSET ?
    `;

    const rows = this.db
      .prepare(listQuery)
      .all(...params, filters.limit, filters.offset) as DbPinRow[];

    return {
      totalCount: total.count,
      rows: rows.map((row) => this.mapRow(row))
    };
  }

  findExpired(limit: number, now: string): StoredPinRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT requestid, cid, name, status, origins, meta, delegates, info, owner, created, updated, expires_at
          FROM pins
          WHERE expires_at IS NOT NULL AND expires_at <= ? AND status IN ('pinned', 'failed')
          ORDER BY expires_at ASC
          LIMIT ?
        `
      )
      .all(now, limit) as DbPinRow[];

    return rows.map((row) => this.mapRow(row));
  }

  countActivePinsForCid(cid: string, now: string): number {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) as count
          FROM pins
          WHERE cid = ? AND (expires_at IS NULL OR expires_at > ?)
        `
      )
      .get(cid, now) as { count: number };

    return row.count;
  }

  deleteCidOwnerIfOrphaned(cid: string): void {
    const pinCount = this.db
      .prepare('SELECT COUNT(*) as count FROM pins WHERE cid = ?')
      .get(cid) as { count: number };

    if (pinCount.count === 0) {
      this.db.prepare('DELETE FROM cid_owners WHERE cid = ?').run(cid);
    }
  }

  private mapRow(row: DbPinRow): StoredPinRecord {
    return {
      requestid: row.requestid,
      cid: row.cid,
      name: row.name,
      status: row.status,
      origins: JSON.parse(row.origins) as string[],
      meta: JSON.parse(row.meta) as Record<string, string>,
      delegates: JSON.parse(row.delegates) as string[],
      info: JSON.parse(row.info) as Record<string, unknown>,
      owner: row.owner,
      created: row.created,
      updated: row.updated,
      expires_at: row.expires_at
    };
  }

  private findCidOwnerRow(cid: string): DbCidOwnerRow | null {
    const row = this.db
      .prepare('SELECT cid, owner, created FROM cid_owners WHERE cid = ?')
      .get(cid) as DbCidOwnerRow | undefined;

    return row ?? null;
  }

  private resolveHistoricalCidOwner(cid: string): HistoricalCidOwnerResolution {
    const rows = this.db
      .prepare(
        `
          SELECT
            ? AS cid,
            owner,
            MIN(updated) AS created
          FROM pins
          WHERE cid = ? AND status = 'pinned'
          GROUP BY owner
          ORDER BY MIN(updated) ASC, MIN(created) ASC, MIN(rowid) ASC
          LIMIT 2
        `
      )
      .all(cid, cid) as DbCidOwnerRow[];

    if (rows.length === 0) {
      return { kind: 'none' };
    }

    if (rows.length > 1) {
      return { kind: 'ambiguous' };
    }

    return {
      kind: 'unique',
      row: rows[0]
    };
  }
}
