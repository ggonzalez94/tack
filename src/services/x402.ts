import { HonoAdapter } from '@x402/hono';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { decodePaymentRequiredHeader, decodePaymentSignatureHeader } from '@x402/core/http';
import {
  HTTPFacilitatorClient,
  type FacilitatorClient,
  type HTTPRequestContext,
  type HTTPResponseInstructions,
  type RoutesConfig,
  x402HTTPResourceServer,
  x402ResourceServer
} from '@x402/core/server';
import type { MiddlewareHandler } from 'hono';
import type { PaymentPayload } from '@x402/core/types';
import { logger } from './logger';
import type { PaymentResult } from './payment/types.js';
import {
  calculatePriceUsd,
  parseDurationMonths,
  parseNonNegativeInteger,
  parseSizeBytesFromPinPayload,
  usdToAssetAmount
} from './payment/pricing.js';
import {
  getWalletAuthToken,
  verifyWalletAuthToken,
  normalizeWalletAddress,
  type WalletAuthConfig,
  type RequestOwnerIdentity,
} from './wallet-auth.js';

export { calculatePriceUsd, parseDurationMonths } from './payment/pricing.js';

export {
  getWalletAuthToken,
  createWalletAuthToken,
  verifyWalletAuthToken,
  normalizeWalletAddress,
  type WalletAuthConfig,
  type WalletAuthToken,
  type RequestOwnerIdentity,
  WALLET_AUTH_TOKEN_RESPONSE_HEADER,
  WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER,
} from './wallet-auth.js';

export interface X402PaymentConfig {
  facilitatorUrl: string;
  network: `${string}:${string}`;
  payTo: string;
  usdcAssetAddress: string;
  usdcAssetDecimals: number;
  usdcDomainName: string;
  usdcDomainVersion: string;
  ratePerGbMonthUsd: number;
  minPriceUsd: number;
  maxPriceUsd: number;
  defaultDurationMonths: number;
  maxDurationMonths: number;
}

export const X402_SPEC_URL = 'https://www.x402.org/';

export interface RetrievalPaymentRequirement {
  payTo: string;
  priceUsd: number;
}

export type RetrievalPaymentResolver = (
  cid: string
) => RetrievalPaymentRequirement | null | Promise<RetrievalPaymentRequirement | null>;

export interface X402PaymentMiddlewareOptions {
  resolveRetrievalPayment?: RetrievalPaymentResolver;
}

const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
const RECOMMENDED_CLIENT_INSTALL = 'npm install @x402/fetch @x402/evm';
const RECOMMENDED_CLIENT_PACKAGE = '@x402/fetch';
type PaymentErrorStatus = 402 | 403 | 412;

function resolveDurationMonths(context: HTTPRequestContext, config: Pick<X402PaymentConfig, 'defaultDurationMonths' | 'maxDurationMonths'>): number {
  return parseDurationMonths(context.adapter.getHeader('x-pin-duration-months'), config.defaultDurationMonths, config.maxDurationMonths);
}

async function resolvePinRequestSizeBytes(context: HTTPRequestContext): Promise<number> {
  const explicitSize = parseNonNegativeInteger(context.adapter.getHeader('x-content-size-bytes'));
  if (explicitSize !== undefined) {
    return explicitSize;
  }

  const rawBody = context.adapter.getBody ? await context.adapter.getBody() : undefined;
  const bodySize = parseSizeBytesFromPinPayload(rawBody);
  if (bodySize !== undefined) {
    return bodySize;
  }

  return parseNonNegativeInteger(context.adapter.getHeader('content-length')) ?? 0;
}

function resolveUploadSizeBytes(context: HTTPRequestContext): number {
  return (
    parseNonNegativeInteger(context.adapter.getHeader('x-content-size-bytes')) ??
    parseNonNegativeInteger(context.adapter.getHeader('content-length')) ??
    0
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
}

function extractWalletFromPayload(paymentPayload: PaymentPayload | Record<string, unknown>): string | null {
  const payloadRecord = asRecord((paymentPayload as PaymentPayload).payload ?? (paymentPayload as Record<string, unknown>).payload);
  if (!payloadRecord) {
    return null;
  }

  const authorization = asRecord(payloadRecord.authorization);
  const permit2Authorization = asRecord(payloadRecord.permit2Authorization);

  return (
    normalizeWalletAddress(typeof authorization?.from === 'string' ? authorization.from : undefined) ??
    normalizeWalletAddress(typeof permit2Authorization?.from === 'string' ? permit2Authorization.from : undefined) ??
    normalizeWalletAddress(typeof payloadRecord.from === 'string' ? payloadRecord.from : undefined)
  );
}

export function extractPaidWalletFromHeader(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }

  try {
    const decoded = decodePaymentSignatureHeader(headerValue);
    return extractWalletFromPayload(decoded);
  } catch {
    // Support basic base64 JSON payloads in tests and legacy clients.
    try {
      const parsed = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8')) as Record<string, unknown>;
      return extractWalletFromPayload(parsed);
    } catch {
      return null;
    }
  }
}

