import type { Context, Next, MiddlewareHandler } from 'hono';
import { extractPaymentAuthorizationCredential } from './http.js';
import type { PaymentResult } from './types.js';

export interface MppChargeChallengeResult {
  status: 402;
  challenge: Response;
}

export interface MppChargeSuccessResult {
  status: 200;
  withReceipt: (response: Response) => Response;
}

export type MppChargeResult = MppChargeChallengeResult | MppChargeSuccessResult;

export interface MppxChargeHandler {
  charge: (options: { amount: string }) => (req: Request) => Promise<MppChargeResult>;
}

interface MppPaymentMiddlewareConfig {
  mppx: MppxChargeHandler;
  priceFn: (c: Context) => string | null | Promise<string | null>;
  extractWallet: (credential: string) => string;
}

export function createMppPaymentMiddleware(config: MppPaymentMiddlewareConfig): MiddlewareHandler {
  const { mppx, priceFn, extractWallet } = config;

  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    const credential = extractPaymentAuthorizationCredential(authHeader);

    // Not an MPP request — let x402 global middleware handle it
    if (credential === null) {
      return next();
    }

    const priceUsd = await priceFn(c);

    // Free content — no payment required
    if (priceUsd === null) {
      return next();
    }

    // MPP credential present — verify and settle via mppx
    const result = await mppx.charge({ amount: priceUsd })(c.req.raw);

    if (result.status === 402) {
      // Credential was present but invalid — return MPP-specific 402
      return result.challenge;
    }

    // Payment verified + settled. Extract wallet and set context.
    const wallet = extractWallet(credential);
    c.set('paymentResult' as any, {
      wallet,
      protocol: 'mpp',
      chainName: 'tempo',
    } satisfies PaymentResult);

    await next();
    c.res = result.withReceipt(c.res);
  };
}
