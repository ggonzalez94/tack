import type { Context, MiddlewareHandler } from 'hono';
import { extractPaymentAuthorizationCredential } from './http.js';
import type { MppxChargeHandler } from './middleware.js';

interface MppChallengeEnhancerConfig {
  mppx: MppxChargeHandler;
  priceFn: (c: Context) => string | null | Promise<string | null>;
}

export function createMppChallengeEnhancer(config: MppChallengeEnhancerConfig): MiddlewareHandler {
  const { mppx, priceFn } = config;

  return async (c, next) => {
    await next();

    if (c.res.status !== 402) {
      return;
    }

    if (extractPaymentAuthorizationCredential(c.req.header('Authorization')) !== null) {
      return;
    }

    const priceUsd = await priceFn(c);
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