export function extractPaidWalletFromHeaders(headers: Headers): string | null {
  return extractPaidWalletFromHeader(getPaymentHeader(headers));
}

function getPaymentHeader(headers: Headers): string | undefined {
  return (
    headers.get('payment-signature') ??
    headers.get('PAYMENT-SIGNATURE') ??
    headers.get('x-payment') ??
    headers.get('X-PAYMENT') ??
    undefined
  );
}

export function resolveWalletFromHeaders(headers: Headers, walletAuthConfig: WalletAuthConfig): RequestOwnerIdentity {
  const { token, malformed } = getWalletAuthToken(headers);
  let authError: string | null = null;
  let wallet: string | null = null;

  if (malformed) {
    authError = 'invalid wallet auth token';
  } else if (token) {
    const verified = verifyWalletAuthToken(token, walletAuthConfig);
    wallet = verified.wallet;
    authError = verified.error;
  }

  return {
    wallet,
    authError,
    paidWallet: wallet ? null : extractPaidWalletFromHeaders(headers)
  };
}

function extractCidFromPath(path: string): string | null {
  const match = /^\/ipfs\/([^/]+)$/.exec(path);
  if (!match || !match[1]) {
    return null;
  }

  return decodeURIComponent(match[1]);
}

async function resolveRetrievalRequirement(
  context: HTTPRequestContext,
  resolver: RetrievalPaymentResolver
): Promise<RetrievalPaymentRequirement | null> {
  const cid = extractCidFromPath(context.path);
  if (!cid) {
    return null;
  }

  return resolver(cid);
}

function buildRecommendedClientInfo() {
  return {
    package: RECOMMENDED_CLIENT_PACKAGE,
    install: RECOMMENDED_CLIENT_INSTALL,
    usage: 'Wrap fetch with wrapFetchWithPaymentFromConfig() — it reads the Payment-Required header and handles payment automatically.'
  };
}

function buildProtocolInfo(x402Version = 2) {
  return {
    name: 'x402',
    version: x402Version,
    spec: X402_SPEC_URL
  };
}

function makeUnpaidResponseBody(description: string, pricingConfig?: Pick<X402PaymentConfig, 'ratePerGbMonthUsd' | 'minPriceUsd' | 'defaultDurationMonths'>) {
  return () => ({
    contentType: 'application/json' as const,
    body: {
      error: 'Payment required',
      description,
      ...(pricingConfig ? {
        pricing: {
          ratePerGbMonthUsd: pricingConfig.ratePerGbMonthUsd,
          durationMonths: pricingConfig.defaultDurationMonths,
          minPriceUsd: pricingConfig.minPriceUsd
        }
      } : {}),
      protocol: buildProtocolInfo(),
      client: buildRecommendedClientInfo(),
      note: 'Decode the base64 Payment-Required response header for full payment requirements. If your payment fails, the error reason is in that same header.'
    }
  });
}

function makeSettlementFailedResponseBody() {
  return (_context: HTTPRequestContext, settleResult: { errorReason?: string; errorMessage?: string }) => ({
    contentType: 'application/json' as const,
    body: {
      error: 'Payment settlement failed',
      reason: settleResult.errorReason,
      message: settleResult.errorMessage ?? 'The payment could not be settled on-chain.',
      spec: X402_SPEC_URL
    }
  });
}

function getResponseHeader(headers: Record<string, string>, headerName: string): string | undefined {
  const direct = headers[headerName];
  if (direct !== undefined) {
    return direct;
  }

  const expected = headerName.toLowerCase();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === expected) {
      return value;
    }
  }

  return undefined;
}

