import { randomUUID } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
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
import { type PrivateObjectService } from './services/private-object-service';
import type { StoredPrivateObjectRecord } from './repositories/private-object-repository';
import type { InMemoryRateLimiter } from './services/rate-limiter';
import { logger } from './services/logger';
import { createContentDispositionHeader, shouldServeContentAsAttachment } from './services/content-type';
import {
  createWalletAuthToken,
  extractPaidWalletFromHeaders,
  parseDurationMonths,
  resolveWalletFromHeaders,
  WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER,
  WALLET_AUTH_TOKEN_RESPONSE_HEADER,
  X402_SPEC_URL,
  type WalletAuthConfig
} from './services/x402';
import type { WalletLoginService } from './services/wallet-login';
import { formatPinningPriceFormula } from './services/payment/pricing';
import type { AgentCardConfig, PinStatusValue } from './types';
import { landingPageHtml } from './landing';
import { buildOpenApiDocument } from './openapi';

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

function requirePrivateObjectService(services: AppServices): PrivateObjectService {
  if (!services.privateObjectService) {
    throw new HTTPException(404, { message: 'private storage is not enabled' });
  }

  return services.privateObjectService;
}

function toPrivateObjectResponse(record: StoredPrivateObjectRecord): Record<string, unknown> {
  return {
    id: record.id,
    name: record.name ?? undefined,
    contentType: record.content_type,
    size: record.size_bytes,
    sha256: record.sha256,
    created: record.created,
    updated: record.updated,
    expiresAt: record.expires_at ?? undefined,
    private: true,
    meta: record.meta
  };
}

function getPrivateObjectRenewalId(path: string): string | null {
  const match = /^\/private\/objects\/([^/]+)\/renew$/.exec(path);
  if (!match?.[1]) {
    return null;
  }

  return decodeURIComponent(match[1]);
}

function parseRequiredObjectSize(headers: Headers): number {
  const raw = headers.get('x-content-size-bytes');
  const parsed = raw === null ? NaN : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError('X-Content-Size-Bytes header is required');
  }
  return parsed;
}

function parseStorageDurationMonths(headers: Headers, defaultMonths: number, maxMonths: number): number {
  return parseDurationMonths(headers.get('x-storage-duration-months'), defaultMonths, maxMonths);
}

function parseObjectMeta(value: FormDataEntryValue | string | null): Record<string, string> {
  if (value === null || value === undefined || value === '') {
    return {};
  }

  if (typeof value !== 'string') {
    throw new ValidationError('meta must be a JSON object string');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ValidationError('meta must be valid JSON');
  }

  if (!isRecordOfStrings(parsed)) {
    throw new ValidationError('meta must be an object with string values');
  }

  return parsed;
}

async function parsePrivateObjectUpload(c: {
  req: {
    header: (name: string) => string | undefined;
    formData: () => Promise<FormData>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  };
}): Promise<{
  content: ArrayBuffer;
  name?: string;
  contentType: string;
  meta: Record<string, string>;
}> {
  const contentType = c.req.header('content-type') ?? 'application/octet-stream';
  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    const formData = await c.req.formData();
    const upload = formData.get('file');
    if (!(upload instanceof File)) {
      throw new ValidationError('Expected multipart form field "file"');
    }

    const nameField = formData.get('name');
    const name = typeof nameField === 'string' && nameField.trim().length > 0
      ? nameField
      : upload.name || undefined;

    return {
      content: await upload.arrayBuffer(),
      name,
      contentType: upload.type || 'application/octet-stream',
      meta: parseObjectMeta(formData.get('meta'))
    };
  }

  return {
    content: await c.req.arrayBuffer(),
    name: c.req.header('x-object-name'),
    contentType,
    meta: parseObjectMeta(c.req.header('x-object-meta') ?? null)
  };
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

function parseEip155ChainId(network: string | undefined): number | undefined {
  if (!network) {
    return undefined;
  }

  const match = /^eip155:(\d+)$/.exec(network.trim());
  if (!match) {
    return undefined;
  }

  const chainId = Number(match[1]);
  return Number.isInteger(chainId) ? chainId : undefined;
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

export type { AgentCardConfig, AgentCardX402Chain } from './types';

export interface AppServices {
  pinningService: PinningService;
  privateObjectService?: PrivateObjectService;
  paymentMiddleware: MiddlewareHandler;
  mppMiddleware?: MiddlewareHandler;
  mppChallengeEnhancer?: MiddlewareHandler;
  walletAuth: WalletAuthConfig;
  walletLoginService?: WalletLoginService;
  gatewayCacheControlMaxAgeSeconds?: number;
  uploadMaxSizeBytes?: number;
  privateObjectMaxSizeBytes?: number;
  publicBaseUrl?: string;
  trustProxy?: boolean;
  trustedProxyCidrs?: string[];
  rateLimiter?: InMemoryRateLimiter;
  healthCheck?: () => Promise<void>;
  agentCard?: AgentCardConfig;
  defaultDurationMonths?: number;
  maxDurationMonths?: number;
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
    paymentSettlementCallbacks?: import('./services/payment/types.js').PaymentSettlementCallbacks[];
  };
}

