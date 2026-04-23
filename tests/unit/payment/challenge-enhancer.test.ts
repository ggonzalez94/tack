import { Hono } from 'hono';
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
    const requirementFn = vi.fn(() => ({ amount: '0.001', recipient: '0xMPP' }));
    const mppx = createMockMppx({
      status: 402,
      challenge: new Response('', { status: 402, headers: { 'WWW-Authenticate': 'Payment id=\"test\"' } })
    });

    const app = new Hono();
    app.use(createMppChallengeEnhancer({ mppx, requirementFn }));
    app.get('/pins', (c) => c.json({ ok: true }));

    const response = await app.request('http://localhost/pins');

    expect(response.status).toBe(200);
    expect(requirementFn).not.toHaveBeenCalled();
    expect(mppx.charge).not.toHaveBeenCalled();
  });

  it('adds the MPP challenge for 402 responses using the MPP-specific requirement', async () => {
    const requirementFn = vi.fn(() => ({
      amount: '0.001',
      recipient: '0xMPPrecipientEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
    }));
    const mppx = createMockMppx({
      status: 402,
      challenge: new Response(JSON.stringify({ error: 'mpp required' }), {
        status: 402,
        headers: { 'WWW-Authenticate': 'Payment id=\"test\", method=\"tempo\"' }
      })
    });

    const app = new Hono();
    app.use(createMppChallengeEnhancer({ mppx, requirementFn }));
    app.post('/pins', (c) => c.json({ error: 'x402 required' }, 402));

    const response = await app.request('http://localhost/pins', { method: 'POST' });

    expect(response.status).toBe(402);
    expect(requirementFn).toHaveBeenCalledTimes(1);
    expect(mppx.charge).toHaveBeenCalledTimes(1);
    expect(mppx.charge).toHaveBeenCalledWith({
      amount: '0.001',
      recipient: '0xMPPrecipientEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
    });
    expect(response.headers.get('WWW-Authenticate')).toContain('Payment');
    await expect(response.json()).resolves.toEqual({ error: 'x402 required' });
  });

  it('uses the MPP recipient even when an x402 payment-required header advertises a different wallet', async () => {
    // Regression test for the split X402_TAIKO_PAY_TO / MPP_PAY_TO world:
    // if the challenge enhancer mirrored the x402 header's payTo, MPP clients
    // would be told to pay the Taiko x402 wallet on Tempo and settlement
    // verification (which checks against config.mppPayTo) would reject every
    // charge.
    const mppRecipient = '0xMPPrecipientEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
    const x402TaikoPayTo = '0xTAIKOx402AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const requirementFn = vi.fn(() => ({ amount: '0.001', recipient: mppRecipient }));
    const mppx = createMockMppx({
      status: 402,
      challenge: new Response('', {
        status: 402,
        headers: { 'WWW-Authenticate': `Payment recipient="${mppRecipient}"` }
      })
    });

    const app = new Hono();
    app.use(createMppChallengeEnhancer({ mppx, requirementFn }));
    app.post('/pins', (c) => {
      // Simulate x402 middleware having emitted a payment-required header
      // whose accepts[0].payTo is the Taiko x402 wallet, NOT the MPP wallet.
      c.header('payment-required', `stub-base64-header-with-payTo-${x402TaikoPayTo}`);
      return c.json({ error: 'x402 required' }, 402);
    });

    const response = await app.request('http://localhost/pins', { method: 'POST' });

    expect(response.status).toBe(402);
    expect(mppx.charge).toHaveBeenCalledWith({
      amount: '0.001',
      recipient: mppRecipient,
    });
  });
});
