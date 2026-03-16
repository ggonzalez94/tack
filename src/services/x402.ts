import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
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

interface AssetAmountPrice {
  amount: string;
  asset: string;
}

export interface X402PaymentConfig {
  facilitatorUrl: string;
  network: `${string}:${string}`;
  payTo: string;
  usdcAssetAddress: string;
  usdcAssetDecimals: number;
  usdcDomainName: string;
  usdcDomainVersion: string;
  basePriceUsd: number;
  pricePerMbUsd: number;
  maxPriceUsd: number;
}

export interface WalletAuthConfig {
  secret: string;
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

export interface RequestOwnerIdentity {
  wallet: string | null;
  authError: string | null;
  paidWallet: string | null;
}

export interface WalletAuthToken {
  token: string;
  expiresAt: string;
}

export const WALLET_AUTH_TOKEN_RESPONSE_HEADER = 'x-wallet-auth-token';
export const WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER = 'x-wallet-auth-token-expires-at';
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

const MAX_WALLET_AUTH_CLOCK_SKEW_SECONDS = 60;
const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
const RECOMMENDED_CLIENT_INSTALL = 'npm install @x402/fetch @x402/evm';
const RECOMMENDED_CLIENT_PACKAGE = '@x402/fetch';
type PaymentErrorStatus = 402 | 403 | 412;

function parsePositiveInteger(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    return undefined;
  }

  return value;
}

function parseSizeFromPinBody(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const bodyRecord = body as Record<string, unknown>;

  const directSize = bodyRecord.sizeBytes;
  if (typeof directSize === 'number' && Number.isFinite(directSize) && directSize >= 0) {
    return Math.trunc(directSize);
  }

  const meta = bodyRecord.meta;
  if (!meta || typeof meta !== 'object') {
    return undefined;
  }

  const metaRecord = meta as Record<string, unknown>;
  const metaSize = metaRecord.contentSizeBytes ?? metaRecord.sizeBytes;

  if (typeof metaSize === 'string') {
    return parsePositiveInteger(metaSize);
  }

  if (typeof metaSize === 'number' && Number.isFinite(metaSize) && metaSize >= 0) {
    return Math.trunc(metaSize);
  }

  return undefined;
}

async function resolvePinRequestSizeBytes(context: HTTPRequestContext): Promise<number> {
  const headerSize =
    parsePositiveInteger(context.adapter.getHeader('x-content-size-bytes')) ??
    parsePositiveInteger(context.adapter.getHeader('content-length'));

  if (headerSize !== undefined) {
    return headerSize;
  }

  const rawBody = context.adapter.getBody ? await context.adapter.getBody() : undefined;
  return parseSizeFromPinBody(rawBody) ?? 0;
}

function resolveUploadSizeBytes(context: HTTPRequestContext): number {
  return (
    parsePositiveInteger(context.adapter.getHeader('x-content-size-bytes')) ??
    parsePositiveInteger(context.adapter.getHeader('content-length')) ??
    0
  );
}

export function calculatePriceUsd(sizeBytes: number, config: Pick<X402PaymentConfig, 'basePriceUsd' | 'pricePerMbUsd' | 'maxPriceUsd'>): number {
  const base = config.basePriceUsd;
  const max = config.maxPriceUsd;
  const perMb = config.pricePerMbUsd;

  if (sizeBytes <= 1_000_000) {
    return Math.min(base, max);
  }

  const additionalBytes = sizeBytes - 1_000_000;
  const additionalMegabytes = Math.ceil(additionalBytes / 1_000_000);
  return Math.min(base + additionalMegabytes * perMb, max);
}

function usdToAssetAmount(usdAmount: number, assetAddress: string, assetDecimals: number): AssetAmountPrice {
  const factor = 10 ** assetDecimals;
  const scaled = Math.max(1, Math.round((usdAmount + Number.EPSILON) * factor));

  return {
    amount: String(scaled),
    asset: assetAddress
  };
}

function normalizeWalletAddress(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    return null;
  }

  return trimmed.toLowerCase();
}

function toBase64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9\-_]+$/.test(value)) {
    return null;
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  try {
    return Buffer.from(padded, 'base64');
  } catch {
    return null;
  }
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

function getWalletAuthToken(headers: Headers): { token: string | null; malformed: boolean } {
  const directToken = headers.get('x-wallet-auth-token');
  if (directToken !== null) {
    const token = directToken.trim();
    return {
      token: token.length > 0 ? token : null,
      malformed: token.length === 0
    };
  }

  const authorization = headers.get('authorization');
  if (authorization === null) {
    return { token: null, malformed: false };
  }

  const trimmed = authorization.trim();
  if (trimmed.length === 0) {
    return { token: null, malformed: true };
  }

  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    return { token: null, malformed: true };
  }

  const token = trimmed.slice(7).trim();
  return {
    token: token.length > 0 ? token : null,
    malformed: token.length === 0
  };
}

