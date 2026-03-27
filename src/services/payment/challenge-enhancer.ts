import { decodePaymentRequiredHeader } from '@x402/core/http';
import type { Context, MiddlewareHandler } from 'hono';
import { extractPaymentAuthorizationCredential } from './http.js';
import type { MppxChargeHandler } from './middleware.js';

interface MppChallengeEnhancerConfig {
  mppx: MppxChargeHandler;
  priceFn: (c: Context) => string | null | Promise<string | null>;
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

async function resolveChallengePriceUsd(
  c: Context,
  priceFn: (c: Context) => string | null | Promise<string | null>,
  assetDecimals: number
): Promise<string | null> {
  const paymentRequiredHeader = c.res.headers.get('payment-required');
  if (paymentRequiredHeader) {
    try {
      const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
      const accepted = paymentRequired.accepts[0];
      if (accepted) {
        const amount = accepted.amount;
        if (typeof amount === 'string') {
          const price = assetAmountToDecimalString(amount, assetDecimals);
          if (price !== null) {
            return price;
          }
        }
      }
    } catch {
      // Fall back to route-specific pricing when the x402 header is unavailable or malformed.
    }
  }

  return priceFn(c);
}

export function createMppChallengeEnhancer(config: MppChallengeEnhancerConfig): MiddlewareHandler {
  const { mppx, priceFn, assetDecimals } = config;

  return async (c, next) => {
    await next();

    if (c.res.status !== 402) {
      return;
    }

    if (extractPaymentAuthorizationCredential(c.req.header('Authorization')) !== null) {
      return;
    }

    const priceUsd = await resolveChallengePriceUsd(c, priceFn, assetDecimals);
    if (!priceUsd) {
      return;
    }

    // Build a minimal synthetic request for challenge generation.
    // Omitting Authorization forces a 402 challenge (no credential to verify).
    const challengeReq = new Request(c.req.url, {
      method: c.req.method,
      headers: {},
    });
    const mppResult = await mppx.charge({ amount: priceUsd })(challengeReq);

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
