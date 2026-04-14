import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  createMppPaymentMiddleware,
  type MppChargeResult,
  type MppxChargeHandler,
  type ResolveVerifiedPayer
} from '../../../src/services/payment/middleware';
import type { PaymentResult } from '../../../src/services/payment/types';

function createMockMppx(chargeResult: MppChargeResult): MppxChargeHandler {
  const handler = vi.fn(() => Promise.resolve(chargeResult));
  return {
    charge: vi.fn(() => handler),
  };
}

function noopResolveVerifiedPayer(address: string): ResolveVerifiedPayer {
  return vi.fn(() => Promise.resolve(address));
}

describe('createMppPaymentMiddleware', () => {
  it('calls next() when no MPP credential present (lets x402 handle it)', async () => {
    const mockMppx = createMockMppx({ status: 402, challenge: new Response('', { status: 402 }) });

    const app = new Hono();
    const middleware = createMppPaymentMiddleware({
      mppx: mockMppx,
      requirementFn: () => ({ amount: '0.001' }),
      resolveVerifiedPayer: noopResolveVerifiedPayer('0xabcdef1234567890abcdef1234567890abcdef12'),
    });

    app.get('/test', middleware, (c) => c.json({ ok: true }));
    const res = await app.request('/test');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockMppx.charge).not.toHaveBeenCalled();
  });

  it('handles MPP credential, resolves verified payer from on-chain evidence, and sets paymentResult', async () => {
    const withReceipt = vi.fn((res: Response) => {
      const newHeaders = new Headers(res.headers);
      newHeaders.set('Payment-Receipt', 'test-receipt');
      return new Response(res.body, { status: res.status, headers: newHeaders });
    });
    const mockMppx = createMockMppx({ status: 200, withReceipt });
    const verifiedPayer = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const resolveVerifiedPayer: ResolveVerifiedPayer = vi.fn(() => Promise.resolve(verifiedPayer));

    type Env = { Variables: { paymentResult?: PaymentResult } };
    const app = new Hono<Env>();
    const middleware = createMppPaymentMiddleware({
      mppx: mockMppx,
      requirementFn: () => ({
        amount: '0.001',
        recipient: '0x1111111111111111111111111111111111111111',
      }),
      resolveVerifiedPayer,
    });

    app.get('/test', middleware, (c) => {
      const result = c.get('paymentResult');
      return c.json({ wallet: result?.wallet, protocol: result?.protocol });
    });

    const res = await app.request('/test', {
      headers: { 'Authorization': 'payment eyJ0ZXN0IjoiY3JlZGVudGlhbCJ9' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { wallet?: string; protocol?: string };
    expect(body.wallet).toBe(verifiedPayer);
    expect(body.protocol).toBe('mpp');
    expect(res.headers.get('Payment-Receipt')).toBe('test-receipt');
    expect(mockMppx.charge).toHaveBeenCalledTimes(1);
    expect(resolveVerifiedPayer).toHaveBeenCalledTimes(1);

    // The resolver must receive the raw request AND the withReceipt callback
    // (so it can extract the mppx tx hash from the Payment-Receipt header).
    const [[, receivedWithReceipt]] = (resolveVerifiedPayer as ReturnType<typeof vi.fn>).mock.calls;
    expect(typeof receivedWithReceipt).toBe('function');
  });

  it('ignores any client-supplied credential.source and only trusts the resolver', async () => {
    // An attacker pays from wallet A but forges `source` in the credential
    // JSON for victim wallet B. The middleware must NOT see wallet B — it
    // calls the on-chain resolver which returns wallet A.
    const attackerPayer = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const victimForged = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const forgedCredentialJson = Buffer.from(
      JSON.stringify({
        challenge: {},
        payload: { type: 'hash', hash: '0xdeadbeef' },
        source: `did:pkh:eip155:4217:${victimForged}`,
      })
    ).toString('base64url');

    const mockMppx = createMockMppx({
      status: 200,
      withReceipt: (res: Response) => {
        const newHeaders = new Headers(res.headers);
        newHeaders.set('Payment-Receipt', 'test-receipt');
        return new Response(res.body, { status: res.status, headers: newHeaders });
      },
    });
    const resolveVerifiedPayer: ResolveVerifiedPayer = vi.fn(() => Promise.resolve(attackerPayer));

    type Env = { Variables: { paymentResult?: PaymentResult } };
    const app = new Hono<Env>();
    app.use(
      createMppPaymentMiddleware({
        mppx: mockMppx,
        requirementFn: () => ({ amount: '0.001' }),
        resolveVerifiedPayer,
      })
    );
    app.post('/pins', (c) => {
      const result = c.get('paymentResult');
      return c.json({ wallet: result?.wallet });
    });

    const res = await app.request('/pins', {
      method: 'POST',
      headers: { 'Authorization': `Payment ${forgedCredentialJson}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { wallet?: string };
    expect(body.wallet).toBe(attackerPayer);
    expect(body.wallet).not.toBe(victimForged);
  });

  it('returns 402 when MPP credential is present but mppx rejects it', async () => {
    const challenge402 = new Response(JSON.stringify({ error: 'invalid' }), {
      status: 402,
      headers: { 'WWW-Authenticate': 'Payment id="test", method="tempo"' },
    });
    const mockMppx = createMockMppx({ status: 402, challenge: challenge402 });
    const resolveVerifiedPayer: ResolveVerifiedPayer = vi.fn();

    const app = new Hono();
    const middleware = createMppPaymentMiddleware({
      mppx: mockMppx,
      requirementFn: () => ({ amount: '0.001' }),
      resolveVerifiedPayer,
    });

    app.get('/test', middleware, (c) => c.json({ ok: true }));
    const res = await app.request('/test', {
      headers: { 'Authorization': 'Payment invalid-credential' },
    });

    expect(res.status).toBe(402);
    expect(res.headers.get('WWW-Authenticate')).toContain('Payment');
    // Resolver is never consulted when mppx did not accept the charge.
    expect(resolveVerifiedPayer).not.toHaveBeenCalled();
  });

  it('returns 500 problem+json when payer resolution fails after a successful charge', async () => {
    const mockMppx = createMockMppx({
      status: 200,
      withReceipt: (res: Response) => res,
    });
    const onPayerResolutionFailure = vi.fn();
    const resolveVerifiedPayer: ResolveVerifiedPayer = vi.fn(() =>
      Promise.reject(new Error('Transfer event not found in receipt'))
    );

    const app = new Hono();
    const middleware = createMppPaymentMiddleware({
      mppx: mockMppx,
      requirementFn: () => ({ amount: '0.001' }),
      resolveVerifiedPayer,
      onPayerResolutionFailure,
    });

    app.post('/pins', middleware, (c) => c.json({ ok: true }));
    const res = await app.request('/pins', {
      method: 'POST',
      headers: { 'Authorization': 'Payment credential' },
    });

    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toBe('application/problem+json');
    const body = await res.json() as { type: string; status: number };
    expect(body.type).toBe('https://mpp.dev/errors/payer-resolution-failed');
    expect(body.status).toBe(500);
    expect(onPayerResolutionFailure).toHaveBeenCalledTimes(1);
  });

  it('calls next() when requirementFn returns null (free content)', async () => {
    const mockMppx = createMockMppx({ status: 402, challenge: new Response('', { status: 402 }) });

    const app = new Hono();
    const middleware = createMppPaymentMiddleware({
      mppx: mockMppx,
      requirementFn: () => null,
      resolveVerifiedPayer: noopResolveVerifiedPayer('0xabcdef1234567890abcdef1234567890abcdef12'),
    });

    app.get('/free', middleware, (c) => c.json({ free: true }));
    const res = await app.request('/free');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ free: true });
  });
});
