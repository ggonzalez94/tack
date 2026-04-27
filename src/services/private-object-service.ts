import { randomUUID } from 'node:crypto';
import { NotFoundError, ValidationError } from '../lib/errors';
import {
  PrivateObjectRepository,
  type PrivateObjectPaymentStatus,
  type StoredPrivateObjectRecord
} from '../repositories/private-object-repository';
import type { PrivateObjectStorage } from './private-object-storage';

export interface CreatePrivateObjectInput {
  owner: string;
  name?: string;
  contentType: string;
  meta?: Record<string, string>;
  content: ArrayBuffer;
  durationMonths?: number;
  paymentStatus: PrivateObjectPaymentStatus;
}

export interface UpdatePrivateObjectInput {
  name?: string | null;
  meta?: Record<string, string>;
}

export interface ListPrivateObjectsInput {
  owner: string;
  name?: string;
  before?: string;
  after?: string;
  limit: number;
  offset: number;
}

export interface PrivateObjectContentResult {
  record: StoredPrivateObjectRecord;
  content: ArrayBuffer;
}

function normalizeOwner(owner: string): string {
  const normalized = owner.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
    throw new ValidationError('private object owner is invalid');
  }
  return normalized;
}

function computeExpiresAt(durationMonths: number | undefined, now = new Date()): string | null {
  if (durationMonths === undefined || durationMonths <= 0) {
    return null;
  }

  const targetYear = now.getUTCFullYear();
  const targetMonth = now.getUTCMonth() + durationMonths;
  const maxDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(now.getUTCDate(), maxDay);

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    clampedDay,
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds()
  )).toISOString();
}

function createObjectId(): string {
  return `obj_${randomUUID()}`;
}

function storageKeyForObject(id: string): string {
  return `objects/${id.slice(4, 6)}/${id}`;
}

function renewedRecord(
  existing: StoredPrivateObjectRecord,
  durationMonths: number,
  now = new Date()
): StoredPrivateObjectRecord {
  return {
    ...existing,
    expires_at: computeExpiresAt(durationMonths, now),
    updated: now.toISOString()
  };
}

export class PrivateObjectService {
  constructor(
    private readonly repository: PrivateObjectRepository,
    private readonly storage: PrivateObjectStorage
  ) {}

  async createObject(input: CreatePrivateObjectInput): Promise<StoredPrivateObjectRecord> {
    const owner = normalizeOwner(input.owner);
    const id = createObjectId();
    const storageKey = storageKeyForObject(id);
    const stored = await this.storage.put({
      key: storageKey,
      content: input.content,
      contentType: input.contentType
    });
    const now = new Date().toISOString();
    const record: StoredPrivateObjectRecord = {
      id,
      owner,
      name: input.name ?? null,
      content_type: input.contentType,
      size_bytes: stored.sizeBytes,
      sha256: stored.sha256,
      storage_key: storageKey,
      meta: input.meta ?? {},
      payment_status: input.paymentStatus,
      created: now,
      updated: now,
      expires_at: computeExpiresAt(input.durationMonths)
    };

    this.repository.create(record);
    return record;
  }

  getObject(id: string, owner: string): StoredPrivateObjectRecord {
    return this.getObjectAt(id, owner, new Date());
  }

  private getObjectAt(id: string, owner: string, now: Date): StoredPrivateObjectRecord {
    const record = this.repository.findVisibleByIdAndOwner(id, normalizeOwner(owner), now.toISOString());
    if (!record) {
      throw new NotFoundError(`Private object ${id} was not found`);
    }
    return record;
  }

  async getObjectContent(id: string, owner: string): Promise<PrivateObjectContentResult> {
    const record = this.getObject(id, owner);
    const stored = await this.storage.get(record.storage_key);
    return {
      record,
      content: stored.content
    };
  }

  listObjects(input: ListPrivateObjectsInput): { count: number; results: StoredPrivateObjectRecord[] } {
    const list = this.repository.listByOwner({
      ...input,
      owner: normalizeOwner(input.owner),
      now: new Date().toISOString()
    });
    return {
      count: list.totalCount,
      results: list.rows
    };
  }

  updateObject(id: string, owner: string, input: UpdatePrivateObjectInput): StoredPrivateObjectRecord {
    const existing = this.getObject(id, owner);
    const updated: StoredPrivateObjectRecord = {
      ...existing,
      name: input.name === undefined ? existing.name : input.name,
      meta: input.meta ?? existing.meta,
      updated: new Date().toISOString()
    };
    this.repository.update(id, updated);
    return updated;
  }

  async deleteObject(id: string, owner: string): Promise<void> {
    const existing = this.getObject(id, owner);
    this.repository.delete(id);
    await this.storage.delete(existing.storage_key);
  }

  markPaid(id: string): void {
    const existing = this.repository.findById(id);
    if (!existing) {
      return;
    }
    this.repository.update(id, {
      payment_status: 'paid',
      updated: new Date().toISOString()
    });
  }

  async markFailedAndDeleteBytes(id: string): Promise<void> {
    const existing = this.repository.findById(id);
    if (!existing) {
      return;
    }
    this.repository.update(id, {
      payment_status: 'failed',
      updated: new Date().toISOString()
    });
    await this.storage.delete(existing.storage_key);
  }

  previewRenewObject(
    id: string,
    owner: string,
    durationMonths: number,
    now = new Date()
  ): StoredPrivateObjectRecord {
    const existing = this.getObjectAt(id, owner, now);
    return renewedRecord(existing, durationMonths, now);
  }

  renewObject(
    id: string,
    owner: string,
    durationMonths: number,
    now = new Date()
  ): StoredPrivateObjectRecord {
    const renewed = this.previewRenewObject(id, owner, durationMonths, now);
    this.repository.update(id, renewed);
    return renewed;
  }
}
