import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createMppPaymentMiddleware } from '../../../src/services/payment/middleware';
import type { PaymentResult } from '../../../src/services/payment/types';

// Mock mppx charge handler
function createMockMppx(chargeResult: unknown) {
  return {
    charge: vi.fn().mockReturnValue(vi.fn().mockResolvedValue(chargeResult)),
  };
}

describe('createMppPaymentMiddleware', () => {
  it('calls next() when no MPP credential present (lets x402 handle it)', async () => {
    const mockMppx = createMockMppx({ status: 402, challenge: new Response('', { status: 402 }) });

    const app = new Hono();
    const middleware = createMppPaymentMiddleware({
      mppx: mockMppx as any,
      priceFn: () => '0.001',
      extractWallet: () => '0xabcdef1234567890abcdef1234567890abcdef12',
    });

    app.get('/test', middleware, (c) => c.json({ ok: true }));
    const res = await app.request('/test');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // mppx.charge should NOT have been called (no Payment header)
    expect(mockMppx.charge).not.toHaveBeenCalled();
  });

  it('handles MPP credential and sets paymentResult', async () => {
    const withReceipt = vi.fn((res: Response) => {
      const newHeaders = new Headers(res.headers);
      newHeaders.set('Payment-Receipt', 'test-receipt');
      return new Response(res.body, { status: res.status, headers: newHeaders });
    });
    const mockMppx = createMockMppx({ status: 200, withReceipt });

    type Env = { Variables: { paymentResult?: PaymentResult } };
    const app = new Hono<Env>();
    const middleware = createMppPaymentMiddleware({
      mppx: mockMppx as any,
      priceFn: () => '0.001',
      extractWallet: () => '0xabcdef1234567890abcdef1234567890abcdef12',
    });

    app.get('/test', middleware, (c) => {
      const result = c.get('paymentResult');
      return c.json({ wallet: result?.wallet, protocol: result?.protocol });
    });

    const res = await app.request('/test', {
      headers: { 'Authorization': 'Payment eyJ0ZXN0IjoiY3JlZGVudGlhbCJ9' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.wallet).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
    expect(body.protocol).toBe('mpp');
    expect(res.headers.get('Payment-Receipt')).toBe('test-receipt');
  });

  it('returns 402 when MPP credential is present but invalid', async () => {
    const challenge402 = new Response(JSON.stringify({ error: 'invalid' }), {
      status: 402,
      headers: { 'WWW-Authenticate': 'Payment id="test", method="tempo"' },
    });
    const mockMppx = createMockMppx({ status: 402, challenge: challenge402 });

    const app = new Hono();
    const middleware = createMppPaymentMiddleware({
      mppx: mockMppx as any,
      priceFn: () => '0.001',
      extractWallet: () => '0xabcdef1234567890abcdef1234567890abcdef12',
    });

    app.get('/test', middleware, (c) => c.json({ ok: true }));
    const res = await app.request('/test', {
      headers: { 'Authorization': 'Payment invalid-credential' },
    });

    expect(res.status).toBe(402);
    expect(res.headers.get('WWW-Authenticate')).toContain('Payment');
  });

  it('calls next() when priceFn returns null (free content)', async () => {
    const mockMppx = createMockMppx({ status: 402, challenge: new Response('', { status: 402 }) });

    const app = new Hono();
    const middleware = createMppPaymentMiddleware({
      mppx: mockMppx as any,
      priceFn: () => null,
      extractWallet: () => '0xabcdef1234567890abcdef1234567890abcdef12',
    });

    app.get('/free', middleware, (c) => c.json({ free: true }));
    const res = await app.request('/free');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ free: true });
  });
});