function isEmptyJsonBody(body: unknown): boolean {
  if (body === undefined || body === null) {
    return true;
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }

  return Object.keys(body as Record<string, unknown>).length === 0;
}

function createVerificationFailureResponseBody(response: HTTPResponseInstructions): Record<string, unknown> {
  const paymentRequiredHeader = getResponseHeader(response.headers, PAYMENT_REQUIRED_HEADER);

  try {
    if (paymentRequiredHeader) {
      const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
      const paymentError = paymentRequired.error;
      const allowanceRequired = paymentError === 'permit2_allowance_required';

      return {
        error: allowanceRequired ? 'Additional token approval required' : 'Payment verification failed',
        paymentError: paymentError ?? 'payment_verification_failed',
        protocol: buildProtocolInfo(paymentRequired.x402Version),
        client: buildRecommendedClientInfo(),
        hint: allowanceRequired
          ? 'Decode the base64 Payment-Required header for the allowance details, approve the required token or Permit2 allowance, and retry.'
          : 'Decode the base64 Payment-Required header for the exact verification error and refreshed payment requirements.'
      };
    }
  } catch {
    // Fall back to a generic body if the upstream header is malformed.
  }

  return {
    error: 'Payment verification failed',
    paymentError: 'payment_verification_failed',
    protocol: buildProtocolInfo(),
    client: buildRecommendedClientInfo(),
    hint: 'Decode the base64 Payment-Required header for the exact verification error and refreshed payment requirements.'
  };
}

function createUnexpectedSettlementFailureResponseBody(): Record<string, unknown> {
  return {
    error: 'Payment settlement failed',
    message: 'An unexpected settlement error occurred after the protected resource was generated.',
    spec: X402_SPEC_URL
  };
}

function resolvePaymentErrorBody(response: HTTPResponseInstructions, context: HTTPRequestContext): unknown {
  if (response.isHtml || !context.paymentHeader || !isEmptyJsonBody(response.body)) {
    return response.body ?? {};
  }

  if (response.status !== 402 && response.status !== 412) {
    return response.body ?? {};
  }

  if (!getResponseHeader(response.headers, PAYMENT_REQUIRED_HEADER)) {
    return response.body ?? {};
  }

  return createVerificationFailureResponseBody(response);
}

const SAFE_TRACING_HEADERS = [
  'x-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
];

function extractTracingHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const name of SAFE_TRACING_HEADERS) {
    const value = source.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  return headers;
}

function createPaymentMiddleware(httpServer: x402HTTPResourceServer): MiddlewareHandler {
  let initPromise: Promise<void> | null = httpServer.initialize();

  return async (c, next) => {
    // Skip x402 payment if MPP already handled it
    const paymentResult = c.get('paymentResult') as PaymentResult | undefined;
    if (paymentResult) {
      return next();
    }

    const adapter = new HonoAdapter(c);
    const context: HTTPRequestContext = {
      adapter,
      path: c.req.path,
      method: c.req.method,
      paymentHeader: adapter.getHeader('payment-signature') || adapter.getHeader('x-payment')
    };

    if (!httpServer.requiresPayment(context)) {
      return next();
    }

    if (initPromise) {
      await initPromise;
      initPromise = null;
    }

    const result = await httpServer.processHTTPRequest(context);

    switch (result.type) {
      case 'no-payment-required':
        return next();
      case 'payment-error': {
        const { response } = result;
        const body = resolvePaymentErrorBody(response, context);

        Object.entries(response.headers).forEach(([key, value]) => {
          c.header(key, value);
        });

        if (response.isHtml) {
          const html = typeof response.body === 'string' ? response.body : '';
          return c.html(html, response.status as PaymentErrorStatus);
        }

        return c.json((body ?? {}) as Record<string, unknown>, response.status as PaymentErrorStatus);
      }
      case 'payment-verified': {
        const { paymentPayload, paymentRequirements, declaredExtensions } = result;

        await next();

        let res = c.res;
        if (res.status >= 400) {
          return;
        }

        const responseBody = Buffer.from(await res.clone().arrayBuffer());
        c.res = undefined;

        try {
          const settleResult = await httpServer.processSettlement(
            paymentPayload,
            paymentRequirements,
            declaredExtensions,
            { request: context, responseBody }
          );

          if (!settleResult.success) {
            const { response } = settleResult;
            const body = response.isHtml
              ? (typeof response.body === 'string' ? response.body : '')
              : JSON.stringify(response.body ?? {});

            const errorHeaders = extractTracingHeaders(res.headers);
            Object.entries(response.headers).forEach(([key, value]) => {
              errorHeaders.set(key, value);
            });

            res = new Response(body, {
              status: response.status,
              headers: errorHeaders
            });
          } else {
            Object.entries(settleResult.headers).forEach(([key, value]) => {
              res.headers.set(key, value);
            });
          }
        } catch (error) {
          logger.error({ err: error, path: context.path, method: context.method }, 'unexpected settlement error');
          const fallbackHeaders = extractTracingHeaders(res.headers);
          res = new Response(JSON.stringify(createUnexpectedSettlementFailureResponseBody()), {
            status: 402,
            headers: fallbackHeaders
          });
        }

        c.res = res;
        return;
      }
    }
  };
}

