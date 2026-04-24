import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { FacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { privateKeyToAccount } from 'viem/accounts';
import { createApp } from '../../src/app';
import { createDb } from '../../src/db';
import { GatewayTimeoutError, UpstreamServiceError } from '../../src/lib/errors';
import { PinRepository } from '../../src/repositories/pin-repository';
import { PrivateObjectRepository } from '../../src/repositories/private-object-repository';
import { WalletAuthChallengeRepository } from '../../src/repositories/wallet-auth-challenge-repository';
import type { IpfsClient } from '../../src/services/ipfs-rpc-client';
import { GatewayContentCache } from '../../src/services/content-cache';
import { PinningService } from '../../src/services/pinning-service';
import { LocalPrivateObjectStorage } from '../../src/services/private-object-storage';
import { PrivateObjectService } from '../../src/services/private-object-service';
import { InMemoryRateLimiter } from '../../src/services/rate-limiter';
import { WalletLoginService } from '../../src/services/wallet-login';
import {
  createWalletAuthToken,
  createX402PaymentMiddleware,
  WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER,
  WALLET_AUTH_TOKEN_RESPONSE_HEADER,
  type WalletAuthConfig,
  type X402PaymentConfig
} from '../../src/services/x402';
import {
  createMppPaymentMiddleware,
  type MppxChargeHandler,
  type ResolveVerifiedPayer
} from '../../src/services/payment/middleware';
import { createMppChallengeEnhancer } from '../../src/services/payment/challenge-enhancer';
import { requireOwnerWalletFromHeaders } from '../../src/services/payment/owner-auth';

const walletA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const walletB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const walletAuthConfig: WalletAuthConfig = {
  secret: '0123456789abcdef0123456789abcdef',
  issuer: 'tack',
  audience: 'tack-owner-api',
  ttlSeconds: 900
};

const taikoChain = {
  network: 'eip155:167000' as const,
  facilitatorUrl: 'http://localhost:9999',
  payTo: '0x1111111111111111111111111111111111111111',
  usdcAssetAddress: '0x2222222222222222222222222222222222222222',
  usdcAssetDecimals: 6,
  usdcDomainName: 'USD Coin',
  usdcDomainVersion: '2'
};

const paymentConfig: X402PaymentConfig = {
  chains: [taikoChain],
  ratePerGbMonthUsd: 0.10,
  minPriceUsd: 0.001,
  maxPriceUsd: 50.0,
  defaultDurationMonths: 1,
  maxDurationMonths: 24
};

const multiChainPaymentConfig: X402PaymentConfig = {
  ...paymentConfig,
  chains: [
    taikoChain,
    {
      network: 'eip155:8453',
      facilitatorUrl: 'http://localhost:9998',
      payTo: taikoChain.payTo,
      usdcAssetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      usdcAssetDecimals: 6,
      usdcDomainName: 'USD Coin',
      usdcDomainVersion: '2'
    }
  ]
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
      kinds: [
        { x402Version: 2, scheme: 'exact', network: taikoChain.network },
        { x402Version: 2, scheme: 'exact', network: 'eip155:8453' }
      ],
      extensions: [],
      signers: {
        [taikoChain.network]: [taikoChain.payTo],
        'eip155:8453': [taikoChain.payTo]
      }
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
  let privateObjectService: PrivateObjectService;
  let privateObjectRepository: PrivateObjectRepository;
  let privateStorageDir: string;
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
      },
      resolvePrivateObjectRenewal: (objectId) => {
        const record = privateObjectRepository.findById(objectId);
        return record ? { sizeBytes: record.size_bytes } : null;
      }
    });

    return createApp({
      pinningService: service,
      privateObjectService,
      paymentMiddleware,
      walletAuth: walletAuthConfig,
      walletLoginService: new WalletLoginService(new WalletAuthChallengeRepository(db), {
        walletAuth: walletAuthConfig,
        allowedNetworks: ['eip155:167000', 'eip155:8453'],
        eip1271RpcUrls: {},
        challengeTtlSeconds: 600
      }),
      defaultDurationMonths: 1,
      maxDurationMonths: 24,
      privateObjectMaxSizeBytes: 1024 * 1024,
      ...overrides
    });
  };

  beforeEach(async () => {
    db = createDb(':memory:');
    const repository = new PinRepository(db);
    privateObjectRepository = new PrivateObjectRepository(db);
    privateStorageDir = await mkdtemp(join(tmpdir(), 'tack-private-app-'));
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
    privateObjectService = new PrivateObjectService(
      privateObjectRepository,
      new LocalPrivateObjectStorage(privateStorageDir)
    );
    app = buildApp();
  });

  afterEach(async () => {
    await rm(privateStorageDir, { recursive: true, force: true });
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

  it('exchanges an OWS-compatible wallet signature for an owner token', async () => {
    const account = privateKeyToAccount(`0x${'3'.repeat(64)}`);
    const challengeRes = await app.request(
      new Request('http://localhost/auth/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: account.address,
          network: 'eip155:8453'
        })
      })
    );
    expect(challengeRes.status).toBe(201);
    const challenge = await challengeRes.json() as { message: string; network: string; chainId: number };
    expect(challenge.network).toBe('eip155:8453');
    expect(challenge.chainId).toBe(8453);

    const signature = await account.signMessage({ message: challenge.message });
    const tokenRes = await app.request(
      new Request('http://localhost/auth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: challenge.message,
          signature
        })
      })
    );

    expect(tokenRes.status).toBe(200);
    const tokenBody = await tokenRes.json() as { wallet: string; token: string };
    expect(tokenBody.wallet).toBe(account.address.toLowerCase());
    expect(tokenBody.token).toBeTruthy();
    expect(tokenRes.headers.get(WALLET_AUTH_TOKEN_RESPONSE_HEADER)).toBe(tokenBody.token);
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

  it('creates and reads a paid private object', async () => {
    const objectBody = new TextEncoder().encode('private memory');
    const createRes = await paidRequest(app, 'http://localhost/private/objects', walletA, () => {
      const form = new FormData();
      form.append('file', new File([objectBody], 'memory.txt', { type: 'text/plain' }));
      return {
        method: 'POST',
        headers: {
          'x-content-size-bytes': String(objectBody.byteLength),
          'x-storage-duration-months': '1'
        },
        body: form
      };
    });

    expect(createRes.status).toBe(201);
    const ownerToken = extractIssuedOwnerToken(createRes);
    const created = await createRes.json() as { id: string; name: string; size: number; private: boolean };
    expect(created.id).toMatch(/^obj_/);
    expect(created.name).toBe('memory.txt');
    expect(created.size).toBe(objectBody.byteLength);
    expect(created.private).toBe(true);

    const metadataRes = await app.request(
      new Request(`http://localhost/private/objects/${created.id}`, {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(metadataRes.status).toBe(200);

    const contentRes = await app.request(
      new Request(`http://localhost/private/objects/${created.id}/content`, {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(contentRes.status).toBe(200);
    expect(contentRes.headers.get('cache-control')).toBe('private, no-store');
    expect(contentRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await contentRes.text()).toBe('private memory');
  });

  it('does not persist x402 private object renewals when settlement fails', async () => {
    const objectBody = new TextEncoder().encode('private memory');
    const createRes = await paidRequest(app, 'http://localhost/private/objects', walletA, () => {
      const form = new FormData();
      form.append('file', new File([objectBody], 'memory.txt', { type: 'text/plain' }));
      return {
        method: 'POST',
        headers: {
          'x-content-size-bytes': String(objectBody.byteLength),
          'x-storage-duration-months': '1'
        },
        body: form
      };
    });

    expect(createRes.status).toBe(201);
    const ownerToken = extractIssuedOwnerToken(createRes);
    const created = await createRes.json() as { id: string; expiresAt: string };

    const failingPaymentMiddleware = createX402PaymentMiddleware(
      paymentConfig,
      createSettlementFailureFacilitator(),
      {
        resolvePrivateObjectRenewal: (objectId) => {
          const record = privateObjectRepository.findById(objectId);
          return record ? { sizeBytes: record.size_bytes } : null;
        }
      }
    );
    const failingApp = buildApp({ paymentMiddleware: failingPaymentMiddleware });

    const renewRes = await paidRequest(
      failingApp,
      `http://localhost/private/objects/${created.id}/renew`,
      walletA,
      () => ({
        method: 'POST',
        headers: {
          ...ownerAuthHeaders(ownerToken),
          'x-storage-duration-months': '6'
        }
      })
    );

    expect(renewRes.status).toBe(402);

    const metadataRes = await app.request(
      new Request(`http://localhost/private/objects/${created.id}`, {
        headers: ownerAuthHeaders(ownerToken)
      })
    );
    expect(metadataRes.status).toBe(200);
    const metadata = await metadataRes.json() as { expiresAt: string };
    expect(metadata.expiresAt).toBe(created.expiresAt);
  });

  it('hides private objects from another wallet', async () => {
    const objectBody = new TextEncoder().encode('secret');
    const createRes = await paidRequest(app, 'http://localhost/private/objects', walletA, () => {
      const form = new FormData();
      form.append('file', new File([objectBody], 'secret.txt', { type: 'text/plain' }));
      return {
        method: 'POST',
        headers: { 'x-content-size-bytes': String(objectBody.byteLength) },
        body: form
      };
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { id: string };
    const otherToken = createWalletAuthToken(walletB, walletAuthConfig).token;

    const hidden = await app.request(
      new Request(`http://localhost/private/objects/${created.id}`, {
        headers: ownerAuthHeaders(otherToken)
      })
    );

    expect(hidden.status).toBe(404);
  });

  it('rejects private object uploads when declared size does not match bytes', async () => {
    const objectBody = new TextEncoder().encode('secret');
    const createRes = await paidRequest(app, 'http://localhost/private/objects', walletA, () => {
      const form = new FormData();
      form.append('file', new File([objectBody], 'secret.txt', { type: 'text/plain' }));
      return {
        method: 'POST',
        headers: { 'x-content-size-bytes': String(objectBody.byteLength + 1) },
        body: form
      };
    });

    expect(createRes.status).toBe(400);
    expect(await createRes.json()).toEqual({ error: 'X-Content-Size-Bytes must match object size' });
  });

  it('rejects private object uploads with oversized content-length before buffering the body', async () => {
    // Client lies with a tiny x-content-size-bytes to cheap out on payment,
    // but sends a huge body. The guard must reject on content-length before
    // we buffer the request into memory.
    const overhead = 64 * 1024;
    const max = 1024 * 1024;
    const oversizedLength = max + overhead + 1;
    const createRes = await paidRequest(app, 'http://localhost/private/objects', walletA, () => ({
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-content-size-bytes': '10',
        'content-length': String(oversizedLength)
      },
      body: new Uint8Array(oversizedLength)
    }));

    expect(createRes.status).toBe(413);
    expect(await createRes.json()).toEqual({ error: `Private object exceeds ${max} bytes` });
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
      capabilities: {
        pinningApi: { endpoints: string[] };
        privateStorage: { storage: string; visibility: string; endpoints: string[] };
      };
      pricing: { retrieval: { metadataField: string }; pinning: { protocol: string; spec: string } };
      authentication: { walletAuthToken: { description: string; usage: string } };
      links: { x402Spec: string; x402ClientSdk: string; ipfsPinningSpec: string };
    };

    expect(agentCard.protocol).toBe('a2a');
    expect(agentCard.endpoint).toBe('http://localhost');
    expect(agentCard.capabilities.pinningApi.endpoints).toContain('/pins');
    expect(agentCard.capabilities.privateStorage.storage).toBe('not-ipfs');
    expect(agentCard.capabilities.privateStorage.visibility).toBe('owner-authenticated');
    expect(agentCard.capabilities.privateStorage.endpoints).toContain('/private/objects');
    expect(agentCard.pricing.pinning.protocol).toBe('x402');
    expect(agentCard.pricing.pinning.spec).toBe('https://www.x402.org/');
    expect(agentCard.pricing.retrieval.metadataField).toBe('meta.retrievalPrice');
    expect(agentCard.authentication.walletAuthToken.usage).toBe('Authorization: Bearer <token>');
    expect(agentCard.links.x402Spec).toBe('https://www.x402.org/');
    expect(agentCard.links.x402ClientSdk).toBe('https://www.npmjs.com/package/@x402/fetch');
    expect(agentCard.links.ipfsPinningSpec).toBe('https://ipfs.github.io/pinning-services-api-spec/');
  });

  it('serves the OpenAPI 3.1 document at /openapi.json', async () => {
    const response = await app.request('http://localhost/openapi.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toContain('max-age=3600');

    const doc = (await response.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { securitySchemes: { walletAuthToken: { type: string } } };
    };

    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/pins', '/pins/{requestid}', '/upload', '/ipfs/{cid}', '/private/objects'])
    );
    expect(doc.components.securitySchemes.walletAuthToken.type).toBe('apiKey');
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
        x402Chains: [
          {
            network: 'eip155:167000',
            usdcAssetAddress: '0x2222222222222222222222222222222222222222',
          },
          {
            network: 'eip155:8453',
            usdcAssetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          }
        ],
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
        protocols: Array<{ protocol: string; chainId?: number; chain?: string }>;
      };
      pricing: {
        pinning: {
          network?: string;
          asset?: string;
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

    const x402Protocols = card.payments.protocols.filter((p) => p.protocol === 'x402');
    expect(x402Protocols).toHaveLength(2);
    expect(x402Protocols[0]).toMatchObject({ chainId: 167000, chain: 'taiko' });
    expect(x402Protocols[1]).toMatchObject({ chainId: 8453, chain: 'base' });

    const mppProtocol = card.payments.protocols.find((p) => p.protocol === 'mpp');
    expect(mppProtocol).toMatchObject({ chain: 'tempo', chainId: 4217 });

    expect(card.pricing.pinning.network).toBe('eip155:167000');
    expect(card.pricing.pinning.asset).toBe('0x2222222222222222222222222222222222222222');
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

  describe('dual-protocol (x402 + MPP)', () => {
    const MPP_VERIFIED_WALLET = '0xdddddddddddddddddddddddddddddddddddddddd';

    function createStubMppxHandler(): MppxChargeHandler & { chargeCalls: Array<{ amount: string; recipient?: string }> } {
      const chargeCalls: Array<{ amount: string; recipient?: string }> = [];
      return {
        chargeCalls,
        charge: (options) => {
          chargeCalls.push(options);
          return (req: Request) => {
            const authHeader = req.headers.get('Authorization');
            const hasCredential = authHeader != null && /^payment\s+/i.test(authHeader);

            if (!hasCredential) {
              return Promise.resolve({
                status: 402 as const,
                challenge: new Response(
                  JSON.stringify({ error: 'Payment required', method: 'tempo' }),
                  {
                    status: 402,
                    headers: {
                      'Content-Type': 'application/problem+json',
                      'WWW-Authenticate': `Payment id="stub", realm="tack", method="tempo", intent="charge", amount="${options.amount}"`
                    }
                  }
                )
              });
            }

            return Promise.resolve({
              status: 200 as const,
              withReceipt: (response: Response) => {
                const headers = new Headers(response.headers);
                headers.set('Payment-Receipt', `receipt-${options.amount}`);
                return new Response(response.body, { status: response.status, headers });
              }
            });
          };
        }
      };
    }

    function buildDualApp(
      stub: MppxChargeHandler,
      overrides?: { resolveVerifiedPayer?: ResolveVerifiedPayer }
    ): ReturnType<typeof createApp> {
      const requirementFn = (c: { req: { path: string; method: string } }) => {
        if (c.req.path === '/pins' && c.req.method === 'POST') {
          return { amount: '0.001', recipient: taikoChain.payTo };
        }
        if (c.req.path === '/upload' && c.req.method === 'POST') {
          return { amount: '0.001', recipient: taikoChain.payTo };
        }
        if (c.req.path === '/private/objects' && c.req.method === 'POST') {
          return { amount: '0.001', recipient: taikoChain.payTo };
        }
        if (/^\/private\/objects\/[^/]+\/renew$/.test(c.req.path) && c.req.method === 'POST') {
          return { amount: '0.001', recipient: taikoChain.payTo };
        }
        return null;
      };

      const mppMiddleware = createMppPaymentMiddleware({
        mppx: stub,
        requirementFn: requirementFn as Parameters<typeof createMppPaymentMiddleware>[0]['requirementFn'],
        resolveVerifiedPayer:
          overrides?.resolveVerifiedPayer ?? (() => Promise.resolve(MPP_VERIFIED_WALLET))
      });
      const mppChallengeEnhancer = createMppChallengeEnhancer({
        mppx: stub,
        requirementFn: requirementFn as Parameters<typeof createMppChallengeEnhancer>[0]['requirementFn'],
        assetDecimals: 6
      });

      return buildApp({ mppMiddleware, mppChallengeEnhancer });
    }

    it('emits a dual-challenge 402 response when the client sends no credential', async () => {
      const stub = createStubMppxHandler();
      const dualApp = buildDualApp(stub);

      const res = await dualApp.request(
        new Request('http://localhost/pins', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cid: 'bafy-dual' })
        })
      );

      expect(res.status).toBe(402);

      const paymentRequired = res.headers.get('payment-required');
      expect(paymentRequired).toBeTruthy();
      const decoded = decodePaymentRequiredHeader(paymentRequired!);
      expect(decoded.accepts[0].scheme).toBe('exact');
      expect(decoded.accepts[0].network).toBe(taikoChain.network);

      const wwwAuth = res.headers.get('www-authenticate');
      expect(wwwAuth).toContain('Payment');
      expect(wwwAuth).toContain('method="tempo"');
      expect(wwwAuth).toContain('intent="charge"');
    });

    it('routes MPP credentials through the MPP middleware and short-circuits x402', async () => {
      const stub = createStubMppxHandler();
      const dualApp = buildDualApp(stub);

      const res = await dualApp.request(
        new Request('http://localhost/pins', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': 'Payment stub-credential'
          },
          body: JSON.stringify({ cid: 'bafy-mpp-paid' })
        })
      );

      expect(res.status).toBe(202);
      expect(res.headers.get('Payment-Receipt')).toBe('receipt-0.001');
      expect(res.headers.get(WALLET_AUTH_TOKEN_RESPONSE_HEADER)).toBeTruthy();

      const body = await res.json() as { pin: { cid: string }; requestid: string };
      expect(body.pin.cid).toBe('bafy-mpp-paid');
      expect(stub.chargeCalls).toHaveLength(1);
      expect(stub.chargeCalls[0].amount).toBe('0.001');

      // The JWT issued for an MPP-paid request should resolve back to the
      // MPP wallet so that downstream owner endpoints work transparently.
      const ownerToken = extractIssuedOwnerToken(res);
      const listRes = await dualApp.request(
        new Request('http://localhost/pins?limit=10&offset=0', {
          headers: ownerAuthHeaders(ownerToken)
        })
      );
      expect(listRes.status).toBe(200);
      const listed = (await listRes.json()) as {
        count: number;
        results: Array<{ pin: { cid: string } }>;
      };
      expect(listed.count).toBe(1);
      expect(listed.results[0].pin.cid).toBe('bafy-mpp-paid');
    });

    it('creates private objects with MPP credentials', async () => {
      const stub = createStubMppxHandler();
      const dualApp = buildDualApp(stub);
      const objectBody = new TextEncoder().encode('mpp private memory');
      const form = new FormData();
      form.append('file', new File([objectBody], 'mpp.txt', { type: 'text/plain' }));

      const res = await dualApp.request(
        new Request('http://localhost/private/objects', {
          method: 'POST',
          headers: {
            'authorization': 'Payment stub-credential',
            'x-content-size-bytes': String(objectBody.byteLength)
          },
          body: form
        })
      );

      expect(res.status).toBe(201);
      expect(res.headers.get('Payment-Receipt')).toBe('receipt-0.001');
      const ownerToken = extractIssuedOwnerToken(res);
      const body = await res.json() as { id: string };

      const contentRes = await dualApp.request(
        new Request(`http://localhost/private/objects/${body.id}/content`, {
          headers: ownerAuthHeaders(ownerToken)
        })
      );
      expect(contentRes.status).toBe(200);
      expect(await contentRes.text()).toBe('mpp private memory');
    });

    it('rejects MPP private renewals without owner auth before charging', async () => {
      const stub = createStubMppxHandler();
      const dualApp = buildDualApp(stub);
      const objectBody = new TextEncoder().encode('mpp private memory');
      const form = new FormData();
      form.append('file', new File([objectBody], 'mpp.txt', { type: 'text/plain' }));

      const createRes = await dualApp.request(
        new Request('http://localhost/private/objects', {
          method: 'POST',
          headers: {
            'authorization': 'Payment stub-credential',
            'x-content-size-bytes': String(objectBody.byteLength)
          },
          body: form
        })
      );
      expect(createRes.status).toBe(201);
      const body = await createRes.json() as { id: string };
      stub.chargeCalls.length = 0;

      const renewRes = await dualApp.request(
        new Request(`http://localhost/private/objects/${body.id}/renew`, {
          method: 'POST',
          headers: {
            'authorization': 'Payment stub-credential',
            'x-storage-duration-months': '6'
          }
        })
      );

      expect(renewRes.status).toBe(401);
      expect(stub.chargeCalls).toHaveLength(0);
    });

    it('rejects MPP private renewals for the wrong owner before charging', async () => {
      const stub = createStubMppxHandler();
      const dualApp = buildDualApp(stub);
      const objectBody = new TextEncoder().encode('mpp private memory');
      const form = new FormData();
      form.append('file', new File([objectBody], 'mpp.txt', { type: 'text/plain' }));

      const createRes = await dualApp.request(
        new Request('http://localhost/private/objects', {
          method: 'POST',
          headers: {
            'authorization': 'Payment stub-credential',
            'x-content-size-bytes': String(objectBody.byteLength)
          },
          body: form
        })
      );
      expect(createRes.status).toBe(201);
      const body = await createRes.json() as { id: string };
      const otherOwnerToken = createWalletAuthToken(walletB, walletAuthConfig).token;
      stub.chargeCalls.length = 0;

      const renewRes = await dualApp.request(
        new Request(`http://localhost/private/objects/${body.id}/renew`, {
          method: 'POST',
          headers: {
            'x-wallet-auth-token': otherOwnerToken,
            'authorization': 'Payment stub-credential',
            'x-storage-duration-months': '6'
          }
        })
      );

      expect(renewRes.status).toBe(404);
      expect(stub.chargeCalls).toHaveLength(0);
    });

    it('ignores a forged credential.source and assigns ownership to the verified payer', async () => {
      // A paying attacker sets `source` in the credential JSON to a victim
      // DID. mppx verifies the payment, the server calls its on-chain
      // resolver — which returns the TRUE payer (the attacker's wallet),
      // not the forged victim. Pins are created under the attacker, and
      // the victim's pins remain inaccessible to the forged JWT.
      const attackerWallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const victimWallet = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      // Seed a pre-existing pin owned by the victim via the x402 flow.
      const victimCreate = await paidRequest(app, 'http://localhost/pins', victimWallet, () => ({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cid: 'bafy-victim-owned' })
      }));
      expect(victimCreate.status).toBe(202);
      const victimPin = (await victimCreate.json()) as { requestid: string };

      // Now run the MPP flow with a forged `source` DID pointing at the
      // victim. The resolver correctly returns the attacker wallet.
      const stub = createStubMppxHandler();
      const dualApp = buildDualApp(stub, {
        resolveVerifiedPayer: () => Promise.resolve(attackerWallet)
      });

      const forgedCredentialJson = Buffer.from(
        JSON.stringify({
          challenge: {},
          payload: { type: 'hash', hash: '0xdeadbeef' },
          source: `did:pkh:eip155:4217:${victimWallet}`
        })
      ).toString('base64url');

      const res = await dualApp.request(
        new Request('http://localhost/pins', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Payment ${forgedCredentialJson}`
          },
          body: JSON.stringify({ cid: 'bafy-forged-source' })
        })
      );

      expect(res.status).toBe(202);
      const attackerToken = extractIssuedOwnerToken(res);

      // The new pin must be owned by the attacker, not the victim.
      const attackerList = await dualApp.request(
        new Request('http://localhost/pins?limit=10&offset=0', {
          headers: ownerAuthHeaders(attackerToken)
        })
      );
      const attackerPins = (await attackerList.json()) as {
        count: number;
        results: Array<{ pin: { cid: string } }>;
      };
      expect(attackerPins.results.map((r) => r.pin.cid)).toEqual(['bafy-forged-source']);

      // Crucially, the attacker JWT must NOT grant access to victim pins.
      const reachVictimGet = await dualApp.request(
        new Request(`http://localhost/pins/${victimPin.requestid}`, {
          headers: ownerAuthHeaders(attackerToken)
        })
      );
      expect(reachVictimGet.status).toBe(404);

      const reachVictimDelete = await dualApp.request(
        new Request(`http://localhost/pins/${victimPin.requestid}`, {
          method: 'DELETE',
          headers: ownerAuthHeaders(attackerToken)
        })
      );
      expect(reachVictimDelete.status).toBe(404);
    });

    it('persists MPP private-renewal when payer resolution rebuilds the context shim', async () => {
      // Regression: production wires `resolveVerifiedPayer` through
      // `createTempoPayerResolver`, whose `getContext` rebuilds a minimal
      // Context shim (only `req`) and calls `requirementFn` a second time
      // to re-derive pricing. That shim has no `c.get('walletAddress')`.
      // The previous renewal code path reached into `c.get`, threw on the
      // shim, and the renewal was never persisted even though MPP had
      // already settled on-chain.
      const stub = createStubMppxHandler();

      const requirementFn = (c: {
        req: { path: string; method: string; raw: Request };
      }) => {
        if (c.req.path === '/private/objects' && c.req.method === 'POST') {
          return { amount: '0.001', recipient: taikoChain.payTo };
        }
        if (/^\/private\/objects\/[^/]+\/renew$/.test(c.req.path) && c.req.method === 'POST') {
          requireOwnerWalletFromHeaders(c.req.raw.headers, walletAuthConfig);
          return { amount: '0.001', recipient: taikoChain.payTo };
        }
        return null;
      };

      let shimRequirementCalls = 0;
      const resolveVerifiedPayer: ResolveVerifiedPayer = (request) => {
        const shim = {
          req: {
            path: new URL(request.url).pathname,
            method: request.method,
            header: (name: string) => request.headers.get(name),
            raw: request,
          },
        };
        requirementFn(shim as unknown as Parameters<typeof requirementFn>[0]);
        shimRequirementCalls += 1;
        return Promise.resolve(walletA);
      };

      const mppMiddleware = createMppPaymentMiddleware({
        mppx: stub,
        requirementFn: requirementFn as Parameters<typeof createMppPaymentMiddleware>[0]['requirementFn'],
        resolveVerifiedPayer,
      });
      const mppChallengeEnhancer = createMppChallengeEnhancer({
        mppx: stub,
        requirementFn: requirementFn as Parameters<typeof createMppChallengeEnhancer>[0]['requirementFn'],
        assetDecimals: 6
      });
      const dualApp = buildApp({ mppMiddleware, mppChallengeEnhancer });

      const objectBody = new TextEncoder().encode('mpp private memory');
      const form = new FormData();
      form.append('file', new File([objectBody], 'mpp.txt', { type: 'text/plain' }));

      const createRes = await dualApp.request(
        new Request('http://localhost/private/objects', {
          method: 'POST',
          headers: {
            'authorization': 'Payment stub-credential',
            'x-content-size-bytes': String(objectBody.byteLength),
            'x-storage-duration-months': '1'
          },
          body: form
        })
      );
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as { id: string; expiresAt: string };
      const ownerToken = extractIssuedOwnerToken(createRes);

      const renewRes = await dualApp.request(
        new Request(`http://localhost/private/objects/${created.id}/renew`, {
          method: 'POST',
          headers: {
            'x-wallet-auth-token': ownerToken,
            'authorization': 'Payment stub-credential',
            'x-storage-duration-months': '6'
          }
        })
      );

      expect(renewRes.status).toBe(200);
      expect(shimRequirementCalls).toBeGreaterThan(0);

      const metadataRes = await dualApp.request(
        new Request(`http://localhost/private/objects/${created.id}`, {
          headers: ownerAuthHeaders(ownerToken)
        })
      );
      expect(metadataRes.status).toBe(200);
      const metadata = await metadataRes.json() as { expiresAt: string };
      expect(new Date(metadata.expiresAt).getTime()).toBeGreaterThan(
        new Date(created.expiresAt).getTime()
      );
    });

    it('returns 500 problem+json when the on-chain payer lookup fails after a successful charge', async () => {
      const stub = createStubMppxHandler();
      const dualApp = buildDualApp(stub, {
        resolveVerifiedPayer: () => Promise.reject(new Error('rpc unreachable'))
      });

      const res = await dualApp.request(
        new Request('http://localhost/pins', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': 'Payment stub-credential'
          },
          body: JSON.stringify({ cid: 'bafy-unresolvable' })
        })
      );

      expect(res.status).toBe(500);
      expect(res.headers.get('Content-Type')).toBe('application/problem+json');
      expect(stub.chargeCalls).toHaveLength(1);

      const body = await res.json() as { type: string; title: string; status: number };
      expect(body.type).toBe('https://mpp.dev/errors/payer-resolution-failed');
      expect(body.status).toBe(500);
    });
  });

  describe('multi-chain x402', () => {
    it('advertises both Taiko and Base in the 402 payment-required header', async () => {
      const multiChainApp = createApp({
        pinningService: service,
        paymentMiddleware: createX402PaymentMiddleware(multiChainPaymentConfig, mockFacilitator),
        walletAuth: walletAuthConfig,
        defaultDurationMonths: 1,
        maxDurationMonths: 24
      });

      const res = await multiChainApp.request(
        new Request('http://localhost/pins', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cid: 'bafy-test' })
        })
      );

      expect(res.status).toBe(402);

      const paymentRequiredHeader = res.headers.get('payment-required');
      expect(paymentRequiredHeader).toBeTruthy();

      const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader!);
      const networks = paymentRequired.accepts.map((a) => a.network);
      expect(networks).toEqual(['eip155:167000', 'eip155:8453']);
      // Price parity: same USD price → same asset amount (both USDC, 6 decimals).
      expect(paymentRequired.accepts[0].amount).toBe(paymentRequired.accepts[1].amount);
    });
  });
});
