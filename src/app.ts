import { randomUUID } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  GatewayTimeoutError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitError,
  UpstreamServiceError,
  ValidationError
} from './lib/errors';
import { isTrustedProxy } from './lib/proxy-trust';
import { createExternalRequestUrlMiddleware } from './lib/request-url';
import { toPinStatusResponse, type PinningService } from './services/pinning-service';
import type { InMemoryRateLimiter } from './services/rate-limiter';
import { logger } from './services/logger';
import { createContentDispositionHeader, shouldServeContentAsAttachment } from './services/content-type';
import {
  createWalletAuthToken,
  extractPaidWalletFromHeaders,
  resolveWalletFromHeaders,
  WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER,
  WALLET_AUTH_TOKEN_RESPONSE_HEADER,
  X402_SPEC_URL,
  type WalletAuthConfig
} from './services/x402';
import type { PinStatusValue } from './types';
import { landingPageHtml } from './landing';

const DEFAULT_GATEWAY_CACHE_CONTROL_MAX_AGE_SECONDS = 31536000;
const DEFAULT_UPLOAD_MAX_SIZE_BYTES = 100 * 1024 * 1024;
const MULTIPART_REQUEST_SIZE_OVERHEAD_BYTES = 64 * 1024;

interface ByteRange {
  start: number;
  end: number;
}

function parseStatusQuery(raw: string | undefined): PinStatusValue[] | undefined {
  if (!raw) {
    return undefined;
  }

  const allowed: PinStatusValue[] = ['queued', 'pinning', 'pinned', 'failed'];
  const statuses = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean) as PinStatusValue[];

  if (statuses.some((status) => !allowed.includes(status))) {
    throw new ValidationError('Invalid status filter');
  }

  return statuses;
}

function parseLimit(raw: string | undefined): number {
  if (!raw) {
    return 10;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new ValidationError('limit must be an integer between 1 and 1000');
  }

  return value;
}

function parseOffset(raw: string | undefined): number {
  if (!raw) {
    return 0;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError('offset must be a non-negative integer');
  }

  return value;
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}

function parsePinPayload(payload: unknown): {
  cid: string;
  name?: string;
  origins?: string[];
  meta?: Record<string, string>;
} {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Payload must be an object');
  }

  const body = payload as Record<string, unknown>;

  if (typeof body.cid !== 'string' || body.cid.length === 0) {
    throw new ValidationError('cid is required and must be a non-empty string');
  }

  if (body.name !== undefined && typeof body.name !== 'string') {
    throw new ValidationError('name must be a string');
  }

  if (body.origins !== undefined && (!Array.isArray(body.origins) || body.origins.some((origin) => typeof origin !== 'string'))) {
    throw new ValidationError('origins must be an array of strings');
  }

  if (body.meta !== undefined && !isRecordOfStrings(body.meta)) {
    throw new ValidationError('meta must be an object with string values');
  }

  return {
    cid: body.cid,
    name: body.name === undefined ? undefined : body.name,
    origins: body.origins === undefined ? undefined : body.origins,
    meta: body.meta === undefined ? undefined : body.meta
  };
}

function requireOwnerWallet(c: {
  get: (key: 'walletAddress' | 'walletAuthError') => string | null;
}): string {
  const wallet = c.get('walletAddress');
  if (wallet) {
    return wallet;
  }

  const authError = c.get('walletAuthError');
  if (authError) {
    throw new HTTPException(401, { message: authError });
  }

  throw new HTTPException(401, {
    message: 'authenticated wallet identity is required (bearer token)'
  });
}

function requirePaidWallet(headers: Headers): string {
  const wallet = extractPaidWalletFromHeaders(headers);
  if (!wallet) {
    throw new HTTPException(401, { message: 'verified payment wallet identity is required' });
  }

  return wallet;
}

function issueWalletAuthToken(
  c: { header: (name: string, value: string) => void },
  wallet: string,
  walletAuth: WalletAuthConfig
): void {
  const token = createWalletAuthToken(wallet, walletAuth);
  c.header(WALLET_AUTH_TOKEN_RESPONSE_HEADER, token.token);
  c.header(WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER, token.expiresAt);
  c.header('Cache-Control', 'no-store');
}