export function createX402PaymentMiddleware(
  config: X402PaymentConfig,
  facilitatorClient?: FacilitatorClient,
  options?: X402PaymentMiddlewareOptions
): MiddlewareHandler {
  const retrievalResolver = options?.resolveRetrievalPayment;
  const facilitator = facilitatorClient ?? new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitator).register(config.network, new ExactEvmScheme());
  const exactTransferExtra = {
    name: config.usdcDomainName,
    version: config.usdcDomainVersion
  };
  const routes: RoutesConfig = {
    'POST /pins': {
      accepts: {
        scheme: 'exact',
        network: config.network,
        payTo: config.payTo,
        extra: exactTransferExtra,
        price: async (context: HTTPRequestContext) => {
          const sizeBytes = await resolvePinRequestSizeBytes(context);
          const durationMonths = resolveDurationMonths(context, config);
          const usdPrice = calculatePriceUsd(sizeBytes, durationMonths, config);
          return usdToAssetAmount(usdPrice, config.usdcAssetAddress, config.usdcAssetDecimals);
        }
      },
      description: 'Create IPFS pin',
      mimeType: 'application/json',
      unpaidResponseBody: makeUnpaidResponseBody('Pin a CID to IPFS.', config),
      settlementFailedResponseBody: makeSettlementFailedResponseBody()
    },
    'POST /upload': {
      accepts: {
        scheme: 'exact',
        network: config.network,
        payTo: config.payTo,
        extra: exactTransferExtra,
        price: (context: HTTPRequestContext) => {
          const sizeBytes = resolveUploadSizeBytes(context);
          const usdPrice = calculatePriceUsd(sizeBytes, 1, config);
          return usdToAssetAmount(usdPrice, config.usdcAssetAddress, config.usdcAssetDecimals);
        }
      },
      description: 'Upload content to IPFS',
      mimeType: 'application/json',
      unpaidResponseBody: makeUnpaidResponseBody('Upload content to IPFS and pin it.'),
      settlementFailedResponseBody: makeSettlementFailedResponseBody()
    }
  };

  if (retrievalResolver) {
    routes['GET /ipfs/[cid]'] = {
      accepts: {
        scheme: 'exact',
        network: config.network,
        extra: exactTransferExtra,
        payTo: async (context: HTTPRequestContext) => {
          const requirement = await resolveRetrievalRequirement(context, retrievalResolver);
          return requirement?.payTo ?? config.payTo;
        },
        price: async (context: HTTPRequestContext) => {
          const requirement = await resolveRetrievalRequirement(context, retrievalResolver);
          const usdPrice = requirement?.priceUsd ?? config.minPriceUsd;
          return usdToAssetAmount(usdPrice, config.usdcAssetAddress, config.usdcAssetDecimals);
        }
      },
      description: 'Retrieve IPFS content',
      mimeType: 'application/octet-stream',
      unpaidResponseBody: () => ({
        contentType: 'application/json',
        body: { error: 'Payment required to retrieve premium content' }
      })
    };
  }

  const httpServer = new x402HTTPResourceServer(resourceServer, routes);

  if (retrievalResolver) {
    httpServer.onProtectedRequest(async (context) => {
      if (context.method !== 'GET') {
        return;
      }

      const requirement = await resolveRetrievalRequirement(context, retrievalResolver);
      if (!requirement || requirement.priceUsd <= 0) {
        return { grantAccess: true };
      }

      return;
    });
  }

  return createPaymentMiddleware(httpServer);
}
