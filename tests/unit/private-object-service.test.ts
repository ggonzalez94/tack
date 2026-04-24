import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../../src/db';
import { PrivateObjectRepository } from '../../src/repositories/private-object-repository';
import { LocalPrivateObjectStorage } from '../../src/services/private-object-storage';
import { PrivateObjectService } from '../../src/services/private-object-service';

const owner = '0x1111111111111111111111111111111111111111';
const otherOwner = '0x2222222222222222222222222222222222222222';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe('PrivateObjectService', () => {
  let db: Database.Database;
  let tempDir: string;
  let repository: PrivateObjectRepository;
  let storage: LocalPrivateObjectStorage;
  let service: PrivateObjectService;

  beforeEach(async () => {
    db = createDb(':memory:');
    tempDir = await mkdtemp(join(tmpdir(), 'tack-private-objects-'));
    repository = new PrivateObjectRepository(db);
    storage = new LocalPrivateObjectStorage(tempDir);
    service = new PrivateObjectService(repository, storage);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('stores and reads a paid private object for the owner', async () => {
    const created = await service.createObject({
      owner,
      name: 'memory.json',
      contentType: 'application/json',
      meta: { purpose: 'memory' },
      content: bytes('{"ok":true}').buffer,
      durationMonths: 1,
      paymentStatus: 'paid'
    });

    const metadata = service.getObject(created.id, owner);
    const content = await service.getObjectContent(created.id, owner);

    expect(metadata.id).toBe(created.id);
    expect(metadata.name).toBe('memory.json');
    expect(metadata.meta).toEqual({ purpose: 'memory' });
    expect(content.content).toEqual(bytes('{"ok":true}').buffer);
  });

  it('hides private objects from other wallets', async () => {
    const created = await service.createObject({
      owner,
      content: bytes('secret').buffer,
      contentType: 'text/plain',
      paymentStatus: 'paid'
    });

    expect(() => service.getObject(created.id, otherOwner)).toThrow('not found');
    await expect(service.getObjectContent(created.id, otherOwner)).rejects.toThrow('not found');
  });

  it('does not serve pending x402 objects', async () => {
    const created = await service.createObject({
      owner,
      content: bytes('pending').buffer,
      contentType: 'text/plain',
      paymentStatus: 'pending'
    });

    expect(() => service.getObject(created.id, owner)).toThrow('not found');
  });

  it('marks pending objects paid and then serves them', async () => {
    const created = await service.createObject({
      owner,
      content: bytes('pending').buffer,
      contentType: 'text/plain',
      paymentStatus: 'pending'
    });

    service.markPaid(created.id);

    expect(service.getObject(created.id, owner).id).toBe(created.id);
  });

  it('deletes stored bytes when an object is removed', async () => {
    const created = await service.createObject({
      owner,
      content: bytes('delete me').buffer,
      contentType: 'text/plain',
      paymentStatus: 'paid'
    });

    await service.deleteObject(created.id, owner);

    await expect(storage.get(created.storage_key)).rejects.toThrow();
  });

  it('extends object expiration when renewed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));
    const created = await service.createObject({
      owner,
      content: bytes('renew').buffer,
      contentType: 'text/plain',
      durationMonths: 1,
      paymentStatus: 'paid'
    });

    vi.setSystemTime(new Date('2026-04-24T12:00:00.000Z'));
    const renewed = service.renewObject(created.id, owner, 6);

    expect(renewed.expires_at).toBe('2026-10-24T12:00:00.000Z');
  });

  it('renews against the accepted request time when persistence is deferred', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));
    const created = await service.createObject({
      owner,
      content: bytes('renew').buffer,
      contentType: 'text/plain',
      durationMonths: 1,
      paymentStatus: 'paid'
    });

    const acceptedAt = new Date('2026-05-23T11:59:59.000Z');
    vi.setSystemTime(new Date('2026-05-23T12:00:01.000Z'));
    const renewed = service.renewObject(created.id, owner, 6, acceptedAt);

    expect(renewed.expires_at).toBe('2026-11-23T11:59:59.000Z');
  });

  it('lists only paid visible objects for the owner', async () => {
    await service.createObject({
      owner,
      name: 'a.txt',
      content: bytes('a').buffer,
      contentType: 'text/plain',
      paymentStatus: 'paid'
    });
    await service.createObject({
      owner,
      name: 'pending.txt',
      content: bytes('pending').buffer,
      contentType: 'text/plain',
      paymentStatus: 'pending'
    });
    await service.createObject({
      owner: otherOwner,
      name: 'other.txt',
      content: bytes('other').buffer,
      contentType: 'text/plain',
      paymentStatus: 'paid'
    });

    const listed = service.listObjects({ owner, limit: 10, offset: 0 });

    expect(listed.count).toBe(1);
    expect(listed.results[0]?.name).toBe('a.txt');
  });
});
