import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../lib/errors';
import type { PinStatusResponse, PinStatusValue, StoredPinRecord } from '../types';
import type { PinListFilters, PinRepository } from '../repositories/pin-repository';
import { resolveContentType } from './content-type';
import type { GatewayContentCache } from './content-cache';
import type { IpfsClient } from './ipfs-rpc-client';

const DEFAULT_GATEWAY_MAX_CONTENT_SIZE_BYTES = 50 * 1024 * 1024;

export interface CreatePinInput {
  cid: string;
  name?: string;
  origins?: string[];
  meta?: Record<string, string>;
  owner: string;
  durationMonths?: number;
}

export interface ReplacePinInput {
  cid: string;
  name?: string;
  origins?: string[];
  meta?: Record<string, string>;
}

export interface ListPinsInput {
  cid?: string;
  name?: string;
  status?: PinStatusValue[];
  before?: string;
  after?: string;
  limit: number;
  offset: number;
  owner?: string;
}

export interface PinningServiceOptions {
  contentCache?: GatewayContentCache;
  maxGatewayContentSizeBytes?: number;
  replicas?: PinningReplica[];
}

export interface GatewayContentResult {
  cid: string;
  content: ArrayBuffer;
  contentType: string;
  filename: string | null;
  cacheHit: boolean;
}

export interface RetrievalPaymentPolicy {
  cid: string;
  payTo: string;
  priceUsd: number;
}

export interface PinningReplica {
  name: string;
  delegateUrl?: string;
  client: Pick<IpfsClient, 'pinAdd' | 'pinRm'>;
}

interface ReplicaPinResult {
  target: string;
  status: 'pinned' | 'failed';
  error?: string;
}

function computeExpiresAt(durationMonths: number | undefined): string | null {
  if (durationMonths === undefined || durationMonths <= 0) {
    return null;
  }

  const now = new Date();
  const targetYear = now.getUTCFullYear();
  const targetMonth = now.getUTCMonth() + durationMonths;
  const maxDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(now.getUTCDate(), maxDay);

  const target = new Date(Date.UTC(
    targetYear,
    targetMonth,
    clampedDay,
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds()
  ));
  return target.toISOString();
}

