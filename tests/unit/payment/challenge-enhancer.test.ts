import { Hono } from 'hono';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { describe, expect, it, vi } from 'vitest';
import {
  type MppChargeResult,
  type MppxChargeHandler
} from '../../../src/services/payment/middleware';
import { createMppChallengeEnhancer } from '../../../src/services/payment/challenge-enhancer';

function createMockMppx(chargeResult: MppChargeResult): MppxChargeHandler {
  const handler = vi.fn(() => Promise.resolve(chargeResult));
  return {
    charge: vi.fn(() => handler),
  };
}

describe('createMppChallengeEnhancer', () => {
  it('does not resolve pricing or generate an MPP challenge for successful responses', async () => {
    const requirementFn = vi.fn(() => ({ amount: '0.001' }));
    const mppx = createMockMppx({
      status: 402,
      challenge: new Response('', { status: 402, headers: { 'WWW-Authenticate': 'Payment id=\"test\"' } })
    });

    const app = new Hono();
    app.use(createMppChallengeEnhancer({ mppx, requirementFn, assetDecimals: 6 }));
    app.get('/pins', (c) => c.json({ ok: true }));

    const response = await app.request('http://localhost/pins');

    expect(response.status).toBe(200);
    expect(requirementFn).not.toHaveBeenCalled();
    expect(mppx.charge).not.toHaveBeenCalled();
  });

  it('adds the MPP challenge for x402 402 responses using the existing x402 amount and payee', async () => {
    const requirementFn = vi.fn(() => ({ amount: '0.001' }));
    const paymentRequired = encodePaymentRequiredHeader({
      x402Version: 2,
      accepts: [{
        scheme: 'exact',
        network: 'eip155:167000',
        maxAmountRequired: '1000',
        amount: '1000',
        asset: '0x2222222222222222222222222222222222222222',
        payTo: '0x1111111111111111111111111111111111111111',
        maxTimeoutSeconds: 60,
        extra: {
          name: 'USD Coin',
          version: '2'
        }
      }]
    });
    const mppx = createMockMppx({
      status: 402,
      challenge: new Response(JSON.stringify({ error: 'mpp required' }), {
        status: 402,
        headers: { 'WWW-Authenticate': 'Payment id=\"test\", method=\"tempo\"' }
      })
    });

    const app = new Hono();
    app.use(createMppChallengeEnhancer({ mppx, requirementFn, assetDecimals: 6 }));
    app.get('/pins', (c) => {
      c.header('payment-required', paymentRequired);
      return c.json({ error: 'x402 required' }, 402);
    });

    const response = await app.request('http://localhost/pins');

    expect(response.status).toBe(402);
    expect(requirementFn).not.toHaveBeenCalled();
    expect(mppx.charge).toHaveBeenCalledTimes(1);
    expect(mppx.charge).toHaveBeenCalledWith({
      amount: '0.001',
      recipient: '0x1111111111111111111111111111111111111111',
    });
    expect(response.headers.get('WWW-Authenticate')).toContain('Payment');
    await expect(response.json()).resolves.toEqual({ error: 'x402 required' });
  });
});