export function createApp(services: AppServices): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const cacheControlMaxAgeSeconds = services.gatewayCacheControlMaxAgeSeconds ?? DEFAULT_GATEWAY_CACHE_CONTROL_MAX_AGE_SECONDS;
  const uploadMaxSizeBytes = services.uploadMaxSizeBytes ?? DEFAULT_UPLOAD_MAX_SIZE_BYTES;
  const privateObjectMaxSizeBytes = services.privateObjectMaxSizeBytes ?? uploadMaxSizeBytes;
  const publicBaseUrl = services.publicBaseUrl;
  const trustProxy = services.trustProxy ?? false;
  const trustedProxyCidrs = services.trustedProxyCidrs ?? [];

  app.use('*', createExternalRequestUrlMiddleware({
    publicBaseUrl,
    trustProxy,
    trustedProxyCidrs
  }));

  app.get('/', (c) => {
    return c.html(landingPageHtml());
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

  // Private renewals need owner authorization before any pre-handler payment settlement.
  app.use('/private/objects/*', async (c, next) => {
    if (c.req.method === 'POST') {
      const objectId = getPrivateObjectRenewalId(c.req.path);
      if (objectId) {
        const privateObjects = requirePrivateObjectService(services);
        const owner = requireOwnerWallet(c);
        privateObjects.getObject(objectId, owner);
      }
    }

    await next();
  });

  // MPP middleware runs first on payment-gated routes
  // MPP middleware only on routes that require payment (not /pins/* which are owner endpoints)
  if (services.mppMiddleware) {
    app.use('/pins', services.mppMiddleware);
    app.use('/upload', services.mppMiddleware);
    app.use('/ipfs/*', services.mppMiddleware);
    app.use('/private/objects', services.mppMiddleware);
    app.use('/private/objects/*', services.mppMiddleware);
  }

  // MPP challenge enhancer wraps x402 middleware — must be registered BEFORE x402
  // so that when it calls next(), x402 runs, and the enhancer can modify the 402 response
  if (services.mppChallengeEnhancer) {
    app.use('/pins', services.mppChallengeEnhancer);
    app.use('/upload', services.mppChallengeEnhancer);
    app.use('/ipfs/*', services.mppChallengeEnhancer);
    app.use('/private/objects', services.mppChallengeEnhancer);
    app.use('/private/objects/*', services.mppChallengeEnhancer);
  }

  app.use(services.paymentMiddleware);

  app.get('/openapi.json', (c) => {
    const baseUrl = publicBaseUrl ?? new URL(c.req.url).origin;
    const document = buildOpenApiDocument({
      baseUrl,
      agentCard: services.agentCard,
      uploadMaxSizeBytes
    });
    return c.json(document, 200, { 'Cache-Control': 'public, max-age=3600' });
  });

  app.get('/llms.txt', (c) => {
    const base = publicBaseUrl ?? 'https://tack.taiko.xyz';
    const agent = services.agentCard;
    const rate = agent?.x402RatePerGbMonthUsd;
    const minPrice = agent?.x402MinPriceUsd;
    const maxPrice = agent?.x402MaxPriceUsd;
    const defaultMonths = agent?.x402DefaultDurationMonths;
    const maxMonths = agent?.x402MaxDurationMonths;
    const uploadMaxMb = Math.floor(uploadMaxSizeBytes / (1024 * 1024));
    const mppEnabled = Boolean(agent?.mppMethod);

    const pricingBlock = rate !== undefined && minPrice !== undefined && maxPrice !== undefined && defaultMonths !== undefined && maxMonths !== undefined
      ? `$${rate} / GB / month. Minimum charge $${minPrice} per pin, capped at $${maxPrice} per pin. Pin duration ${defaultMonths}–${maxMonths} months (default: ${defaultMonths} month).
Price formula: ${formatPinningPriceFormula({ ratePerGbMonthUsd: rate, minPriceUsd: minPrice, maxPriceUsd: maxPrice })}.`
      : 'Dynamic pricing based on content size and duration. See GET /.well-known/agent.json for the current rate, minimum charge, maximum cap, and duration bounds.';

    const protocolsBlock = mppEnabled
      ? `- x402: \`payment-signature\` header, USDC on Taiko Alethia (EIP-3009 transferWithAuthorization)
- MPP: \`Authorization: Payment\` header, USDC.e on Tempo (mppx SDK)

Both protocols are accepted simultaneously on all paid endpoints.`
      : `- x402: \`payment-signature\` header, USDC on Taiko Alethia (EIP-3009 transferWithAuthorization)

MPP (\`Authorization: Payment\`) is disabled on this deployment. Check GET /.well-known/agent.json for the live list of supported protocols.`;

    const text = `\
# Tack

> IPFS pinning and content retrieval for agents. Pay with USDC on Taiko${mppEnabled ? ' or USDC.e on Tempo' : ''} — no accounts, no API keys.

## Overview

Tack is an IPFS pinning service that accepts machine payments${mppEnabled ? ' via x402 and MPP' : ' via x402'}.
Pin existing CIDs, upload files, or retrieve content through the gateway.
Wallet identity is derived from payment — no registration required.

Hosted at: ${base}

## Pricing

${pricingBlock}

## Authentication

No accounts. Paying for a pin returns an \`x-wallet-auth-token\` bearer token.
Use it as \`Authorization: Bearer <token>\` on owner endpoints.

## Payment Protocols

${protocolsBlock}

## Endpoints

### Paid (payment required)

- POST /pins — Pin content by CID. Body: { cid, name?, origins?, meta? }. Optional header: X-Pin-Duration-Months.
- POST /upload — Upload a file (multipart/form-data, field "file", max ${uploadMaxMb}MB). Returns { cid }.
- POST /private/objects — Store a private object outside IPFS. Requires X-Content-Size-Bytes. Optional header: X-Storage-Duration-Months.
- POST /private/objects/:objectId/renew — Extend private object retention. Requires owner token and payment.

### Gateway

- GET /ipfs/:cid — Retrieve content by CID. Free by default; owners may set a retrieval price via meta.retrievalPrice.

### Owner (bearer token required)

- GET /pins — List your pins. Query: cid, name, status, before, after, limit, offset.
- GET /pins/:requestid — Get a specific pin by request ID.
- POST /pins/:requestid — Replace a pin. Same body as POST /pins.
- DELETE /pins/:requestid — Delete a pin.
- GET /private/objects — List your private objects.
- GET /private/objects/:objectId — Get private object metadata.
- GET /private/objects/:objectId/content — Retrieve private object bytes.
- PATCH /private/objects/:objectId — Update private object metadata.
- DELETE /private/objects/:objectId — Delete a private object.

### Wallet Login

- POST /auth/challenge — Create a SIWE message for a wallet and CAIP-2 network such as eip155:8453.
- POST /auth/token — Exchange the signed SIWE message for an x-wallet-auth-token.

## Pinning Service API

Conforms to the IPFS Pinning Service API spec: https://ipfs.github.io/pinning-services-api-spec/

## Agent Card

Machine-readable A2A agent card: GET /.well-known/agent.json
`;
    return c.text(text, 200, { 'Cache-Control': 'public, max-age=3600' });
  });

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

  app.post('/auth/challenge', async (c) => {
    if (!services.walletLoginService) {
      throw new HTTPException(404, { message: 'wallet login is not enabled' });
    }

    const body = await parseJsonBody(c);
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Payload must be an object');
    }

    const payload = body as Record<string, unknown>;
    const address = typeof payload.address === 'string' ? payload.address : '';
    const network = typeof payload.network === 'string' ? payload.network : undefined;
    const chainId = typeof payload.chainId === 'number' ? payload.chainId : undefined;
    const origin = publicBaseUrl ?? new URL(c.req.url).origin;

    const challenge = services.walletLoginService.createChallenge({
      address,
      network,
      chainId,
      origin
    });

    return c.json(challenge, 201, { 'Cache-Control': 'no-store' });
  });

  app.post('/auth/token', async (c) => {
    if (!services.walletLoginService) {
      throw new HTTPException(404, { message: 'wallet login is not enabled' });
    }

    const body = await parseJsonBody(c);
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Payload must be an object');
    }

    const payload = body as Record<string, unknown>;
    const message = typeof payload.message === 'string' ? payload.message : '';
    const signature = typeof payload.signature === 'string' ? payload.signature : '';
    const result = await services.walletLoginService.exchangeToken({ message, signature });

    c.header(WALLET_AUTH_TOKEN_RESPONSE_HEADER, result.token);
    c.header(WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER, result.expiresAt);
    c.header('Cache-Control', 'no-store');
    return c.json(result);
  });

  app.get('/.well-known/agent.json', (c) => {
    const origin = new URL(c.req.url).origin;
    const agent = services.agentCard;

    const chainNameByChainId: Record<number, string> = {
      167000: 'taiko',
      8453: 'base',
    };

    const protocols: Array<Record<string, unknown>> = [];

    for (const chain of agent?.x402Chains ?? []) {
      const chainId = parseEip155ChainId(chain.network);
      const entry: Record<string, unknown> = {
        protocol: 'x402',
        asset: chain.usdcAssetAddress,
        network: chain.network,
      };
      if (chainId !== undefined) {
        entry.chainId = chainId;
        const chainName = chainNameByChainId[chainId];
        if (chainName !== undefined) {
          entry.chain = chainName;
        }
      }
      protocols.push(entry);
    }

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

    const primaryX402 = agent?.x402Chains?.[0];

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
        },
        privateStorage: {
          storage: 'not-ipfs',
          visibility: 'owner-authenticated',
          endpoints: [
            '/private/objects',
            '/private/objects/:objectId',
            '/private/objects/:objectId/content'
          ],
          auth: {
            session: 'Authorization: Bearer <token>',
            walletLogin: ['/auth/challenge', '/auth/token']
          }
        }
      },
      payments: {
        protocols,
        pricing: {
          ratePerGbMonthUsd: agent?.x402RatePerGbMonthUsd,
          minPriceUsd: agent?.x402MinPriceUsd,
          maxPriceUsd: agent?.x402MaxPriceUsd,
          defaultDurationMonths: agent?.x402DefaultDurationMonths,
          maxDurationMonths: agent?.x402MaxDurationMonths,
          durationHeader: 'X-Pin-Duration-Months',
          currency: 'USD',
        },
      },
      pricing: {
        pinning: {
          protocol: 'x402',
          spec: X402_SPEC_URL,
          clientSdk: '@x402/fetch',
          paymentHeader: 'Payment-Signature',
          network: primaryX402?.network,
          asset: primaryX402?.usdcAssetAddress,
          ratePerGbMonthUsd: agent?.x402RatePerGbMonthUsd,
          minPriceUsd: agent?.x402MinPriceUsd,
          maxPriceUsd: agent?.x402MaxPriceUsd,
          defaultDurationMonths: agent?.x402DefaultDurationMonths,
          maxDurationMonths: agent?.x402MaxDurationMonths,
          durationHeader: 'X-Pin-Duration-Months'
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

    const durationMonths = parseDurationMonths(
      c.req.raw.headers.get('x-pin-duration-months'),
      services.defaultDurationMonths ?? 1,
      services.maxDurationMonths ?? 24
    );
    const result = await services.pinningService.createPin({
      ...body,
      owner: paidWallet,
      durationMonths
    });
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

  app.post('/private/objects', async (c) => {
    const privateObjects = requirePrivateObjectService(services);
    const paymentResult = c.get('paymentResult');
    const paidWallet = paymentResult?.wallet ?? requirePaidWallet(c.req.raw.headers);
    const declaredSize = parseRequiredObjectSize(c.req.raw.headers);
    if (declaredSize > privateObjectMaxSizeBytes) {
      throw new PayloadTooLargeError(`Private object exceeds ${privateObjectMaxSizeBytes} bytes`);
    }

    const upload = await parsePrivateObjectUpload(c);
    if (upload.content.byteLength !== declaredSize) {
      throw new ValidationError('X-Content-Size-Bytes must match object size');
    }

    if (upload.content.byteLength > privateObjectMaxSizeBytes) {
      throw new PayloadTooLargeError(`Private object exceeds ${privateObjectMaxSizeBytes} bytes`);
    }

    const durationMonths = parseStorageDurationMonths(
      c.req.raw.headers,
      services.defaultDurationMonths ?? 1,
      services.maxDurationMonths ?? 24
    );
    const paymentStatus = paymentResult?.protocol === 'mpp' ? 'paid' : 'pending';
    const record = await privateObjects.createObject({
      owner: paidWallet,
      name: upload.name,
      contentType: upload.contentType,
      meta: upload.meta,
      content: upload.content,
      durationMonths,
      paymentStatus
    });

    if (paymentStatus === 'pending') {
      c.get('paymentSettlementCallbacks')?.push({
        onSettlementSuccess: () => privateObjects.markPaid(record.id),
        onSettlementFailure: () => privateObjects.markFailedAndDeleteBytes(record.id)
      });
    }

    issueWalletAuthToken(c, paidWallet, services.walletAuth);
    return c.json(toPrivateObjectResponse(record), 201);
  });

  app.get('/private/objects', (c) => {
    const privateObjects = requirePrivateObjectService(services);
    const owner = requireOwnerWallet(c);
    const result = privateObjects.listObjects({
      owner,
      name: c.req.query('name'),
      before: c.req.query('before'),
      after: c.req.query('after'),
      limit: parseLimit(c.req.query('limit')),
      offset: parseOffset(c.req.query('offset'))
    });

    return c.json({
      count: result.count,
      results: result.results.map((record) => toPrivateObjectResponse(record))
    });
  });

  app.get('/private/objects/:objectId', (c) => {
    const privateObjects = requirePrivateObjectService(services);
    const owner = requireOwnerWallet(c);
    const record = privateObjects.getObject(c.req.param('objectId'), owner);
    return c.json(toPrivateObjectResponse(record));
  });

  async function privateObjectContentResponse(c: Context<AppEnv>, headOnly: boolean): Promise<Response> {
    const privateObjects = requirePrivateObjectService(services);
    const owner = requireOwnerWallet(c);
    const objectId = c.req.param('objectId');
    if (!objectId) {
      throw new NotFoundError('Private object was not found');
    }
    const resolved = await privateObjects.getObjectContent(objectId, owner);
    const totalSize = resolved.content.byteLength;
    const etag = `"${resolved.record.sha256}"`;
    const rangeHeader = c.req.header('range') ?? null;
    const parsedRange = parseRangeHeader(rangeHeader, totalSize);
    const headers = new Headers({
      'Content-Type': resolved.record.content_type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
      'Accept-Ranges': 'bytes'
    });

    if (shouldServeContentAsAttachment(resolved.record.content_type)) {
      headers.set('Content-Disposition', createContentDispositionHeader(resolved.record.name));
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
      return new Response(headOnly ? null : chunk, { status: 206, headers });
    }

    headers.set('Content-Length', String(totalSize));
    return new Response(headOnly ? null : resolved.content, { status: 200, headers });
  }

  app.get('/private/objects/:objectId/content', (c) => {
    return privateObjectContentResponse(c, false);
  });

  app.on('HEAD', '/private/objects/:objectId/content', (c) => {
    return privateObjectContentResponse(c, true);
  });

  app.patch('/private/objects/:objectId', async (c) => {
    const privateObjects = requirePrivateObjectService(services);
    const owner = requireOwnerWallet(c);
    const body = await parseJsonBody(c);
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Payload must be an object');
    }

    const payload = body as Record<string, unknown>;
    const name = payload.name === undefined
      ? undefined
      : payload.name === null
        ? null
        : typeof payload.name === 'string'
          ? payload.name
          : undefined;
    if (payload.name !== undefined && name === undefined) {
      throw new ValidationError('name must be a string or null');
    }

    if (payload.meta !== undefined && !isRecordOfStrings(payload.meta)) {
      throw new ValidationError('meta must be an object with string values');
    }

    const meta = payload.meta;
    const record = privateObjects.updateObject(c.req.param('objectId'), owner, {
      name,
      meta: meta === undefined ? undefined : meta
    });
    return c.json(toPrivateObjectResponse(record));
  });

  app.delete('/private/objects/:objectId', async (c) => {
    const privateObjects = requirePrivateObjectService(services);
    const owner = requireOwnerWallet(c);
    await privateObjects.deleteObject(c.req.param('objectId'), owner);
    return c.body(null, 202);
  });

  app.post('/private/objects/:objectId/renew', (c) => {
    const privateObjects = requirePrivateObjectService(services);
    const objectId = c.req.param('objectId');
    const owner = requireOwnerWallet(c);
    const paymentResult = c.get('paymentResult');
    const paidWallet = paymentResult?.wallet ?? requirePaidWallet(c.req.raw.headers);
    if (paidWallet !== owner) {
      throw new HTTPException(403, { message: 'renewal payment wallet must match object owner' });
    }

    const durationMonths = parseStorageDurationMonths(
      c.req.raw.headers,
      services.defaultDurationMonths ?? 1,
      services.maxDurationMonths ?? 24
    );
    const settlementCallbacks = c.get('paymentSettlementCallbacks');
    const renewAt = new Date();
    if (settlementCallbacks) {
      const record = privateObjects.previewRenewObject(objectId, owner, durationMonths, renewAt);
      settlementCallbacks.push({
        onSettlementSuccess: () => {
          privateObjects.renewObject(objectId, owner, durationMonths, renewAt);
        }
      });
      return c.json(toPrivateObjectResponse(record));
    }

    const record = privateObjects.renewObject(objectId, owner, durationMonths, renewAt);
    return c.json(toPrivateObjectResponse(record));
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
