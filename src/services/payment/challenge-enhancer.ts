import type { Context, MiddlewareHandler } from 'hono';
import { extractPaymentAuthorizationCredential } from './http.js';
import type { MppPaymentRequirement, MppxChargeHandler } from './middleware.js';

interface MppChallengeEnhancerConfig {
  mppx: MppxChargeHandler;
  requirementFn: (c: Context) => MppPaymentRequirement | null | Promise<MppPaymentRequirement | null>;
}

export function createMppChallengeEnhancer(config: MppChallengeEnhancerConfig): MiddlewareHandler {
  const { mppx, requirementFn } = config;

  return async (c, next) => {
    await next();

    if (c.res.status !== 402) {
      return;
    }

    if (extractPaymentAuthorizationCredential(c.req.header('Authorization')) !== null) {
      return;
    }

    // Always consult requirementFn — it's the MPP-specific source of truth for
    // both amount and recipient. A previous revision read `accepts[0].payTo`
    // from the x402 payment-required header as an optimization, but that made
    // the MPP challenge advertise the x402 Taiko wallet instead of the MPP
    // Tempo wallet once the two env vars were split. The amount parity with
    // x402 is preserved because both paths derive price from the same pricing
    // config via `resolvePinPriceUsd` / `resolveUploadPriceUsd`.
    const requirement = await requirementFn(c);
    if (!requirement) {
      return;
    }

    // Build a minimal synthetic request for challenge generation.
    // Omitting Authorization forces a 402 challenge (no credential to verify).
    const challengeReq = new Request(c.req.url, {
      method: c.req.method,
      headers: {},
    });
    const mppResult = await mppx.charge(requirement)(challengeReq);

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
