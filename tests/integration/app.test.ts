import { createHmac } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { createDb } from '../../src/db';
import { GatewayTimeoutError, UpstreamServiceError } from '../../src/lib/errors';
import { PinRepository } from '../../src/repositories/pin-repository';
import type { IpfsClient } from '../../src/services/ipfs-rpc-client';
import { GatewayContentCache } from '../../src/services/content-cache';
import { PinningService } from '../../src/services/pinning-service';
import { InMemoryRateLimiter } from '../../src/services/rate-limiter';

const walletA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const walletB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const walletAuthSecret = 'integration-wallet-auth-secret';

function createPaymentSignature(walletAddress: string): string {
  const payload = {
    x402Version: 2,
    accepted: {},
    payload: {
      authorization: {
        from: walletAddress
      }
    }
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createWalletAuthToken(walletAddress: string, options?: { expiresAt?: number }): string {
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = encodeBase64Url(
    JSON.stringify({
      sub: walletAddress,
      iat: Math.floor(Date.now() / 1000),
      exp: options?.expiresAt ?? Math.floor(Date.now() / 1000) + 3600
    })
  );
  const signature = createHmac('sha256', walletAuthSecret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${header}.${payload}.${signature}`;
}

function ownerAuthHeaders(walletAddress: string): Record<string, string> {
  return {
    authorization: `Bearer ${createWalletAuthToken(walletAddress)}`
  };
}

describe('API integration', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let service: PinningService;
  let ipfsClient: IpfsClient & {
    pinAdd: ReturnType<typeof vi.fn>;
    pinRm: ReturnType<typeof vi.fn>;
    addContent: ReturnType<typeof vi.fn>;
    cat: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    db = createDb(':memory:');
    const repository = new PinRepository(db);
    ipfsClient = {
      pinAdd: vi.fn().mockResolvedValue(undefined),
      pinRm: vi.fn().mockResolvedValue(undefined),
      addContent: vi.fn().mockResolvedValue('bafy-uploaded-cid'),
      cat: vi.fn().mockResolvedValue(new TextEncoder().encode('hello world').buffer)
    };

    service = new PinningService(repository, ipfsClient, 'http://localhost:8080/ipfs', {
      contentCache: new GatewayContentCache(10 * 1024 * 1024),
      maxGatewayContentSizeBytes: 10 * 1024 * 1024
    });
    app = createApp({
      pinningService: service,
      walletAuthTokenSecret: walletAuthSecret
    });
  });

  it('creates and fetches a pin request', async () => {
    const createRes = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'payment-signature': createPaymentSignature(walletA) },
        body: JSON.stringify({ cid: 'bafy-test', name: 'test-pin', meta: { env: 'test' } })
      })
    );

    expect(createRes.status).toBe(202);
    const created = (await createRes.json()) as { requestid: string; pin: { cid: string } };
    expect(created.pin.cid).toBe('bafy-test');

    const getRes = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        headers: ownerAuthHeaders(walletA)
      })
    );
    expect(getRes.status).toBe(200);

    const fetched = (await getRes.json()) as { requestid: string; pin: { cid: string } };
    expect(fetched.requestid).toBe(created.requestid);
  });

  it('lists pins with count/results', async () => {
    await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'payment-signature': createPaymentSignature(walletA) },
        body: JSON.stringify({ cid: 'bafy-a' })
      })
    );

    const listRes = await app.request(
      new Request('http://localhost/pins?limit=10&offset=0', {
        headers: ownerAuthHeaders(walletA)
      })
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { count: number; results: Array<{ pin: { cid: string } }> };
    expect(list.count).toBe(1);
    expect(list.results[0].pin.cid).toBe('bafy-a');
  });

  it('replaces a pin request', async () => {
    const createRes = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'payment-signature': createPaymentSignature(walletA) },
        body: JSON.stringify({ cid: 'bafy-original', name: 'original.txt' })
      })
    );
    expect(createRes.status).toBe(202);
    const created = (await createRes.json()) as { requestid: string };

    const replaceRes = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...ownerAuthHeaders(walletA)
        },
        body: JSON.stringify({ cid: 'bafy-replaced', name: 'replaced.txt' })
      })
    );

    expect(replaceRes.status).toBe(202);
    const replaced = (await replaceRes.json()) as { pin: { cid: string; name?: string } };
    expect(replaced.pin.cid).toBe('bafy-replaced');
    expect(replaced.pin.name).toBe('replaced.txt');
  });

  it('applies list filters for cid, name, status, before, and after', async () => {
    const pinnedRes = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'payment-signature': createPaymentSignature(walletA) },
        body: JSON.stringify({ cid: 'bafy-filter-pinned', name: 'alpha.txt' })
      })
    );
    expect(pinnedRes.status).toBe(202);

    ipfsClient.pinAdd.mockRejectedValueOnce(new Error('forced failure'));
    const failedRes = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'payment-signature': createPaymentSignature(walletA) },
        body: JSON.stringify({ cid: 'bafy-filter-failed', name: 'beta.txt' })
      })
    );
    expect(failedRes.status).toBe(202);

    const byCid = await app.request(
      new Request('http://localhost/pins?cid=bafy-filter-pinned', {
        headers: ownerAuthHeaders(walletA)
      })
    );
    expect(byCid.status).toBe(200);
    const cidBody = (await byCid.json()) as { count: number; results: Array<{ pin: { cid: string } }> };
    expect(cidBody.count).toBe(1);
    expect(cidBody.results[0]?.pin.cid).toBe('bafy-filter-pinned');

    const byName = await app.request(
      new Request('http://localhost/pins?name=beta.txt', {
        headers: ownerAuthHeaders(walletA)
      })
    );
    expect(byName.status).toBe(200);
    const nameBody = (await byName.json()) as { count: number; results: Array<{ pin: { name?: string } }> };
    expect(nameBody.count).toBe(1);
    expect(nameBody.results[0]?.pin.name).toBe('beta.txt');

    const byStatus = await app.request(
      new Request('http://localhost/pins?status=failed', {
        headers: ownerAuthHeaders(walletA)
      })
    );
    expect(byStatus.status).toBe(200);
    const statusBody = (await byStatus.json()) as { count: number; results: Array<{ status: string }> };
    expect(statusBody.count).toBe(1);
    expect(statusBody.results[0]?.status).toBe('failed');

    const beforePast = await app.request(
      new Request('http://localhost/pins?before=1970-01-01T00:00:00.000Z', {
        headers: ownerAuthHeaders(walletA)
      })
    );
    expect(beforePast.status).toBe(200);
    expect((await beforePast.json()) as { count: number }).toEqual({ count: 0, results: [] });

    const afterFuture = await app.request(
      new Request('http://localhost/pins?after=9999-01-01T00:00:00.000Z', {
        headers: ownerAuthHeaders(walletA)
      })
    );
    expect(afterFuture.status).toBe(200);
    expect((await afterFuture.json()) as { count: number }).toEqual({ count: 0, results: [] });
  });

  it('returns 400 for invalid list filters', async () => {
    const invalidStatus = await app.request(
      new Request('http://localhost/pins?status=invalid', {
        headers: ownerAuthHeaders(walletA)
      })
    );
    expect(invalidStatus.status).toBe(400);
    expect(await invalidStatus.json()).toEqual({ error: 'Invalid status filter' });

    const invalidLimit = await app.request(
      new Request('http://localhost/pins?limit=not-a-number', {
        headers: ownerAuthHeaders(walletA)
      })
    );
    expect(invalidLimit.status).toBe(400);
    expect(await invalidLimit.json()).toEqual({ error: 'limit must be an integer between 1 and 1000' });
  });

  it('returns 401 for anonymous pin list access', async () => {
    const response = await app.request('http://localhost/pins');
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('authenticated wallet identity is required');
  });

  it('returns 401 for invalid owner auth token', async () => {
    const response = await app.request(
      new Request('http://localhost/pins', {
        headers: {
          authorization: 'Bearer not-a-valid-token'
        }
      })
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toContain('invalid wallet auth token');
  });

  it('uploads and fetches IPFS content', async () => {
    const form = new FormData();
    form.append('file', new File([new TextEncoder().encode('hello')], 'hello.txt'));

    const uploadRes = await app.request(
      new Request('http://localhost/upload', {
        method: 'POST',
        headers: { 'payment-signature': createPaymentSignature(walletA) },
        body: form
      })
    );

    expect(uploadRes.status).toBe(201);
    const uploadBody = (await uploadRes.json()) as { cid: string };
    expect(uploadBody.cid).toBe('bafy-uploaded-cid');

    const getRes = await app.request('http://localhost/ipfs/bafy-uploaded-cid');
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('x-cache')).toBe('MISS');
    expect(getRes.headers.get('etag')).toBe('"bafy-uploaded-cid"');
    const bytes = new Uint8Array(await getRes.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toBe('hello world');
  });

  it('serves gateway content with content-type detection, range support, and cache hits', async () => {
    await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'payment-signature': createPaymentSignature(walletA) },
        body: JSON.stringify({ cid: 'bafy-text', name: 'notes.txt', meta: { retrievalPrice: '0.002' } })
      })
    );

    const first = await app.request('http://localhost/ipfs/bafy-text');
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toContain('text/plain');
    expect(first.headers.get('x-cache')).toBe('MISS');
    expect(first.headers.get('cache-control')).toContain('immutable');
    expect(first.headers.get('etag')).toBe('"bafy-text"');

    const second = await app.request('http://localhost/ipfs/bafy-text');
    expect(second.status).toBe(200);
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(ipfsClient.cat).toHaveBeenCalledTimes(1);

    const range = await app.request(
      new Request('http://localhost/ipfs/bafy-text', {
        headers: { range: 'bytes=0-4' }
      })
    );
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe('bytes 0-4/11');
    expect(await range.text()).toBe('hello');

    const notModified = await app.request(
      new Request('http://localhost/ipfs/bafy-text', {
        headers: { 'if-none-match': '"bafy-text"' }
      })
    );
    expect(notModified.status).toBe(304);
  });

  it('serves an AgentCard endpoint', async () => {
    const response = await app.request('http://localhost/.well-known/agent.json');
    expect(response.status).toBe(200);

    const agentCard = (await response.json()) as {
      endpoint: string;
      protocol: string;
      capabilities: { pinningApi: { endpoints: string[] } };
      pricing: { retrieval: { metadataField: string } };
    };

    expect(agentCard.protocol).toBe('a2a');
    expect(agentCard.endpoint).toBe('http://localhost');
    expect(agentCard.capabilities.pinningApi.endpoints).toContain('/pins');
    expect(agentCard.pricing.retrieval.metadataField).toBe('meta.retrievalPrice');
  });

  it('uses forwarded host and proto in the AgentCard when trustProxy is enabled', async () => {
    const trustedProxyApp = createApp({
      pinningService: service,
      trustProxy: true
    });

    const response = await trustedProxyApp.request(
      new Request('http://localhost/.well-known/agent.json', {
        headers: {
          'x-forwarded-host': 'tack-api-production.up.railway.app',
          'x-forwarded-proto': 'https'
        }
      })
    );

    expect(response.status).toBe(200);
    const agentCard = (await response.json()) as { endpoint: string };
    expect(agentCard.endpoint).toBe('https://tack-api-production.up.railway.app');
  });

  it('rejects uploads over configured upload size limit', async () => {
    const strictApp = createApp({ pinningService: service, uploadMaxSizeBytes: 4 });
    const form = new FormData();
    form.append('file', new File([new TextEncoder().encode('hello')], 'hello.txt'));

    const uploadRes = await strictApp.request(
      new Request('http://localhost/upload', {
        method: 'POST',
        headers: { 'payment-signature': createPaymentSignature(walletA) },
        body: form
      })
    );

    expect(uploadRes.status).toBe(413);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    const limitedApp = createApp({
      pinningService: service,
      rateLimiter: new InMemoryRateLimiter(1, 60_000)
    });

    const first = await limitedApp.request(
      new Request('http://localhost/health', {
        headers: { 'x-wallet-address': walletA }
      })
    );
    expect(first.status).toBe(200);

    const second = await limitedApp.request(
      new Request('http://localhost/health', {
        headers: { 'x-wallet-address': walletA }
      })
    );
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBeTruthy();
  });

  it('does not trust forwarded IP headers by default', async () => {
    const limitedApp = createApp({
      pinningService: service,
      rateLimiter: new InMemoryRateLimiter(1, 60_000)
    });

    const first = await limitedApp.request(
      new Request('http://localhost/health', {
        headers: { 'x-forwarded-for': '198.51.100.10' }
      })
    );
    expect(first.status).toBe(200);

    const second = await limitedApp.request(
      new Request('http://localhost/health', {
        headers: { 'x-forwarded-for': '198.51.100.11' }
      })
    );
    expect(second.status).toBe(429);
  });

  it('uses forwarded IP headers when trustProxy is enabled', async () => {
    const trustedProxyApp = createApp({
      pinningService: service,
      rateLimiter: new InMemoryRateLimiter(1, 60_000),
      trustProxy: true
    });

    const first = await trustedProxyApp.request(
      new Request('http://localhost/health', {
        headers: { 'x-forwarded-for': '198.51.100.10' }
      })
    );
    expect(first.status).toBe(200);

    const second = await trustedProxyApp.request(
      new Request('http://localhost/health', {
        headers: { 'x-forwarded-for': '198.51.100.11' }
      })
    );
    expect(second.status).toBe(200);
  });

  it('returns 400 for invalid JSON on pin creation and replacement', async () => {
    const createResponse = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payment-signature': createPaymentSignature(walletA)
        },
        body: '{"cid":"bafy-bad-json"'
      })
    );
    expect(createResponse.status).toBe(400);
    expect(await createResponse.json()).toEqual({ error: 'Request body must be valid JSON' });

    const replaceResponse = await app.request(
      new Request('http://localhost/pins/some-request-id', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...ownerAuthHeaders(walletA)
        },
        body: '{"cid":"bafy-bad-json"'
      })
    );
    expect(replaceResponse.status).toBe(400);
    expect(await replaceResponse.json()).toEqual({ error: 'Request body must be valid JSON' });
  });

  it('reports healthy status when IPFS health probe succeeds', async () => {
    const healthCheck = vi.fn().mockResolvedValue(undefined);
    const healthApp = createApp({
      pinningService: service,
      healthCheck
    });

    const response = await healthApp.request('http://localhost/health');

    expect(response.status).toBe(200);
    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({
      status: 'ok',
      dependencies: {
        ipfs: 'ok'
      }
    });
  });

  it('reports degraded status when IPFS health probe fails', async () => {
    const healthCheck = vi.fn().mockRejectedValue(new UpstreamServiceError('IPFS unavailable'));
    const healthApp = createApp({
      pinningService: service,
      healthCheck
    });

    const response = await healthApp.request('http://localhost/health');

    expect(response.status).toBe(503);
    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({
      status: 'degraded',
      dependencies: {
        ipfs: 'unreachable'
      }
    });
  });

  it('returns 504 when IPFS content retrieval times out', async () => {
    ipfsClient.cat.mockRejectedValueOnce(new GatewayTimeoutError('IPFS request timed out after 60000ms'));

    const response = await app.request('http://localhost/ipfs/bafy-timeout');
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'IPFS request timed out' });
  });

  it('sanitizes upstream IPFS errors', async () => {
    ipfsClient.cat.mockRejectedValueOnce(new UpstreamServiceError('IPFS RPC call failed (/api/v0/cat): dial tcp ...'));

    const response = await app.request('http://localhost/ipfs/bafy-error');
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('IPFS upstream request failed');
  });

  it('deletes pin request', async () => {
    const createRes = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'payment-signature': createPaymentSignature(walletA) },
        body: JSON.stringify({ cid: 'bafy-remove-me' })
      })
    );

    const created = (await createRes.json()) as { requestid: string };

    const deleteRes = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        method: 'DELETE',
        headers: ownerAuthHeaders(walletA)
      })
    );

    expect(deleteRes.status).toBe(202);

    const getRes = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        headers: ownerAuthHeaders(walletA)
      })
    );
    expect(getRes.status).toBe(404);
  });

  it('rejects spoofed x-wallet-address headers on owner endpoints', async () => {
    const createRes = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'payment-signature': createPaymentSignature(walletA) },
        body: JSON.stringify({ cid: 'bafy-spoof-target' })
      })
    );
    const created = (await createRes.json()) as { requestid: string };

    const spoofedRead = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        headers: { 'x-wallet-address': walletA }
      })
    );
    expect(spoofedRead.status).toBe(401);

    const spoofedDelete = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        method: 'DELETE',
        headers: { 'x-wallet-address': walletA }
      })
    );
    expect(spoofedDelete.status).toBe(401);
  });

  it('enforces wallet ownership when listing and deleting pins', async () => {
    const createRes = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'payment-signature': createPaymentSignature(walletA) },
        body: JSON.stringify({ cid: 'bafy-owned' })
      })
    );

    const created = (await createRes.json()) as { requestid: string };

    const listAsOther = await app.request(
      new Request('http://localhost/pins?limit=10&offset=0', {
        headers: ownerAuthHeaders(walletB)
      })
    );
    expect(listAsOther.status).toBe(200);
    const listed = (await listAsOther.json()) as { count: number };
    expect(listed.count).toBe(0);

    const getAsOther = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        headers: ownerAuthHeaders(walletB)
      })
    );
    expect(getAsOther.status).toBe(404);

    const deleteAsOther = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        method: 'DELETE',
        headers: ownerAuthHeaders(walletB)
      })
    );
    expect(deleteAsOther.status).toBe(404);
  });
});
