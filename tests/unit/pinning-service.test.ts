import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../../src/db';
import { PinRepository } from '../../src/repositories/pin-repository';
import type { IpfsClient } from '../../src/services/ipfs-rpc-client';
import { PinningService } from '../../src/services/pinning-service';

describe('PinningService', () => {
  const wallet = '0x1111111111111111111111111111111111111111';
  const otherWallet = '0x2222222222222222222222222222222222222222';

  let db: Database.Database;
  let repository: PinRepository;
  let ipfsClient: IpfsClient & {
    pinAdd: ReturnType<typeof vi.fn>;
    pinRm: ReturnType<typeof vi.fn>;
    addContent: ReturnType<typeof vi.fn>;
    cat: ReturnType<typeof vi.fn>;
  };
  let service: PinningService;
  let replicaA: { pinAdd: ReturnType<typeof vi.fn>; pinRm: ReturnType<typeof vi.fn> };
  let replicaB: { pinAdd: ReturnType<typeof vi.fn>; pinRm: ReturnType<typeof vi.fn> };

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    db = createDb(':memory:');
    repository = new PinRepository(db);
    ipfsClient = {
      pinAdd: vi.fn().mockResolvedValue(undefined),
      pinRm: vi.fn().mockResolvedValue(undefined),
      addContent: vi.fn().mockResolvedValue('bafy-upload'),
      cat: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
    };
    replicaA = {
      pinAdd: vi.fn().mockResolvedValue(undefined),
      pinRm: vi.fn().mockResolvedValue(undefined)
    };
    replicaB = {
      pinAdd: vi.fn().mockResolvedValue(undefined),
      pinRm: vi.fn().mockResolvedValue(undefined)
    };

    service = new PinningService(repository, ipfsClient, 'http://localhost:8080/ipfs');
  });

  it('creates and marks a pin as pinned on success', async () => {
    const result = await service.createPin({ cid: 'bafy123', name: 'asset', owner: wallet });

    expect(result.cid).toBe('bafy123');
    expect(result.status).toBe('pinned');
    expect(result.owner).toBe(wallet);
    expect(ipfsClient.pinAdd).toHaveBeenCalledWith('bafy123');
  });

  it('marks pin as failed when ipfs pin add fails', async () => {
    ipfsClient.pinAdd.mockRejectedValueOnce(new Error('pin failed'));

    const result = await service.createPin({ cid: 'bafy123', owner: wallet });

    expect(result.status).toBe('failed');
    expect(result.info).toHaveProperty('error');
  });

  it('replaces an existing pin', async () => {
    const created = await service.createPin({ cid: 'bafy-old', owner: wallet });

    const replaced = await service.replacePin(created.requestid, { cid: 'bafy-new', name: 'new-name' }, wallet);

    expect(replaced.cid).toBe('bafy-new');
    expect(replaced.name).toBe('new-name');
    expect(ipfsClient.pinRm).toHaveBeenCalledWith('bafy-old');
    expect(ipfsClient.pinAdd).toHaveBeenCalledWith('bafy-new');
  });

  it('removes a pin', async () => {
    const created = await service.createPin({ cid: 'bafy-remove', owner: wallet });

    await service.removePin(created.requestid, wallet);

    expect(ipfsClient.pinRm).toHaveBeenCalledWith('bafy-remove');
    expect(() => service.getPin(created.requestid, wallet)).toThrow('not found');
  });

  it('hides pins owned by a different wallet', async () => {
    const created = await service.createPin({ cid: 'bafy-private', owner: wallet });

    expect(() => service.getPin(created.requestid, otherWallet)).toThrow('not found');
    await expect(service.removePin(created.requestid, otherWallet)).rejects.toThrow('not found');
  });

  it('pins replicas and includes replication metadata', async () => {
    service = new PinningService(repository, ipfsClient, 'http://localhost:8080/ipfs', {
      replicas: [
        { name: 'replica-a', delegateUrl: 'https://replica-a.example/ipfs', client: replicaA },
        { name: 'replica-b', delegateUrl: 'https://replica-b.example/ipfs', client: replicaB }
      ]
    });

    const created = await service.createPin({ cid: 'bafy-replica', owner: wallet });

    expect(created.status).toBe('pinned');
    expect(created.delegates).toEqual([
      'http://localhost:8080/ipfs',
      'https://replica-a.example/ipfs',
      'https://replica-b.example/ipfs'
    ]);
    expect(replicaA.pinAdd).toHaveBeenCalledWith('bafy-replica');
    expect(replicaB.pinAdd).toHaveBeenCalledWith('bafy-replica');
    expect(created.info).toEqual({
      replication: {
        replicas: [
          { target: 'replica-a', status: 'pinned' },
          { target: 'replica-b', status: 'pinned' }
        ],
        successfulReplicas: 2,
        failedReplicas: 0
      }
    });
  });

  it('keeps pin status pinned when a replica fails', async () => {
    replicaB.pinAdd.mockRejectedValueOnce(new Error('replica outage'));

    service = new PinningService(repository, ipfsClient, 'http://localhost:8080/ipfs', {
      replicas: [
        { name: 'replica-a', client: replicaA },
        { name: 'replica-b', client: replicaB }
      ]
    });

    const created = await service.createPin({ cid: 'bafy-partial', owner: wallet });

    expect(created.status).toBe('pinned');
    expect(created.info).toEqual({
      replication: {
        replicas: [
          { target: 'replica-a', status: 'pinned' },
          { target: 'replica-b', status: 'failed', error: 'replica outage' }
        ],
        successfulReplicas: 1,
        failedReplicas: 1
      }
    });
  });

  it('uses the canonical cid owner for retrieval paywall resolution', async () => {
    await service.createPin({
      cid: 'bafy-premium',
      owner: wallet,
      meta: { retrievalPrice: '0.002' }
    });
    await service.createPin({
      cid: 'bafy-premium',
      owner: otherWallet,
      meta: { retrievalPrice: '0.009' }
    });

    expect(service.resolveRetrievalPaymentPolicy('bafy-premium')).toEqual({
      cid: 'bafy-premium',
      payTo: wallet,
      priceUsd: 0.002
    });
  });

  it('lets the canonical cid owner update retrieval pricing later', async () => {
    await service.createPin({
      cid: 'bafy-price-update',
      owner: wallet,
      meta: { retrievalPrice: '0.002' }
    });
    await service.createPin({
      cid: 'bafy-price-update',
      owner: wallet,
      meta: { retrievalPrice: '0.003' }
    });

    expect(service.resolveRetrievalPaymentPolicy('bafy-price-update')).toEqual({
      cid: 'bafy-price-update',
      payTo: wallet,
      priceUsd: 0.003
    });
  });

  it('uses the successful pin time when claiming ownership for replacements', async () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const created = await service.createPin({ cid: 'bafy-old', owner: wallet });

    vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'));
    await service.replacePin(created.requestid, { cid: 'bafy-new' }, wallet);

    const cidOwner = db
      .prepare('SELECT cid, owner, created FROM cid_owners WHERE cid = ?')
      .get('bafy-new') as { cid: string; owner: string; created: string } | undefined;

    expect(cidOwner).toEqual({
      cid: 'bafy-new',
      owner: wallet,
      created: '2026-01-01T00:10:00.000Z'
    });
  });

  it('uses a unique historical owner when cid_owners is missing', async () => {
    await service.createPin({
      cid: 'bafy-legacy-single-owner',
      owner: wallet,
      meta: { retrievalPrice: '0.002' }
    });
    await service.createPin({
      cid: 'bafy-legacy-single-owner',
      owner: wallet,
      meta: { retrievalPrice: '0.003' }
    });

    db.prepare('DELETE FROM cid_owners WHERE cid = ?').run('bafy-legacy-single-owner');

    expect(service.resolveRetrievalPaymentPolicy('bafy-legacy-single-owner')).toEqual({
      cid: 'bafy-legacy-single-owner',
      payTo: wallet,
      priceUsd: 0.003
    });
  });

  it('does not guess a legacy owner when history is ambiguous', async () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const created = await service.createPin({
      cid: 'bafy-before-replace',
      owner: wallet,
      meta: { retrievalPrice: '0.001' }
    });

    vi.setSystemTime(new Date('2026-01-01T00:05:00.000Z'));
    await service.createPin({
      cid: 'bafy-legacy-ambiguous',
      owner: otherWallet,
      meta: { retrievalPrice: '0.009' }
    });

    vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'));
    await service.replacePin(
      created.requestid,
      { cid: 'bafy-legacy-ambiguous', meta: { retrievalPrice: '0.001' } },
      wallet
    );

    db.prepare('DELETE FROM cid_owners WHERE cid = ?').run('bafy-legacy-ambiguous');

    expect(service.resolveRetrievalPaymentPolicy('bafy-legacy-ambiguous')).toBeNull();
  });
});