async function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

function normalizeIp(value: string): string {
  return value.trim().toLowerCase();
}

function getRequesterIp(
  env: { incoming?: { socket?: { remoteAddress?: string | null } } } | undefined,
  headers: Headers,
  trustProxy: boolean,
  trustedProxyCidrs: string[]
): string {
  const remoteAddress = env?.incoming?.socket?.remoteAddress;
  const normalizedRemoteAddress = typeof remoteAddress === 'string' && remoteAddress.length > 0
    ? normalizeIp(remoteAddress)
    : 'unknown';

  if (!trustProxy || !isTrustedProxy(remoteAddress, trustedProxyCidrs)) {
    return normalizedRemoteAddress;
  }

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const clientIp = normalizeIp(forwarded.split(',')[0] ?? '');
    if (clientIp.length > 0) {
      return clientIp;
    }
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) {
    const clientIp = normalizeIp(realIp);
    if (clientIp.length > 0) {
      return clientIp;
    }
  }

  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) {
    const clientIp = normalizeIp(cfIp);
    if (clientIp.length > 0) {
      return clientIp;
    }
  }

  return normalizedRemoteAddress;
}

function parseRangeHeader(raw: string | null, totalSize: number): ByteRange | null {
  if (!raw) {
    return null;
  }

  if (!raw.startsWith('bytes=')) {
    return null;
  }

  const rawRange = raw.slice('bytes='.length).trim();
  if (rawRange.length === 0 || rawRange.includes(',')) {
    return null;
  }

  const [startPart, endPart] = rawRange.split('-', 2);
  if (startPart === undefined || endPart === undefined) {
    return null;
  }

  if (startPart.length === 0) {
    const suffixLength = Number(endPart);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    const start = Math.max(totalSize - suffixLength, 0);
    return { start, end: totalSize - 1 };
  }

  const start = Number(startPart);
  if (!Number.isInteger(start) || start < 0 || start >= totalSize) {
    return null;
  }

  if (endPart.length === 0) {
    return { start, end: totalSize - 1 };
  }

  const parsedEnd = Number(endPart);
  if (!Number.isInteger(parsedEnd) || parsedEnd < start) {
    return null;
  }

  return { start, end: Math.min(parsedEnd, totalSize - 1) };
}

function parseDeclaredRequestSize(headers: Headers): number | null {
  const rawCustom = headers.get('x-content-size-bytes');
  const rawContentLength = headers.get('content-length');

  if (!rawCustom && !rawContentLength) {
    return null;
  }

  let result: number | null = null;

  if (rawCustom) {
    const parsed = Number(rawCustom);
    if (Number.isInteger(parsed) && parsed >= 0) {
      result = parsed;
    }
  }

  if (rawContentLength) {
    const parsed = Number(rawContentLength);
    if (Number.isInteger(parsed) && parsed >= 0) {
      result = result === null ? parsed : Math.max(result, parsed);
    }
  }

  return result;
}

function ifNoneMatchIncludesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) {
    return false;
  }

  if (ifNoneMatch.trim() === '*') {
    return true;
  }

  return ifNoneMatch
    .split(',')
    .map((value) => value.trim())
    .includes(etag);
}

function statusFromError(error: unknown): number {
  if (error instanceof HTTPException) {
    return error.status;
  }

  if (error instanceof ValidationError) {
    return 400;
  }

  if (error instanceof PayloadTooLargeError) {
    return 413;
  }

  if (error instanceof RateLimitError) {
    return 429;
  }

  if (error instanceof GatewayTimeoutError) {
    return 504;
  }

  if (error instanceof UpstreamServiceError) {
    return 502;
  }

  if (error instanceof NotFoundError) {
    return 404;
  }

  return 500;
}

export interface AgentCardConfig {
  name: string;
  description: string;
  version: string;
  x402Network: string;
  x402UsdcAssetAddress: string;
  x402BasePriceUsd: number;
  x402PricePerMbUsd: number;
  x402MaxPriceUsd: number;
  // MPP fields:
  mppMethod?: string;
  mppChainId?: number;
  mppAsset?: string;
  mppAssetSymbol?: string;
}

