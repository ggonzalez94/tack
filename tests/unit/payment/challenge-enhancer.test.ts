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

function encodeAcceptsAmount(amount: string, payTo: string): string {
  return encodePaymentRequiredHeader({
    x402Version: 2,
    accepts: [{
      scheme: 'exact',
      network: 'eip155:167000',
      maxAmountRequired: amount,
      amount,
      asset: '0x2222222222222222222222222222222222222222',
      payTo,
      maxTimeoutSeconds: 60,
      extra: { name: 'USD Coin', version: '2' }
    }]
  });
}

describe('createMppChallengeEnhancer', () => {
  it('does not resolve pricing or generate an MPP challenge for successful responses', async () => {
    const requirementFn = vi.fn(() => ({ amount: '0.001', recipient: '0xMPP' }));
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

  it('charges MPP using the x402-advertised amount and the MPP-specific recipient', async () => {
    // The x402 middleware already computed the correct price by reading the
    // request body; reusing accepts[0].amount avoids a second body read that
    // would fail and silently fall back to minPriceUsd.
    const mppRecipient = '0xMPPrecipientEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
    const x402TaikoPayTo = '0xTAIKOx402AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const requirementFn = vi.fn(() => ({ amount: '0.001', recipient: mppRecipient }));
    const mppx = createMockMppx({
      status: 402,
      challenge: new Response('', {
        status: 402,
        headers: { 'WWW-Authenticate': 'Payment id=\"test\", method=\"tempo\"' }
      })
    });

    const app = new Hono();
    app.use(createMppChallengeEnhancer({ mppx, requirementFn, assetDecimals: 6 }));
    app.post('/pins', (c) => {
      // x402 header advertises 50 USDC (amount "50000000" at 6 decimals)
      // with the Taiko wallet as payTo. The MPP challenge should quote
      // the same 50 USDC but to the MPP wallet, NOT the Taiko wallet.
      c.header('payment-required', encodeAcceptsAmount('50000000', x402TaikoPayTo));
      return c.json({ error: 'x402 required' }, 402);
    });

    const response = await app.request('http://localhost/pins', { method: 'POST' });

    expect(response.status).toBe(402);
    expect(requirementFn).toHaveBeenCalledTimes(1);
    expect(mppx.charge).toHaveBeenCalledWith({
      amount: '50',
      recipient: mppRecipient,
    });
    expect(response.headers.get('WWW-Authenticate')).toContain('Payment');
  });

  it('falls back to requirement.amount when the x402 payment-required header is absent', async () => {
    // Not all 402 responses have an x402 header (e.g., paywalled retrieval
    // routes that didn't go through x402). In that case the challenge
    // enhancer has to trust requirementFn's amount.
    const requirementFn = vi.fn(() => ({ amount: '0.001', recipient: '0xMPP' }));
    const mppx = createMockMppx({
      status: 402,
      challenge: new Response('', {
        status: 402,
        headers: { 'WWW-Authenticate': 'Payment id=\"test\"' }
      })
    });

    const app = new Hono();
    app.use(createMppChallengeEnhancer({ mppx, requirementFn, assetDecimals: 6 }));
    app.post('/pins', (c) => c.json({ error: 'payment required' }, 402));

    await app.request('http://localhost/pins', { method: 'POST' });

    expect(mppx.charge).toHaveBeenCalledWith({
      amount: '0.001',
      recipient: '0xMPP',
    });
  });

  it('uses the MPP recipient even when the x402 header advertises a different wallet', async () => {
    // Regression test for the split X402_TAIKO_PAY_TO / MPP_PAY_TO world.
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
    app.use(createMppChallengeEnhancer({ mppx, requirementFn, assetDecimals: 6 }));
    app.post('/pins', (c) => {
      c.header('payment-required', encodeAcceptsAmount('1000', x402TaikoPayTo));
      return c.json({ error: 'x402 required' }, 402);
    });

    const response = await app.request('http://localhost/pins', { method: 'POST' });

    expect(response.status).toBe(402);
    expect(mppx.charge).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: mppRecipient })
    );
    expect(mppx.charge).not.toHaveBeenCalledWith(
      expect.objectContaining({ recipient: x402TaikoPayTo })
    );
  });
});