function verifyWalletAuthToken(token: string, config: WalletAuthConfig): { wallet: string | null; error: string | null } {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return { wallet: null, error: 'invalid wallet auth token' };
  }

  const [headerSegment, payloadSegment, signatureSegment] = segments;
  const headerBuffer = fromBase64Url(headerSegment);
  const payloadBuffer = fromBase64Url(payloadSegment);

  if (!headerBuffer || !payloadBuffer || signatureSegment.length === 0) {
    return { wallet: null, error: 'invalid wallet auth token' };
  }

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;

  try {
    header = JSON.parse(headerBuffer.toString('utf8')) as Record<string, unknown>;
    payload = JSON.parse(payloadBuffer.toString('utf8')) as Record<string, unknown>;
  } catch {
    return { wallet: null, error: 'invalid wallet auth token' };
  }

  if (header.alg !== 'HS256') {
    return { wallet: null, error: 'unsupported wallet auth token algorithm' };
  }

  const expectedSignature = toBase64Url(
    createHmac('sha256', config.secret)
      .update(`${headerSegment}.${payloadSegment}`)
      .digest()
  );
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const actualBuffer = Buffer.from(signatureSegment, 'utf8');

  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { wallet: null, error: 'invalid wallet auth token signature' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuedAt = typeof payload.iat === 'number' && Number.isFinite(payload.iat)
    ? Math.trunc(payload.iat)
    : null;
  if (issuedAt === null) {
    return { wallet: null, error: 'wallet auth token issued-at is invalid' };
  }

  if (issuedAt > nowSeconds + MAX_WALLET_AUTH_CLOCK_SKEW_SECONDS) {
    return { wallet: null, error: 'wallet auth token issued-at is invalid' };
  }

  const expiresAt = typeof payload.exp === 'number' && Number.isFinite(payload.exp)
    ? Math.trunc(payload.exp)
    : null;
  if (expiresAt === null) {
    return { wallet: null, error: 'wallet auth token expiration is required' };
  }

  if (expiresAt <= issuedAt) {
    return { wallet: null, error: 'wallet auth token expiration is invalid' };
  }

  if (expiresAt - issuedAt > config.ttlSeconds) {
    return { wallet: null, error: 'wallet auth token lifetime exceeds maximum' };
  }

  if (nowSeconds >= expiresAt) {
    return { wallet: null, error: 'wallet auth token has expired' };
  }

  if (typeof payload.nbf === 'number' && Number.isFinite(payload.nbf) && nowSeconds < payload.nbf) {
    return { wallet: null, error: 'wallet auth token is not active yet' };
  }

  if (payload.iss !== config.issuer) {
    return { wallet: null, error: 'wallet auth token issuer is invalid' };
  }

  const audience = payload.aud;
  const validAudience = typeof audience === 'string'
    ? audience === config.audience
    : Array.isArray(audience)
      ? audience.includes(config.audience)
      : false;
  if (!validAudience) {
    return { wallet: null, error: 'wallet auth token audience is invalid' };
  }

  const wallet = normalizeWalletAddress(
    typeof payload.sub === 'string'
      ? payload.sub
      : typeof payload.wallet === 'string'
        ? payload.wallet
        : undefined
  );

  if (!wallet) {
    return { wallet: null, error: 'wallet auth token subject is invalid' };
  }

  return { wallet, error: null };
}

export function createWalletAuthToken(walletAddress: string, config: WalletAuthConfig): WalletAuthToken {
  const wallet = normalizeWalletAddress(walletAddress);
  if (!wallet) {
    throw new Error('wallet auth token wallet address is invalid');
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + config.ttlSeconds;
  const header = toBase64Url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8'));
  const payload = toBase64Url(
    Buffer.from(
      JSON.stringify({
        sub: wallet,
        iss: config.issuer,
        aud: config.audience,
        iat: issuedAt,
        nbf: issuedAt,
        exp: expiresAt,
        jti: randomUUID()
      }),
      'utf8'
    )
  );
  const signature = toBase64Url(
    createHmac('sha256', config.secret)
      .update(`${header}.${payload}`)
      .digest()
  );

  return {
    token: `${header}.${payload}.${signature}`,
    expiresAt: new Date(expiresAt * 1000).toISOString()
  };
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

function makeUnpaidResponseBody(description: string) {
  return () => ({
    contentType: 'application/json' as const,
    body: {
      error: 'Payment required',
      description,
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

function createPaymentMiddleware(httpServer: x402HTTPResourceServer): MiddlewareHandler {
  let initPromise: Promise<void> | null = httpServer.initialize();

  return async (c, next) => {
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

            const mergedHeaders = new Headers(res.headers);
            Object.entries(response.headers).forEach(([key, value]) => {
              mergedHeaders.set(key, value);
            });

            res = new Response(body, {
              status: response.status,
              headers: mergedHeaders
            });
          } else {
            Object.entries(settleResult.headers).forEach(([key, value]) => {
              res.headers.set(key, value);
            });
          }
        } catch (error) {
          console.error(error);
          const fallbackHeaders = new Headers(res.headers);
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
          const usdPrice = calculatePriceUsd(sizeBytes, config);
          return usdToAssetAmount(usdPrice, config.usdcAssetAddress, config.usdcAssetDecimals);
        }
      },
      description: 'Create IPFS pin',
      mimeType: 'application/json',
      unpaidResponseBody: makeUnpaidResponseBody('Pin a CID to IPFS.'),
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
          const usdPrice = calculatePriceUsd(sizeBytes, config);
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
          const usdPrice = requirement?.priceUsd ?? config.basePriceUsd;
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
