import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { FacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { describe, expect, it } from 'vitest';
import { createExternalRequestUrlMiddleware } from '../../src/lib/request-url';
import {
  calculatePriceUsd,
  createWalletAuthToken,
  createX402PaymentMiddleware,
  extractPaidWalletFromHeaders,
  parseDurationMonths,
  resolveWalletFromHeaders,
  type WalletAuthConfig,
  type X402PaymentConfig
} from '../../src/services/x402';

const testConfig: X402PaymentConfig = {
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
const walletAuthConfig: WalletAuthConfig = {
  secret: '0123456789abcdef0123456789abcdef',
  issuer: 'tack',
  audience: 'tack-owner-api',
  ttlSeconds: 900
};

function createSignedWalletAuthToken(payloadPatch: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8')
    .toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      iss: walletAuthConfig.issuer,
      aud: walletAuthConfig.audience,
      iat: issuedAt,
      nbf: issuedAt,
      exp: issuedAt + walletAuthConfig.ttlSeconds,
      ...payloadPatch
    }),
    'utf8'
  ).toString('base64url');
  const signature = createHmac('sha256', walletAuthConfig.secret).update(`${header}.${payload}`).digest('base64url');

  return `${header}.${payload}.${signature}`;
}

function extractWallet(paymentPayload: PaymentPayload): string {
  const payload = paymentPayload.payload;
  const authorization = payload.authorization as Record<string, unknown> | undefined;
  const from = authorization?.from;

  if (typeof from === 'string') {
    return from;
  }

  return '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
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
      kinds: [{ x402Version: 2, scheme: 'exact', network: testConfig.network }],
      extensions: [],
      signers: { [testConfig.network]: [testConfig.payTo] }
    });
  }
};

describe('calculatePriceUsd', () => {
  const pricingConfig = {
    ratePerGbMonthUsd: 0.10,
    minPriceUsd: 0.001,
    maxPriceUsd: 50.0
  };

  it('returns the floor for tiny files', () => {
    expect(calculatePriceUsd(1024, 1, pricingConfig)).toBe(0.001);
    expect(calculatePriceUsd(1_000_000, 1, pricingConfig)).toBe(0.001);
    expect(calculatePriceUsd(1_000_000, 6, pricingConfig)).toBe(0.001);
  });

  it('prices linearly by size and duration', () => {
    const oneGb = 1_073_741_824;
    expect(calculatePriceUsd(oneGb, 1, pricingConfig)).toBeCloseTo(0.10, 6);
    expect(calculatePriceUsd(oneGb, 6, pricingConfig)).toBeCloseTo(0.60, 6);
    expect(calculatePriceUsd(oneGb, 12, pricingConfig)).toBeCloseTo(1.20, 6);
  });

  it('prices 100 MB correctly', () => {
    const hundredMb = 100 * 1_000_000;
    expect(calculatePriceUsd(hundredMb, 1, pricingConfig)).toBeCloseTo(0.00931, 4);
    expect(calculatePriceUsd(hundredMb, 6, pricingConfig)).toBeCloseTo(0.056, 3);
  });

  it('caps at max price', () => {
    const tenGb = 10 * 1_073_741_824;
    expect(calculatePriceUsd(tenGb, 24, pricingConfig)).toBeCloseTo(24.0, 2);
    const lowCap = { ...pricingConfig, maxPriceUsd: 5.0 };
    expect(calculatePriceUsd(tenGb, 24, lowCap)).toBe(5.0);
  });

  it('returns zero-byte files at min price', () => {
    expect(calculatePriceUsd(0, 1, pricingConfig)).toBe(0.001);
    expect(calculatePriceUsd(0, 12, pricingConfig)).toBe(0.001);
  });
});

describe('parseDurationMonths', () => {
  it('returns default when header is missing', () => {
    expect(parseDurationMonths(null, 1, 24)).toBe(1);
    expect(parseDurationMonths(undefined, 6, 24)).toBe(6);
    expect(parseDurationMonths('', 1, 24)).toBe(1);
  });

  it('parses valid integer values', () => {
    expect(parseDurationMonths('1', 1, 24)).toBe(1);
    expect(parseDurationMonths('12', 1, 24)).toBe(12);
    expect(parseDurationMonths('24', 1, 24)).toBe(24);
  });

  it('falls back to default for invalid values', () => {
    expect(parseDurationMonths('0', 1, 24)).toBe(1);
    expect(parseDurationMonths('-1', 1, 24)).toBe(1);
    expect(parseDurationMonths('25', 1, 24)).toBe(1);
    expect(parseDurationMonths('1.5', 1, 24)).toBe(1);
    expect(parseDurationMonths('abc', 1, 24)).toBe(1);
  });
});

