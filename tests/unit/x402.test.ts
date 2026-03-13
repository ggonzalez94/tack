import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { FacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { describe, expect, it } from 'vitest';
import { calculatePriceUsd, createX402PaymentMiddleware, resolveWalletFromHeaders, type X402PaymentConfig } from '../../src/services/x402';

const testConfig: X402PaymentConfig = {
  facilitatorUrl: 'http://localhost:9999',
  network: 'eip155:167000',
  payTo: '0x1111111111111111111111111111111111111111',
  usdcAssetAddress: '0x2222222222222222222222222222222222222222',
  usdcAssetDecimals: 6,
  basePriceUsd: 0.001,
  pricePerMbUsd: 0.001,
  maxPriceUsd: 0.01
};
const walletAuthSecret = 'unit-wallet-auth-secret';

function createWalletAuthToken(walletAddress: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8')
    .toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: walletAddress,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    }),
    'utf8'
  ).toString('base64url');
  const signature = createHmac('sha256', walletAuthSecret).update(`${header}.${payload}`).digest('base64url');

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

describe('x402 payment integration helpers', () => {
  it('calculates size-based pricing', () => {
    expect(calculatePriceUsd(10, testConfig)).toBe(0.001);
    expect(calculatePriceUsd(1_000_000, testConfig)).toBe(0.001);
    expect(calculatePriceUsd(1_000_001, testConfig)).toBe(0.002);
    expect(calculatePriceUsd(20_000_000, testConfig)).toBe(0.01);
  });

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

    const identity = resolveWalletFromHeaders(headers);
    expect(identity.paidWallet).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(identity.authTokenWallet).toBeNull();
    expect(identity.authError).toBeNull();
    expect(identity.wallet).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('extracts wallet identity from a signed bearer token', () => {
    const headers = new Headers({
      authorization: `Bearer ${createWalletAuthToken('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')}`
    });

    const identity = resolveWalletFromHeaders(headers, walletAuthSecret);
    expect(identity.paidWallet).toBeNull();
    expect(identity.authError).toBeNull();
    expect(identity.authTokenWallet).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(identity.wallet).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('does not trust x-wallet-address without authenticated proof', () => {
    const headers = new Headers({
      'x-wallet-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    });

    const identity = resolveWalletFromHeaders(headers, walletAuthSecret);
    expect(identity.paidWallet).toBeNull();
    expect(identity.authTokenWallet).toBeNull();
    expect(identity.authError).toBeNull();
    expect(identity.wallet).toBeNull();
  });

  it('surfaces auth token errors', () => {
    const headers = new Headers({
      authorization: 'Bearer malformed.token'
    });

    const identity = resolveWalletFromHeaders(headers, walletAuthSecret);
    expect(identity.wallet).toBeNull();
    expect(identity.authTokenWallet).toBeNull();
    expect(identity.authError).toBe('invalid wallet auth token');
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

  it('uses forwarded host and proto in payment requirements when trustProxy is enabled', async () => {
    const app = new Hono();
    app.use(createX402PaymentMiddleware(testConfig, mockFacilitator, { trustProxy: true }));
    app.post('/pins', (c) => c.json({ ok: true }));

    const unpaid = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-host': 'tack-api-production.up.railway.app',
          'x-forwarded-proto': 'https'
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
