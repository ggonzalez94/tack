import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { FacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { createApp } from '../../src/app';
import { createDb } from '../../src/db';
import { GatewayTimeoutError, UpstreamServiceError } from '../../src/lib/errors';
import { PinRepository } from '../../src/repositories/pin-repository';
import type { IpfsClient } from '../../src/services/ipfs-rpc-client';
import { GatewayContentCache } from '../../src/services/content-cache';
import { PinningService } from '../../src/services/pinning-service';
import { InMemoryRateLimiter } from '../../src/services/rate-limiter';
import {
  createX402PaymentMiddleware,
  WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER,
  WALLET_AUTH_TOKEN_RESPONSE_HEADER,
  type WalletAuthConfig,
  type X402PaymentConfig
} from '../../src/services/x402';

const walletA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const walletB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const walletAuthConfig: WalletAuthConfig = {
  secret: '0123456789abcdef0123456789abcdef',
  issuer: 'tack',
  audience: 'tack-owner-api',
  ttlSeconds: 900
};

const paymentConfig: X402PaymentConfig = {
  facilitatorUrl: 'http://localhost:9999',
  network: 'eip155:167000',
  payTo: '0x1111111111111111111111111111111111111111',
  usdcAssetAddress: '0x2222222222222222222222222222222222222222',
  usdcAssetDecimals: 6,
  usdcDomainName: 'USD Coin',
  usdcDomainVersion: '2',
  ratePerGbMonthUsd: 0.10,
  minPriceUsd: 0.001,
  maxPriceUsd: 50.0,
  defaultDurationMonths: 1,
  maxDurationMonths: 24
};

function extractWallet(paymentPayload: PaymentPayload): string {
  const payload = paymentPayload.payload;
  const authorization = payload.authorization as Record<string, unknown> | undefined;
  const from = authorization?.from;

  if (typeof from === 'string') {
    return from.toLowerCase();
  }

  return walletA;
}

const mockFacilitator: FacilitatorClient = {
  verify(paymentPayload: PaymentPayload): Promise<{ isValid: boolean; payer: string }> {
    return Promise.resolve({ isValid: true, payer: extractWallet(paymentPayload) });
  },
  settle(paymentPayload: PaymentPayload, requirements: PaymentRequirements): Promise<{
    success: boolean;
    transaction: string;
    network: string;
    payer: string;
  }> {
    return Promise.resolve({
      success: true,
      transaction: '0xtest',
      network: requirements.network,
      payer: extractWallet(paymentPayload)
    });
  },
  getSupported(): Promise<{
    kinds: Array<{ x402Version: number; scheme: string; network: string }>;
    extensions: string[];
    signers: Record<string, string[]>;
  }> {
    return Promise.resolve({
      kinds: [{ x402Version: 2, scheme: 'exact', network: paymentConfig.network }],
      extensions: [],
      signers: { [paymentConfig.network]: [paymentConfig.payTo] }
    });
  }
};

function createInvalidVerificationFacilitator(invalidReason = 'invalid_payment'): FacilitatorClient {
  return {
    ...mockFacilitator,
    verify(): Promise<{ isValid: false; invalidReason: string; payer: string }> {
      return Promise.resolve({
        isValid: false,
        invalidReason,
        payer: walletA
      });
    }
  };
}

function createSettlementFailureFacilitator(
  errorReason = 'settle failed',
  errorMessage = 'The payment could not be settled on-chain.'
): FacilitatorClient {
  return {
    ...mockFacilitator,
    settle(paymentPayload: PaymentPayload, requirements: PaymentRequirements): Promise<{
      success: false;
      errorReason: string;
      errorMessage: string;
      transaction: string;
      network: string;
      payer: string;
    }> {
      return Promise.resolve({
        success: false,
        errorReason,
        errorMessage,
        transaction: '',
        network: requirements.network,
        payer: extractWallet(paymentPayload)
      });
    }
  };
}

function ownerAuthHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`
  };
}

function extractIssuedOwnerToken(response: Response): string {
  const token = response.headers.get(WALLET_AUTH_TOKEN_RESPONSE_HEADER);
  expect(token).toBeTruthy();
  expect(response.headers.get(WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER)).toBeTruthy();
  return token!;
}

function buildPaymentPayload(walletAddress: string, paymentRequiredHeader: string): string {
  const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
  const accepted = paymentRequired.accepts[0];

  const paymentPayload: PaymentPayload = {
    x402Version: paymentRequired.x402Version,
    accepted,
    payload: {
      authorization: {
        from: walletAddress,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: '0',
        validBefore: '9999999999',
        nonce: `0x${'0'.repeat(64)}`
      },
      signature: `0x${'1'.repeat(130)}`
    }
  };

  return encodePaymentSignatureHeader(paymentPayload);
}

function buildForgedPaymentSignatureHeader(walletAddress: string): string {
  return Buffer.from(JSON.stringify({
    payload: {
      authorization: {
        from: walletAddress
      }
    }
  })).toString('base64');
}

async function paidRequest(
  app: ReturnType<typeof createApp>,
  url: string,
  walletAddress: string,
  createInit: () => RequestInit
): Promise<Response> {
  const unpaid = await app.request(new Request(url, createInit()));
  expect(unpaid.status).toBe(402);
  const paymentRequiredHeader = unpaid.headers.get('payment-required');
  expect(paymentRequiredHeader).toBeTruthy();

  const paidInit = createInit();
  const headers = new Headers(paidInit.headers);
  headers.set('payment-signature', buildPaymentPayload(walletAddress, paymentRequiredHeader!));

  return app.request(
    new Request(url, {
      ...paidInit,
      headers
    })
  );
}

describe('API integration', () => {
  let db: Database.Database;
  let service: PinningService;
  let app: ReturnType<typeof createApp>;
  let ipfsClient: IpfsClient & {
    pinAdd: ReturnType<typeof vi.fn>;
    pinRm: ReturnType<typeof vi.fn>;
    addContent: ReturnType<typeof vi.fn>;
    cat: ReturnType<typeof vi.fn>;
  };

  const buildApp = (overrides?: Partial<Parameters<typeof createApp>[0]>): ReturnType<typeof createApp> => {
    const paymentMiddleware = createX402PaymentMiddleware(paymentConfig, mockFacilitator, {
      resolveRetrievalPayment: (cid) => {
        const policy = service.resolveRetrievalPaymentPolicy(cid);
        if (!policy) {
          return null;
        }

        return {
          payTo: policy.payTo,
          priceUsd: policy.priceUsd
        };
      }
    });

    return createApp({
      pinningService: service,
      paymentMiddleware,
      walletAuth: walletAuthConfig,
      defaultDurationMonths: 1,
      maxDurationMonths: 24,
      ...overrides
    });
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
    app = buildApp();
  });

  it('creates and fetches a pin request', async () => {
    const createRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-test', name: 'test-pin', meta: { env: 'test' } })
    }));

    expect(createRes.status).toBe(202);
    const ownerToken = extractIssuedOwnerToken(createRes);
    const created = (await createRes.json()) as { requestid: string; pin: { cid: string } };
    expect(created.pin.cid).toBe('bafy-test');

    const getRes = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(getRes.status).toBe(200);

    const fetched = (await getRes.json()) as { requestid: string; pin: { cid: string } };
    expect(fetched.requestid).toBe(created.requestid);
  });

  it('lists pins with count/results', async () => {
    const createRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-a' })
    }));
    const ownerToken = extractIssuedOwnerToken(createRes);

    const listRes = await app.request(
      new Request('http://localhost/pins?limit=10&offset=0', {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { count: number; results: Array<{ pin: { cid: string } }> };
    expect(list.count).toBe(1);
    expect(list.results[0].pin.cid).toBe('bafy-a');
  });

  it('replaces a pin request', async () => {
    const createRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-original', name: 'original.txt' })
    }));
    expect(createRes.status).toBe(202);
    const ownerToken = extractIssuedOwnerToken(createRes);
    const created = (await createRes.json()) as { requestid: string };

    const replaceRes = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...ownerAuthHeaders(ownerToken)
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
    const pinnedRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-filter-pinned', name: 'alpha.txt' })
    }));
    expect(pinnedRes.status).toBe(202);
    const ownerToken = extractIssuedOwnerToken(pinnedRes);

    ipfsClient.pinAdd.mockRejectedValueOnce(new Error('forced failure'));
    const failedRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-filter-failed', name: 'beta.txt' })
    }));
    expect(failedRes.status).toBe(202);

    const byCid = await app.request(
      new Request('http://localhost/pins?cid=bafy-filter-pinned', {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(byCid.status).toBe(200);
    const cidBody = (await byCid.json()) as { count: number; results: Array<{ pin: { cid: string } }> };
    expect(cidBody.count).toBe(1);
    expect(cidBody.results[0]?.pin.cid).toBe('bafy-filter-pinned');

    const byName = await app.request(
      new Request('http://localhost/pins?name=beta.txt', {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(byName.status).toBe(200);
    const nameBody = (await byName.json()) as { count: number; results: Array<{ pin: { name?: string } }> };
    expect(nameBody.count).toBe(1);
    expect(nameBody.results[0]?.pin.name).toBe('beta.txt');

    const byStatus = await app.request(
      new Request('http://localhost/pins?status=failed', {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(byStatus.status).toBe(200);
    const statusBody = (await byStatus.json()) as { count: number; results: Array<{ status: string }> };
    expect(statusBody.count).toBe(1);
    expect(statusBody.results[0]?.status).toBe('failed');

    const beforePast = await app.request(
      new Request('http://localhost/pins?before=1970-01-01T00:00:00.000Z', {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(beforePast.status).toBe(200);
    expect((await beforePast.json()) as { count: number }).toEqual({ count: 0, results: [] });

    const afterFuture = await app.request(
      new Request('http://localhost/pins?after=9999-01-01T00:00:00.000Z', {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(afterFuture.status).toBe(200);
    expect((await afterFuture.json()) as { count: number }).toEqual({ count: 0, results: [] });
  });

  it('returns 400 for invalid list filters', async () => {
    const createRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-a' })
    }));
    const ownerToken = extractIssuedOwnerToken(createRes);

    const invalidStatus = await app.request(
      new Request('http://localhost/pins?status=invalid', {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(invalidStatus.status).toBe(400);
    expect(await invalidStatus.json()).toEqual({ error: 'Invalid status filter' });

    const invalidLimit = await app.request(
      new Request('http://localhost/pins?limit=not-a-number', {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(invalidLimit.status).toBe(400);
    expect(await invalidLimit.json()).toEqual({ error: 'limit must be an integer between 1 and 1000' });
  });

  it('returns 401 for anonymous pin list access', async () => {
    const response = await app.request('http://localhost/pins');
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('bearer token');
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
    const uploadRes = await paidRequest(app, 'http://localhost/upload', walletA, () => {
      const form = new FormData();
      const body = new Uint8Array(new TextEncoder().encode('hello'));
      form.append('file', new File([body], 'hello.txt'));
      return {
        method: 'POST',
        headers: { 'x-content-size-bytes': String(body.byteLength) },
        body: form
      };
    });

    expect(uploadRes.status).toBe(201);
    extractIssuedOwnerToken(uploadRes);
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
    await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-text', name: 'notes.txt' })
    }));

    const first = await app.request('http://localhost/ipfs/bafy-text');
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toContain('text/plain');
    expect(first.headers.get('x-cache')).toBe('MISS');
    expect(first.headers.get('cache-control')).toContain('immutable');
    expect(first.headers.get('etag')).toBe('"bafy-text"');
    expect(first.headers.get('x-content-type-options')).toBe('nosniff');

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

  it('forces attachment for active browser content', async () => {
    await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cid: 'bafy-html',
        name: 'unsafe page.html',
        meta: { contentType: 'text/html; charset=utf-8' }
      })
    }));

    const response = await app.request('http://localhost/ipfs/bafy-html');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename=\"unsafe_page.html\"');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves an AgentCard endpoint', async () => {
    const response = await app.request('http://localhost/.well-known/agent.json');
    expect(response.status).toBe(200);

    const agentCard = (await response.json()) as {
      endpoint: string;
      protocol: string;
      capabilities: { pinningApi: { endpoints: string[] } };
      pricing: { retrieval: { metadataField: string }; pinning: { protocol: string; spec: string } };
      authentication: { walletAuthToken: { description: string; usage: string } };
      links: { x402Spec: string; x402ClientSdk: string; ipfsPinningSpec: string };
    };

    expect(agentCard.protocol).toBe('a2a');
    expect(agentCard.endpoint).toBe('http://localhost');
    expect(agentCard.capabilities.pinningApi.endpoints).toContain('/pins');
    expect(agentCard.pricing.pinning.protocol).toBe('x402');
    expect(agentCard.pricing.pinning.spec).toBe('https://www.x402.org/');
    expect(agentCard.pricing.retrieval.metadataField).toBe('meta.retrievalPrice');
    expect(agentCard.authentication.walletAuthToken.usage).toBe('Authorization: Bearer <token>');
    expect(agentCard.links.x402Spec).toBe('https://www.x402.org/');
    expect(agentCard.links.x402ClientSdk).toBe('https://www.npmjs.com/package/@x402/fetch');
    expect(agentCard.links.ipfsPinningSpec).toBe('https://ipfs.github.io/pinning-services-api-spec/');
  });

  it('includes X-Request-Id and enriched body in 402 responses', async () => {
    const unpaid = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cid: 'bafy-unpaid' })
      })
    );

    expect(unpaid.status).toBe(402);
    expect(unpaid.headers.get('x-request-id')).toBeTruthy();
    const body = (await unpaid.json()) as { error: string; protocol: { spec: string }; client: { package: string } };
    expect(body.error).toBe('Payment required');
    expect(body.protocol.spec).toBe('https://www.x402.org/');
    expect(body.client.package).toBe('@x402/fetch');
  });

  it('returns an enriched body for invalid decodable payment proofs', async () => {
    const invalidPaymentApp = buildApp({
      paymentMiddleware: createX402PaymentMiddleware(paymentConfig, createInvalidVerificationFacilitator('invalid_payment_signature'))
    });

    const unpaid = await invalidPaymentApp.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cid: 'bafy-invalid-payment' })
      })
    );
    expect(unpaid.status).toBe(402);

    const paymentRequiredHeader = unpaid.headers.get('payment-required');
    expect(paymentRequiredHeader).toBeTruthy();

    const response = await invalidPaymentApp.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payment-signature': buildPaymentPayload(walletA, paymentRequiredHeader!)
        },
        body: JSON.stringify({ cid: 'bafy-invalid-payment' })
      })
    );

    expect(response.status).toBe(402);
    expect(response.headers.get('payment-required')).toBeTruthy();
    const body = (await response.json()) as {
      error: string;
      paymentError: string;
      protocol: { spec: string };
      client: { package: string };
    };
    expect(body.error).toBe('Payment verification failed');
    expect(body.paymentError).toBe('invalid_payment_signature');
    expect(body.protocol.spec).toBe('https://www.x402.org/');
    expect(body.client.package).toBe('@x402/fetch');
  });

  it('returns the settlement failure body when on-chain settlement fails', async () => {
    const settlementFailureApp = buildApp({
      paymentMiddleware: createX402PaymentMiddleware(
        paymentConfig,
        createSettlementFailureFacilitator('settle failed', 'facilitator could not settle')
      )
    });

    const response = await paidRequest(settlementFailureApp, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-settlement-failure' })
    }));

    expect(response.status).toBe(402);
    expect(response.headers.get('payment-response')).toBeTruthy();
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(response.headers.get(WALLET_AUTH_TOKEN_RESPONSE_HEADER)).toBeNull();
    expect(response.headers.get('cache-control')).toBeNull();
    expect(await response.json()).toEqual({
      error: 'Payment settlement failed',
      reason: 'settle failed',
      message: 'facilitator could not settle',
      spec: 'https://www.x402.org/'
    });
  });

  it('uses forwarded host and proto in the AgentCard when trustProxy is enabled', async () => {
    const trustedProxyApp = buildApp({
      trustProxy: true,
      trustedProxyCidrs: ['10.0.0.0/8']
    });

    const response = await trustedProxyApp.request(
      new Request('http://localhost/.well-known/agent.json', {
        headers: {
          'x-forwarded-host': 'tack-api-production.up.railway.app',
          'x-forwarded-proto': 'https'
        }
      }),
      undefined,
      {
        incoming: {
          socket: {
            remoteAddress: '10.0.0.4'
          }
        }
      }
    );

    expect(response.status).toBe(200);
    const agentCard = (await response.json()) as { endpoint: string };
    expect(agentCard.endpoint).toBe('https://tack-api-production.up.railway.app');
  });

  it('prefers PUBLIC_BASE_URL for the AgentCard over forwarded headers', async () => {
    const publicBaseUrlApp = buildApp({
      publicBaseUrl: 'https://api.tack.example',
      trustProxy: true,
      trustedProxyCidrs: ['10.0.0.0/8']
    });

    const response = await publicBaseUrlApp.request(
      new Request('http://localhost/.well-known/agent.json', {
        headers: {
          'x-forwarded-host': 'internal-only.example',
          'x-forwarded-proto': 'http'
        }
      }),
      undefined,
      {
        incoming: {
          socket: {
            remoteAddress: '10.0.0.4'
          }
        }
      }
    );

    expect(response.status).toBe(200);
    const agentCard = (await response.json()) as { endpoint: string };
    expect(agentCard.endpoint).toBe('https://api.tack.example');
  });

  it('rejects uploads over configured upload size limit', async () => {
    const strictApp = buildApp({ uploadMaxSizeBytes: 4 });
    const uploadRes = await paidRequest(strictApp, 'http://localhost/upload', walletA, () => {
      const form = new FormData();
      const body = new Uint8Array(new TextEncoder().encode('hello'));
      form.append('file', new File([body], 'hello.txt'));
      return {
        method: 'POST',
        headers: { 'x-content-size-bytes': String(body.byteLength) },
        body: form
      };
    });

    expect(uploadRes.status).toBe(413);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    const limitedApp = buildApp({
      rateLimiter: new InMemoryRateLimiter(1, 60_000)
    });

    const first = await limitedApp.request('http://localhost/health');
    expect(first.status).toBe(200);

    const second = await limitedApp.request('http://localhost/health');
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBeTruthy();
  });

  it('rate limits unverified payment headers by IP instead of the claimed wallet', async () => {
    const limitedApp = buildApp({
      rateLimiter: new InMemoryRateLimiter(1, 60_000)
    });

    const first = await limitedApp.request(
      new Request('http://localhost/health', {
        headers: {
          'payment-signature': buildForgedPaymentSignatureHeader(walletA)
        }
      })
    );
    expect(first.status).toBe(200);

    const second = await limitedApp.request(
      new Request('http://localhost/health', {
        headers: {
          'payment-signature': buildForgedPaymentSignatureHeader(walletB)
        }
      })
    );
    expect(second.status).toBe(429);
  });

  it('does not trust forwarded IP headers by default', async () => {
    const limitedApp = buildApp({
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
    const trustedProxyApp = buildApp({
      rateLimiter: new InMemoryRateLimiter(1, 60_000),
      trustProxy: true,
      trustedProxyCidrs: ['10.0.0.0/8']
    });

    const first = await trustedProxyApp.request(
      new Request('http://localhost/health', {
        headers: { 'x-forwarded-for': '198.51.100.10' }
      }),
      undefined,
      {
        incoming: {
          socket: {
            remoteAddress: '10.0.0.4'
          }
        }
      }
    );
    expect(first.status).toBe(200);

    const second = await trustedProxyApp.request(
      new Request('http://localhost/health', {
        headers: { 'x-forwarded-for': '198.51.100.11' }
      }),
      undefined,
      {
        incoming: {
          socket: {
            remoteAddress: '10.0.0.4'
          }
        }
      }
    );
    expect(second.status).toBe(200);
  });

  it('returns 400 for invalid JSON on pin creation and replacement', async () => {
    const createResponse = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{"cid":"bafy-bad-json"'
    }));
    expect(createResponse.status).toBe(400);
    expect(await createResponse.json()).toEqual({ error: 'Request body must be valid JSON' });

    const paidCreate = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ cid: 'bafy-good' })
    }));
    const ownerToken = extractIssuedOwnerToken(paidCreate);
    const created = (await paidCreate.json()) as { requestid: string };

    const replaceResponse = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...ownerAuthHeaders(ownerToken)
        },
        body: '{"cid":"bafy-bad-json"'
      })
    );
    expect(replaceResponse.status).toBe(400);
    expect(await replaceResponse.json()).toEqual({ error: 'Request body must be valid JSON' });
  });

  it('reports healthy status when IPFS health probe succeeds', async () => {
    const healthCheck = vi.fn().mockResolvedValue(undefined);
    const healthApp = buildApp({
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
    const healthApp = buildApp({
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
    const createRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-remove-me' })
    }));

    const ownerToken = extractIssuedOwnerToken(createRes);
    const created = (await createRes.json()) as { requestid: string };

    const deleteRes = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        method: 'DELETE',
        headers: ownerAuthHeaders(ownerToken)
      })
    );

    expect(deleteRes.status).toBe(202);

    const getRes = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(getRes.status).toBe(404);
  });

  it('rejects payment-signature headers on owner endpoints', async () => {
    const createRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-spoof-target' })
    }));
    const created = (await createRes.json()) as { requestid: string };

    const forgedHeader = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted: {},
        payload: {
          authorization: {
            from: walletA
          }
        }
      }),
      'utf8'
    ).toString('base64');

    const spoofedRead = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        headers: { 'payment-signature': forgedHeader }
      })
    );
    expect(spoofedRead.status).toBe(401);

    const spoofedDelete = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        method: 'DELETE',
        headers: { 'payment-signature': forgedHeader }
      })
    );
    expect(spoofedDelete.status).toBe(401);
  });

  it('creates a pin with X-Pin-Duration-Months and includes expiresAt in response', async () => {
    const createRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pin-duration-months': '6'
      },
      body: JSON.stringify({ cid: 'bafy-duration', name: 'test-duration' })
    }));

    expect(createRes.status).toBe(202);
    const created = (await createRes.json()) as {
      requestid: string;
      info: { expiresAt?: string };
    };
    expect(created.info.expiresAt).toBeTruthy();

    const expiresAt = new Date(created.info.expiresAt!);
    const now = new Date();
    const diffMonths = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
    expect(diffMonths).toBeGreaterThan(5);
    expect(diffMonths).toBeLessThan(7);
  });

  it('uses default duration when X-Pin-Duration-Months header is missing', async () => {
    const createRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-default-duration' })
    }));

    expect(createRes.status).toBe(202);
    const created = (await createRes.json()) as {
      info: { expiresAt?: string };
    };
    expect(created.info.expiresAt).toBeTruthy();

    const expiresAt = new Date(created.info.expiresAt!);
    const now = new Date();
    const diffMonths = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
    expect(diffMonths).toBeGreaterThan(0.5);
    expect(diffMonths).toBeLessThan(1.5);
  });

  it('returns updated agent card with new pricing fields', async () => {
    const agentCardApp = buildApp({
      agentCard: {
        name: 'Tack',
        description: 'Test agent',
        version: '0.0.1',
        x402Network: 'eip155:167000',
        x402UsdcAssetAddress: '0x2222222222222222222222222222222222222222',
        x402RatePerGbMonthUsd: 0.10,
        x402MinPriceUsd: 0.001,
        x402MaxPriceUsd: 50.0,
        x402DefaultDurationMonths: 1,
        x402MaxDurationMonths: 24,
        mppMethod: 'tempo',
        mppChainId: 4217,
        mppAsset: '0x20C000000000000000000000b9537d11c60E8b50',
        mppAssetSymbol: 'USDC.e'
      }
    });

    const response = await agentCardApp.request('http://localhost/.well-known/agent.json');
    expect(response.status).toBe(200);

    const card = (await response.json()) as {
      payments: {
        protocols: Array<{ protocol: string; chainId: number }>;
      };
      pricing: {
        pinning: {
          ratePerGbMonthUsd: number;
          minPriceUsd: number;
          maxPriceUsd: number;
          defaultDurationMonths: number;
          maxDurationMonths: number;
          durationHeader: string;
        };
      };
    };

    expect(card.pricing.pinning.ratePerGbMonthUsd).toBe(0.10);
    expect(card.pricing.pinning.minPriceUsd).toBe(0.001);
    expect(card.pricing.pinning.maxPriceUsd).toBe(50.0);
    expect(card.pricing.pinning.defaultDurationMonths).toBe(1);
    expect(card.pricing.pinning.maxDurationMonths).toBe(24);
    expect(card.pricing.pinning.durationHeader).toBe('X-Pin-Duration-Months');
    expect(card.payments.protocols.map((protocol) => protocol.protocol)).toEqual(['x402', 'mpp']);
  });

  it('enforces wallet ownership when listing and deleting pins', async () => {
    const createRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-owned' })
    }));

    const ownerToken = extractIssuedOwnerToken(createRes);

    const createResB = await paidRequest(app, 'http://localhost/pins', walletB, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-owned-by-b' })
    }));
    const otherOwnerToken = extractIssuedOwnerToken(createResB);
    const created = (await createRes.json()) as { requestid: string };

    const listAsOther = await app.request(
      new Request('http://localhost/pins?limit=10&offset=0', {
        headers: ownerAuthHeaders(otherOwnerToken)
      })
    );
    expect(listAsOther.status).toBe(200);
    const listed = (await listAsOther.json()) as { count: number };
    expect(listed.count).toBe(1);

    const getAsOther = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        headers: ownerAuthHeaders(otherOwnerToken)
      })
    );
    expect(getAsOther.status).toBe(404);

    const deleteAsOther = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        method: 'DELETE',
        headers: ownerAuthHeaders(otherOwnerToken)
      })
    );
    expect(deleteAsOther.status).toBe(404);

    const getAsOwner = await app.request(
      new Request(`http://localhost/pins/${created.requestid}`, {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(getAsOwner.status).toBe(200);
  });
});