export interface AppServices {
  pinningService: PinningService;
  paymentMiddleware: MiddlewareHandler;
  mppMiddleware?: MiddlewareHandler;
  mppChallengeEnhancer?: MiddlewareHandler;
  walletAuth: WalletAuthConfig;
  gatewayCacheControlMaxAgeSeconds?: number;
  uploadMaxSizeBytes?: number;
  publicBaseUrl?: string;
  trustProxy?: boolean;
  trustedProxyCidrs?: string[];
  rateLimiter?: InMemoryRateLimiter;
  healthCheck?: () => Promise<void>;
  agentCard?: AgentCardConfig;
}

interface AppEnv {
  Bindings: {
    incoming?: {
      socket?: {
        remoteAddress?: string | null;
      };
    };
  };
  Variables: {
    requestId: string;
    walletAddress: string | null;
    walletAuthError: string | null;
    paymentResult?: import('./services/payment/types.js').PaymentResult;
  };
}

export function createApp(services: AppServices): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const cacheControlMaxAgeSeconds = services.gatewayCacheControlMaxAgeSeconds ?? DEFAULT_GATEWAY_CACHE_CONTROL_MAX_AGE_SECONDS;
  const uploadMaxSizeBytes = services.uploadMaxSizeBytes ?? DEFAULT_UPLOAD_MAX_SIZE_BYTES;
  const publicBaseUrl = services.publicBaseUrl;
  const trustProxy = services.trustProxy ?? false;
  const trustedProxyCidrs = services.trustedProxyCidrs ?? [];

  app.use('*', createExternalRequestUrlMiddleware({
    publicBaseUrl,
    trustProxy,
    trustedProxyCidrs
  }));

  app.get('/', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.html(landingPageHtml(origin));
  });

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    const requestPath = new URL(c.req.url).pathname;
    const requestStartedAt = Date.now();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);

    const identity = resolveWalletFromHeaders(c.req.raw.headers, services.walletAuth);
    c.set('walletAddress', identity.wallet);
    c.set('walletAuthError', identity.authError);

    try {
      if (services.rateLimiter) {
        const key = identity.wallet ?? `ip:${getRequesterIp(c.env, c.req.raw.headers, trustProxy, trustedProxyCidrs)}`;
        const rateLimit = services.rateLimiter.consume(key);
        c.header('X-RateLimit-Limit', String(rateLimit.limit));
        c.header('X-RateLimit-Remaining', String(rateLimit.remaining));

        if (!rateLimit.allowed) {
          c.header('Retry-After', String(rateLimit.retryAfterSeconds));
          throw new RateLimitError('Rate limit exceeded', rateLimit.retryAfterSeconds);
        }
      }

      await next();
      logger.info({
        requestId,
        method: c.req.method,
        path: requestPath,
        status: c.res.status,
        durationMs: Date.now() - requestStartedAt,
        walletAddress: identity.wallet,
      }, 'request handled');
    } catch (error) {
      logger.error({
        requestId,
        method: c.req.method,
        path: requestPath,
        status: statusFromError(error),
        durationMs: Date.now() - requestStartedAt,
        walletAddress: identity.wallet,
        err: error
      }, 'request failed');
      throw error;
    }
  });

  // MPP middleware runs first on payment-gated routes
  if (services.mppMiddleware) {
    app.use('/pins', services.mppMiddleware);
    app.use('/pins/*', services.mppMiddleware);
    app.use('/upload', services.mppMiddleware);
    app.use('/ipfs/*', services.mppMiddleware);
  }

  app.use(services.paymentMiddleware);

  if (services.mppChallengeEnhancer) {
    app.use(services.mppChallengeEnhancer);
  }

  app.get('/health', async (c) => {
    if (!services.healthCheck) {
      return c.json({ status: 'ok' });
    }

    try {
      await services.healthCheck();
      return c.json({
        status: 'ok',
        dependencies: {
          ipfs: 'ok'
        }
      });
    } catch {
      return c.json({
        status: 'degraded',
        dependencies: {
          ipfs: 'unreachable'
        }
      }, 503);
    }
  });

  app.get('/.well-known/agent.json', (c) => {
    const origin = new URL(c.req.url).origin;
    const agent = services.agentCard;

    const protocols: Array<Record<string, unknown>> = [
      {
        protocol: 'x402',
        chain: 'taiko',
        chainId: 167000,
        asset: agent?.x402UsdcAssetAddress,
        network: agent?.x402Network,
      },
    ];

    if (agent?.mppMethod) {
      protocols.push({
        protocol: 'mpp',
        method: agent.mppMethod,
        chain: 'tempo',
        chainId: agent.mppChainId,
        asset: agent.mppAsset,
        assetSymbol: agent.mppAssetSymbol,
        intent: 'charge',
      });
    }

    return c.json({
      protocol: 'a2a',
      version: '1.0',
      name: agent?.name ?? 'Tack',
      description: agent?.description ?? 'Pin to IPFS, pay with your wallet. No account needed.',
      endpoint: origin,
      capabilities: {
        pinningApi: {
          spec: 'IPFS Pinning Service API',
          endpoints: ['/pins', '/pins/:requestid', '/upload']
        },
        gateway: {
          endpoint: '/ipfs/:cid',
          supports: ['etag', 'range', 'cache-control', 'optional-paywall']
        }
      },
      payments: {
        protocols,
        pricing: {
          base: agent?.x402BasePriceUsd,
          perMb: agent?.x402PricePerMbUsd,
          max: agent?.x402MaxPriceUsd,
          currency: 'USD',
        },
      },
      pricing: {
        pinning: {
          protocol: 'x402',
          spec: X402_SPEC_URL,
          clientSdk: '@x402/fetch',
          paymentHeader: 'Payment-Signature',
          network: agent?.x402Network,
          asset: agent?.x402UsdcAssetAddress,
          baseUsd: agent?.x402BasePriceUsd,
          perMbUsd: agent?.x402PricePerMbUsd,
          maxUsd: agent?.x402MaxPriceUsd
        },
        retrieval: {
          protocol: 'x402-optional',
          metadataField: 'meta.retrievalPrice',
          settlement: 'owner-wallet'
        }
      },
      authentication: {
        walletAuthToken: {
          description: 'Paid requests return x-wallet-auth-token. Use as Bearer token for owner endpoints (GET /pins, DELETE /pins/:id).',
          responseHeaders: [WALLET_AUTH_TOKEN_RESPONSE_HEADER, WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER],
          usage: 'Authorization: Bearer <token>',
        }
      },
      links: {
        x402Spec: X402_SPEC_URL,
        x402ClientSdk: 'https://www.npmjs.com/package/@x402/fetch',
        ipfsPinningSpec: 'https://ipfs.github.io/pinning-services-api-spec/',
      }
    });
  });

  app.post('/pins', async (c) => {
    const body = parsePinPayload(await parseJsonBody(c));
    const paymentResult = c.get('paymentResult');
    const paidWallet = paymentResult?.wallet ?? requirePaidWallet(c.req.raw.headers);
    issueWalletAuthToken(c, paidWallet, services.walletAuth);
    const result = await services.pinningService.createPin({ ...body, owner: paidWallet });
    return c.json(toPinStatusResponse(result), 202);
  });

  app.get('/pins', (c) => {
    const cid = c.req.query('cid');
    const name = c.req.query('name');
    const status = parseStatusQuery(c.req.query('status'));
    const before = c.req.query('before');
    const after = c.req.query('after');
    const limit = parseLimit(c.req.query('limit'));
    const offset = parseOffset(c.req.query('offset'));
    const owner = requireOwnerWallet(c);

    const result = services.pinningService.listPins({
      cid,
      name,
      status,
      before,
      after,
      limit,
      offset,
      owner
    });

    return c.json({
      count: result.count,
      results: result.results.map((record) => toPinStatusResponse(record))
    });
  });

  app.get('/pins/:requestid', (c) => {
    const wallet = requireOwnerWallet(c);
    const record = services.pinningService.getPin(c.req.param('requestid'), wallet);
    return c.json(toPinStatusResponse(record));
  });

  app.post('/pins/:requestid', async (c) => {
    const body = parsePinPayload(await parseJsonBody(c));
    const wallet = requireOwnerWallet(c);
    const record = await services.pinningService.replacePin(c.req.param('requestid'), body, wallet);
    return c.json(toPinStatusResponse(record), 202);
  });

  app.delete('/pins/:requestid', async (c) => {
    const wallet = requireOwnerWallet(c);
    await services.pinningService.removePin(c.req.param('requestid'), wallet);
    return c.body(null, 202);
  });

  app.post('/upload', async (c) => {
    const paymentResult = c.get('paymentResult');
    const paidWallet = paymentResult?.wallet ?? requirePaidWallet(c.req.raw.headers);
    const declaredRequestSize = parseDeclaredRequestSize(c.req.raw.headers);
    if (declaredRequestSize !== null && declaredRequestSize > uploadMaxSizeBytes + MULTIPART_REQUEST_SIZE_OVERHEAD_BYTES) {
      throw new PayloadTooLargeError(`Upload exceeds ${uploadMaxSizeBytes} bytes`);
    }

    const formData = await c.req.formData();
    const upload = formData.get('file');

    if (!(upload instanceof File)) {
      throw new ValidationError('Expected multipart form field "file"');
    }

    if (upload.size > uploadMaxSizeBytes) {
      throw new PayloadTooLargeError(`Upload exceeds ${uploadMaxSizeBytes} bytes`);
    }

    issueWalletAuthToken(c, paidWallet, services.walletAuth);
    const cid = await services.pinningService.uploadContent(upload, upload.name || 'upload.bin');

    return c.json({ cid }, 201);
  });

  app.get('/ipfs/:cid', async (c) => {
    const cid = c.req.param('cid');
    const resolved = await services.pinningService.getContent(cid);
    const totalSize = resolved.content.byteLength;
    const etag = `"${cid}"`;
    const rangeHeader = c.req.header('range') ?? null;
    const parsedRange = parseRangeHeader(rangeHeader, totalSize);
    const headers = new Headers({
      'Content-Type': resolved.contentType,
      'Cache-Control': `public, max-age=${cacheControlMaxAgeSeconds}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
      'Accept-Ranges': 'bytes',
      'X-Cache': resolved.cacheHit ? 'HIT' : 'MISS'
    });

    if (shouldServeContentAsAttachment(resolved.contentType)) {
      headers.set('Content-Disposition', createContentDispositionHeader(resolved.filename));
    }

    if (!rangeHeader && ifNoneMatchIncludesEtag(c.req.header('if-none-match') ?? null, etag)) {
      return new Response(null, { status: 304, headers });
    }

    if (rangeHeader && !parsedRange) {
      headers.set('Content-Range', `bytes */${totalSize}`);
      return new Response(null, { status: 416, headers });
    }

    if (parsedRange) {
      const chunk = new Uint8Array(resolved.content).subarray(parsedRange.start, parsedRange.end + 1);
      headers.set('Content-Range', `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`);
      headers.set('Content-Length', String(chunk.byteLength));
      return new Response(chunk, { status: 206, headers });
    }

    headers.set('Content-Length', String(totalSize));
    return new Response(resolved.content, { status: 200, headers });
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }

    if (err instanceof ValidationError) {
      return c.json({ error: err.message }, 400);
    }

    if (err instanceof PayloadTooLargeError) {
      return c.json({ error: err.message }, 413);
    }

    if (err instanceof RateLimitError) {
      c.header('Retry-After', String(err.retryAfterSeconds));
      return c.json({ error: err.message }, 429);
    }

    if (err instanceof GatewayTimeoutError) {
      return c.json({ error: 'IPFS request timed out' }, 504);
    }

    if (err instanceof UpstreamServiceError) {
      return c.json({ error: 'IPFS upstream request failed' }, 502);
    }

    if (err instanceof NotFoundError) {
      return c.json({ error: err.message }, 404);
    }

    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