describe('x402 payment integration helpers', () => {
  it('extracts wallet identity from x402 payment proof', () => {
    const paymentPayload: PaymentPayload = {
      x402Version: 2,
      accepted: {
        scheme: 'exact',
        network: testConfig.network,
        asset: testConfig.usdcAssetAddress,
        amount: '1000',
        payTo: testConfig.payTo,
        maxTimeoutSeconds: 60
      },
      payload: {
        authorization: {
          from: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        }
      }
    };

    const headers = new Headers({
      'payment-signature': encodePaymentSignatureHeader(paymentPayload)
    });

    expect(extractPaidWalletFromHeaders(headers)).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('extracts wallet identity from a signed bearer token', () => {
    const headers = new Headers({
      authorization: `Bearer ${createWalletAuthToken('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', walletAuthConfig).token}`
    });

    const identity = resolveWalletFromHeaders(headers, walletAuthConfig);
    expect(identity.authError).toBeNull();
    expect(identity.wallet).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('does not trust x-wallet-address without authenticated proof', () => {
    const headers = new Headers({
      'x-wallet-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    });

    const identity = resolveWalletFromHeaders(headers, walletAuthConfig);
    expect(identity.authError).toBeNull();
    expect(identity.wallet).toBeNull();
  });

  it('surfaces auth token errors', () => {
    const headers = new Headers({
      authorization: 'Bearer malformed.token'
    });

    const identity = resolveWalletFromHeaders(headers, walletAuthConfig);
    expect(identity.wallet).toBeNull();
    expect(identity.authError).toBe('invalid wallet auth token');
  });

  it('rejects wallet auth tokens with an invalid audience', () => {
    const headers = new Headers({
      authorization: `Bearer ${createSignedWalletAuthToken({ aud: 'wrong-audience' })}`
    });

    const identity = resolveWalletFromHeaders(headers, walletAuthConfig);
    expect(identity.wallet).toBeNull();
    expect(identity.authError).toBe('wallet auth token audience is invalid');
  });
});

describe('x402 middleware', () => {
  it('returns 402 when payment proof is missing and allows paid requests', async () => {
    const app = new Hono();
    app.use(createX402PaymentMiddleware(testConfig, mockFacilitator));
    app.post('/pins', (c) => c.json({ ok: true }));

    const unpaid = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cid: 'bafy-test' })
      })
    );

    expect(unpaid.status).toBe(402);
    const unpaidBody = (await unpaid.json()) as {
      error: string;
      protocol: { spec: string };
      client: { package: string };
      pricing: { ratePerGbMonthUsd: number; durationMonths: number; minPriceUsd: number };
    };
    expect(unpaidBody.error).toBe('Payment required');
    expect(unpaidBody.protocol.spec).toBe('https://www.x402.org/');
    expect(unpaidBody.client.package).toBe('@x402/fetch');
    expect(unpaidBody.pricing.ratePerGbMonthUsd).toBe(0.10);
    expect(unpaidBody.pricing.durationMonths).toBe(1);
    expect(unpaidBody.pricing.minPriceUsd).toBe(0.001);

    const paymentRequiredHeader = unpaid.headers.get('payment-required');
    expect(paymentRequiredHeader).toBeTruthy();

    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader!);
    expect(paymentRequired.resource?.url).toBe('http://localhost/pins');
    const accepted = paymentRequired.accepts[0];
    const paymentPayload: PaymentPayload = {
      x402Version: paymentRequired.x402Version,
      accepted,
      payload: {
        authorization: {
          from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          to: testConfig.payTo,
          value: accepted.amount,
          validAfter: '0',
          validBefore: '9999999999',
          nonce: `0x${'0'.repeat(64)}`
        },
        signature: `0x${'1'.repeat(130)}`
      }
    };

    const paid = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payment-signature': encodePaymentSignatureHeader(paymentPayload)
        },
        body: JSON.stringify({ cid: 'bafy-test' })
      })
    );

    expect(paid.status).toBe(200);
    const paymentResponseHeader = paid.headers.get('payment-response');
    expect(paymentResponseHeader).toBeTruthy();

    const settlement = decodePaymentResponseHeader(paymentResponseHeader!);
    expect(settlement.success).toBe(true);
    expect(settlement.network).toBe(testConfig.network);
  });

  it('uses the normalized public URL in payment requirements', async () => {
    const app = new Hono();
    app.use(createExternalRequestUrlMiddleware({ publicBaseUrl: 'https://tack-api-production.up.railway.app' }));
    app.use(createX402PaymentMiddleware(testConfig, mockFacilitator));
    app.post('/pins', (c) => c.json({ ok: true }));

    const unpaid = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ cid: 'bafy-test' })
      })
    );

    expect(unpaid.status).toBe(402);
    const paymentRequiredHeader = unpaid.headers.get('payment-required');
    expect(paymentRequiredHeader).toBeTruthy();

    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader!);
    expect(paymentRequired.resource?.url).toBe('https://tack-api-production.up.railway.app/pins');
  });

  it('enforces optional retrieval paywall with dynamic owner payout', async () => {
    const premiumOwner = '0xcccccccccccccccccccccccccccccccccccccccc';
    const app = new Hono();
    app.use(
      createX402PaymentMiddleware(testConfig, mockFacilitator, {
        resolveRetrievalPayment: (cid) => {
          if (cid === 'premium-cid') {
            return { payTo: premiumOwner, priceUsd: 0.0025 };
          }

          return null;
        }
      })
    );
    app.get('/ipfs/:cid', (c) => c.json({ cid: c.req.param('cid') }));

    const free = await app.request('http://localhost/ipfs/free-cid');
    expect(free.status).toBe(200);

    const unpaidPremium = await app.request('http://localhost/ipfs/premium-cid');
    expect(unpaidPremium.status).toBe(402);

    const requiredHeader = unpaidPremium.headers.get('payment-required');
    expect(requiredHeader).toBeTruthy();
    const paymentRequired = decodePaymentRequiredHeader(requiredHeader!);
    const accepted = paymentRequired.accepts[0];
    expect(accepted.payTo).toBe(premiumOwner);

    const paymentPayload: PaymentPayload = {
      x402Version: paymentRequired.x402Version,
      accepted,
      payload: {
        authorization: {
          from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          to: premiumOwner,
          value: accepted.amount,
          validAfter: '0',
          validBefore: '9999999999',
          nonce: `0x${'0'.repeat(64)}`
        },
        signature: `0x${'1'.repeat(130)}`
      }
    };

    const paidPremium = await app.request(
      new Request('http://localhost/ipfs/premium-cid', {
        headers: {
          'payment-signature': encodePaymentSignatureHeader(paymentPayload)
        }
      })
    );
    expect(paidPremium.status).toBe(200);
  });
});
