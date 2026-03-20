import type { Context, Next, MiddlewareHandler } from 'hono';
import type { PaymentResult } from './types.js';

interface MppPaymentMiddlewareConfig {
  mppx: { charge: (options: { amount: string }) => (req: Request) => Promise<any> };
  priceFn: (c: Context) => string | null | Promise<string | null>;
  extractWallet: (authHeader: string) => string;
}

export function createMppPaymentMiddleware(config: MppPaymentMiddlewareConfig): MiddlewareHandler {
  const { mppx, priceFn, extractWallet } = config;

  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');

    // Not an MPP request — let x402 global middleware handle it
    if (!authHeader?.startsWith('Payment ')) {
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
    const wallet = extractWallet(authHeader);
    c.set('paymentResult' as any, {
      wallet,
      protocol: 'mpp',
      chainName: 'tempo',
    } satisfies PaymentResult);

    await next();
    c.res = result.withReceipt(c.res);
  };
}
