import { decodePaymentRequiredHeader } from '@x402/core/http';
import type { Context, MiddlewareHandler } from 'hono';
import { extractPaymentAuthorizationCredential } from './http.js';
import type { MppPaymentRequirement, MppxChargeHandler } from './middleware.js';

interface MppChallengeEnhancerConfig {
  mppx: MppxChargeHandler;
  requirementFn: (c: Context) => MppPaymentRequirement | null | Promise<MppPaymentRequirement | null>;
  assetDecimals: number;
}

function assetAmountToDecimalString(amount: string, decimals: number): string | null {
  if (!/^\d+$/.test(amount)) {
    return null;
  }

  const zeroPadded = amount.padStart(decimals + 1, '0');
  const integerPart = zeroPadded.slice(0, zeroPadded.length - decimals) || '0';
  const fractionalPart = zeroPadded.slice(zeroPadded.length - decimals).replace(/0+$/, '');

  return fractionalPart.length > 0 ? `${integerPart}.${fractionalPart}` : integerPart;
}

function readX402AmountFromHeader(c: Context, assetDecimals: number): string | null {
  // Read the amount the x402 middleware actually advertised. We can't just
  // recompute via requirementFn because the x402 middleware runs first and
  // consumes the request body to derive the pin size; by the time this
  // enhancer runs post-response, `c.req.raw.clone().json()` inside
  // resolvePinPriceUsd throws and silently falls back to minPriceUsd — which
  // would underpay the MPP challenge relative to the x402 requirement.
  const paymentRequiredHeader = c.res.headers.get('payment-required');
  if (!paymentRequiredHeader) {
    return null;
  }

  try {
    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
    const accepted = paymentRequired.accepts[0];
    if (accepted && typeof accepted.amount === 'string') {
      return assetAmountToDecimalString(accepted.amount, assetDecimals);
    }
  } catch {
    // Malformed or missing — fall back to requirementFn's amount.
  }

  return null;
}

export function createMppChallengeEnhancer(config: MppChallengeEnhancerConfig): MiddlewareHandler {
  const { mppx, requirementFn, assetDecimals } = config;

  return async (c, next) => {
    await next();

    if (c.res.status !== 402) {
      return;
    }

    if (extractPaymentAuthorizationCredential(c.req.header('Authorization')) !== null) {
      return;
    }

    // requirementFn is the MPP-specific source of truth for the recipient
    // (it returns config.mppPayTo for /pins + /upload and policy.payTo for
    // paywalled retrieval). Always use its recipient, never accepts[0].payTo,
    // so the split X402_TAIKO_PAY_TO and MPP_PAY_TO wallets don't get crossed.
    const requirement = await requirementFn(c);
    if (!requirement) {
      return;
    }

    // Prefer the x402-advertised amount when present — the x402 middleware
    // consumed the request body to compute it, and recomputing here would
    // fail on that same body read. Fall back to requirement.amount if the
    // x402 header isn't available (e.g., paywalled retrieval 402 flows that
    // x402 didn't generate).
    const amount = readX402AmountFromHeader(c, assetDecimals) ?? requirement.amount;

    // Build a minimal synthetic request for challenge generation.
    // Omitting Authorization forces a 402 challenge (no credential to verify).
    const challengeReq = new Request(c.req.url, {
      method: c.req.method,
      headers: {},
    });
    const mppResult = await mppx.charge({ amount, recipient: requirement.recipient })(challengeReq);

    if (mppResult.status !== 402) {
      return;
    }

    const wwwAuth = mppResult.challenge.headers.get('WWW-Authenticate');
    if (!wwwAuth) {
      return;
    }

    const existingBody = await c.res.text();
    const headers = new Headers(c.res.headers);
    headers.set('WWW-Authenticate', wwwAuth);
    c.res = new Response(existingBody, { status: 402, headers });
  };
}