function parseRetrievalPriceUsd(meta: Record<string, string>): number | null {
  const raw = meta.retrievalPrice ?? meta.retrievalPriceUsd;
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export class PinningService {
  private readonly contentCache?: GatewayContentCache;
  private readonly maxGatewayContentSizeBytes: number;
  private readonly replicas: PinningReplica[];
  private readonly delegates: string[];

  constructor(
    private readonly repository: PinRepository,
    private readonly ipfsClient: IpfsClient,
    private readonly delegateUrl: string,
    options?: PinningServiceOptions
  ) {
    this.contentCache = options?.contentCache;
    this.maxGatewayContentSizeBytes = options?.maxGatewayContentSizeBytes ?? DEFAULT_GATEWAY_MAX_CONTENT_SIZE_BYTES;
    this.replicas = options?.replicas ?? [];
    this.delegates = Array.from(
      new Set([this.delegateUrl, ...this.replicas.map((replica) => replica.delegateUrl).filter((url): url is string => !!url)])
    );
  }

  async createPin(input: CreatePinInput): Promise<StoredPinRecord> {
    const now = new Date().toISOString();

    const record: StoredPinRecord = {
      requestid: randomUUID(),
      cid: input.cid,
      name: input.name ?? null,
      status: 'pinning',
      origins: input.origins ?? [],
      meta: input.meta ?? {},
      delegates: this.delegates,
      info: {},
      owner: input.owner,
      created: now,
      updated: now,
      expires_at: computeExpiresAt(input.durationMonths)
    };

    this.repository.create(record);

    try {
      await this.ipfsClient.pinAdd(record.cid);
      const claimedAt = new Date().toISOString();
      this.repository.claimCidOwner(record.cid, record.owner, claimedAt);
      const replicaResults = await this.pinOnReplicas(record.cid);
      const updated = {
        ...record,
        status: 'pinned' as const,
        info: this.buildReplicationInfo(replicaResults),
        updated: claimedAt
      };
      this.repository.update(record.requestid, updated);
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown pinning failure';
      const failed = {
        ...record,
        status: 'failed' as const,
        info: { error: message },
        updated: new Date().toISOString()
      };
      this.repository.update(record.requestid, failed);
      return failed;
    }
  }

  async replacePin(requestid: string, input: ReplacePinInput, owner?: string): Promise<StoredPinRecord> {
    const existing = this.repository.findByRequestId(requestid);
    if (!existing) {
      throw new NotFoundError(`Pin request ${requestid} was not found`);
    }

    if (owner && existing.owner !== owner) {
      throw new NotFoundError(`Pin request ${requestid} was not found`);
    }

    if (existing.cid !== input.cid) {
      try {
        await this.ipfsClient.pinRm(existing.cid);
      } catch {
        // Best-effort cleanup; replacement still proceeds.
      }

      await this.unpinOnReplicas(existing.cid);
    }

    this.contentCache?.delete(existing.cid);
    if (input.cid !== existing.cid) {
      this.contentCache?.delete(input.cid);
    }

    const next: StoredPinRecord = {
      ...existing,
      cid: input.cid,
      name: input.name ?? null,
      origins: input.origins ?? [],
      meta: input.meta ?? {},
      status: 'pinning',
      info: {},
      updated: new Date().toISOString(),
      expires_at: existing.expires_at
    };

    this.repository.update(requestid, next);

    try {
      await this.ipfsClient.pinAdd(next.cid);
      const claimedAt = new Date().toISOString();
      this.repository.claimCidOwner(next.cid, next.owner, claimedAt);
      const replicaResults = await this.pinOnReplicas(next.cid);
      const pinned = {
        ...next,
        status: 'pinned' as const,
        info: this.buildReplicationInfo(replicaResults),
        updated: claimedAt
      };
      this.repository.update(requestid, pinned);
      return pinned;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown pinning failure';
      const failed = {
        ...next,
        status: 'failed' as const,
        info: { error: message },
        updated: new Date().toISOString()
      };
      this.repository.update(requestid, failed);
      return failed;
    }
  }

  async removePin(requestid: string, owner?: string): Promise<void> {
    const existing = this.repository.findByRequestId(requestid);
    if (!existing) {
      throw new NotFoundError(`Pin request ${requestid} was not found`);
    }

    if (owner && existing.owner !== owner) {
      throw new NotFoundError(`Pin request ${requestid} was not found`);
    }

    await this.ipfsClient.pinRm(existing.cid);
    await this.unpinOnReplicas(existing.cid);
    this.repository.delete(requestid);
    this.contentCache?.delete(existing.cid);
  }

  getPin(requestid: string, owner?: string): StoredPinRecord {
    const existing = this.repository.findByRequestId(requestid);
    if (!existing) {
      throw new NotFoundError(`Pin request ${requestid} was not found`);
    }

    if (owner && existing.owner !== owner) {
      throw new NotFoundError(`Pin request ${requestid} was not found`);
    }

    return existing;
  }

  getLatestPinByCid(cid: string): StoredPinRecord | null {
    return this.repository.findLatestByCid(cid);
  }

  resolveRetrievalPaymentPolicy(cid: string): RetrievalPaymentPolicy | null {
    const owner = this.repository.findCidOwner(cid);
    if (!owner) {
      return null;
    }

    const record = this.repository.findLatestByCidAndOwner(cid, owner);
    if (!record) {
      return null;
    }

    const priceUsd = parseRetrievalPriceUsd(record.meta);
    if (priceUsd === null) {
      return null;
    }

    return {
      cid,
      payTo: owner,
      priceUsd
    };
  }

  private async pinOnReplicas(cid: string): Promise<ReplicaPinResult[]> {
    if (this.replicas.length === 0) {
      return [];
    }

    return Promise.all(this.replicas.map(async (replica) => {
      try {
        await replica.client.pinAdd(cid);
        return {
          target: replica.name,
          status: 'pinned' as const
        };
      } catch (error) {
        return {
          target: replica.name,
          status: 'failed' as const,
          error: error instanceof Error ? error.message : 'Unknown replica pinning failure'
        };
      }
    }));
  }

  private async unpinOnReplicas(cid: string): Promise<void> {
    if (this.replicas.length === 0) {
      return;
    }

    await Promise.all(this.replicas.map(async (replica) => {
      try {
        await replica.client.pinRm(cid);
      } catch {
        // Best-effort cleanup only.
      }
    }));
  }

  private buildReplicationInfo(replicaResults: ReplicaPinResult[]): Record<string, unknown> {
    if (replicaResults.length === 0) {
      return {};
    }

    const successfulReplicas = replicaResults.filter((result) => result.status === 'pinned').length;
    const failedReplicas = replicaResults.length - successfulReplicas;

    return {
      replication: {
        replicas: replicaResults,
        successfulReplicas,
        failedReplicas
      }
    };
  }

  async sweepExpiredPins(batchSize = 50): Promise<{ expiredCount: number; failedCount: number; skippedUnpinCount: number }> {
    const now = new Date().toISOString();
    const expired = this.repository.findExpired(batchSize, now);

    let expiredCount = 0;
    let failedCount = 0;
    let skippedUnpinCount = 0;

    for (const pin of expired) {
      const activeCount = this.repository.countActivePinsForCid(pin.cid, now);
      const shouldUnpin = activeCount === 0 && pin.status === 'pinned';

      if (shouldUnpin) {
        try {
          await this.ipfsClient.pinRm(pin.cid);
          await this.unpinOnReplicas(pin.cid);
        } catch {
          // Treat "not pinned" as success (CID already unpinned by a prior sweep).
          // For genuine failures, still delete the record to avoid zombie loops.
          failedCount++;
        }
      } else if (activeCount > 0) {
        skippedUnpinCount++;
      }

      this.repository.delete(pin.requestid);
      this.repository.deleteCidOwnerIfOrphaned(pin.cid);

      if (shouldUnpin) {
        this.contentCache?.delete(pin.cid);
      }

      expiredCount++;
    }

    return { expiredCount, failedCount, skippedUnpinCount };
  }

  listPins(input: ListPinsInput): { count: number; results: StoredPinRecord[] } {
    const filters: PinListFilters = {
      cid: input.cid,
      name: input.name,
      status: input.status,
      before: input.before,
      after: input.after,
      limit: input.limit,
      offset: input.offset,
      owner: input.owner
    };

    const list = this.repository.list(filters);
    return {
      count: list.totalCount,
      results: list.rows
    };
  }

  async uploadContent(content: Blob, filename: string): Promise<string> {
    return this.ipfsClient.addContent(content, filename);
  }

  async getContent(cid: string): Promise<GatewayContentResult> {
    const cached = this.contentCache?.get(cid);
    if (cached) {
      return {
        cid,
        content: cached.content,
        contentType: cached.contentType,
        filename: cached.filename,
        cacheHit: true
      };
    }

    const content = await this.ipfsClient.cat(cid, { maxBytes: this.maxGatewayContentSizeBytes });

    const pin = this.repository.findLatestByCid(cid);
    const filename = pin?.name ?? null;
    const meta = pin?.meta ?? {};
    const contentType = resolveContentType(content, filename, meta);

    this.contentCache?.set({
      cid,
      content,
      contentType,
      filename,
      size: content.byteLength
    });

    return {
      cid,
      content,
      contentType,
      filename,
      cacheHit: false
    };
  }
}

export function toPinStatusResponse(record: StoredPinRecord): PinStatusResponse {
  return {
    requestid: record.requestid,
    status: record.status,
    created: record.created,
    pin: {
      cid: record.cid,
      name: record.name ?? undefined,
      origins: record.origins,
      meta: record.meta
    },
    delegates: record.delegates,
    info: {
      ...record.info,
      ...(record.expires_at ? { expiresAt: record.expires_at } : {})
    }
  };
}
