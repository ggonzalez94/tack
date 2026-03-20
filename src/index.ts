import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import type { Context, MiddlewareHandler } from 'hono';
import { Credential } from 'mppx';
import { getConfig } from './config';
import { createDb } from './db';
import { PinRepository } from './repositories/pin-repository';
import { IpfsRpcClient } from './services/ipfs-rpc-client';
import { createApp } from './app';
import { PinningService } from './services/pinning-service';
import { createX402PaymentMiddleware } from './services/x402';
import { GatewayContentCache } from './services/content-cache';
import { InMemoryRateLimiter } from './services/rate-limiter';
import { logger } from './services/logger';
import { getChainByName } from './services/payment/chains';
import { createMppInstance } from './services/payment/mpp';
import { createMppPaymentMiddleware } from './services/payment/middleware';
import {
  calculatePriceUsd,
  parseDurationMonths,
  parseNonNegativeInteger,
  parseSizeBytesFromPinPayload,
  type LinearPricingConfig
} from './services/payment/pricing';
import { extractWalletFromDid } from './services/payment/wallet';

function getAppVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };

    return packageJson.version?.trim() || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const config = getConfig();
const appVersion = getAppVersion();
const db = createDb(config.dbPath);
const repository = new PinRepository(db);
const ipfsClient = new IpfsRpcClient(config.ipfsApiUrl, {
  timeoutMs: config.ipfsTimeoutMs,
  contentTimeoutMs: Math.max(config.ipfsTimeoutMs, 60000)
});
const replicaClients = config.pinReplicaIpfsApiUrls.map((apiBaseUrl, index) => ({
  name: `replica-${index + 1}`,
  delegateUrl: config.pinReplicaDelegateUrls[index],
  client: new IpfsRpcClient(apiBaseUrl, {
    timeoutMs: config.ipfsTimeoutMs,
    contentTimeoutMs: Math.max(config.ipfsTimeoutMs, 60000)
  })
}));
const contentCache = new GatewayContentCache(config.gatewayCacheMaxSizeBytes);
const rateLimiter = new InMemoryRateLimiter(config.rateLimitRequestsPerMinute, 60_000);
const pinningService = new PinningService(repository, ipfsClient, config.delegateUrl, {
  contentCache,
  maxGatewayContentSizeBytes: config.gatewayMaxContentSizeBytes,
  replicas: replicaClients
});
const paymentMiddleware = createX402PaymentMiddleware({
  facilitatorUrl: config.x402FacilitatorUrl,
  network: config.x402Network as `${string}:${string}`,
  payTo: config.x402PayTo,
  usdcAssetAddress: config.x402UsdcAssetAddress,
  usdcAssetDecimals: config.x402UsdcAssetDecimals,
  usdcDomainName: config.x402UsdcDomainName,
  usdcDomainVersion: config.x402UsdcDomainVersion,
  ratePerGbMonthUsd: config.x402RatePerGbMonthUsd,
  minPriceUsd: config.x402MinPriceUsd,
  maxPriceUsd: config.x402MaxPriceUsd,
  defaultDurationMonths: config.x402DefaultDurationMonths,
  maxDurationMonths: config.x402MaxDurationMonths
}, undefined, {
  resolveRetrievalPayment: (cid) => {
    const policy = pinningService.resolveRetrievalPaymentPolicy(cid);
    if (!policy) {
      return null;
    }

    return {
      payTo: policy.payTo,
      priceUsd: policy.priceUsd
    };
  }
});

// --- MPP (Machine Payment Protocol) on Tempo ---
const tempoChain = getChainByName('tempo');
const mppx = config.mppSecretKey
  ? createMppInstance(config.x402PayTo, config.mppSecretKey)
  : null;

const paymentPricingConfig: LinearPricingConfig = {
  ratePerGbMonthUsd: config.x402RatePerGbMonthUsd,
  minPriceUsd: config.x402MinPriceUsd,
  maxPriceUsd: config.x402MaxPriceUsd
};

async function resolvePinPriceUsd(c: Context): Promise<number> {
  const durationMonths = parseDurationMonths(
    c.req.header('x-pin-duration-months'),
    config.x402DefaultDurationMonths,
    config.x402MaxDurationMonths
  );
  const explicitSize = parseNonNegativeInteger(c.req.header('x-content-size-bytes'));
  if (explicitSize !== undefined) {
    return calculatePriceUsd(explicitSize, durationMonths, paymentPricingConfig);
  }

  try {
    const body = await c.req.raw.clone().json();
    const bodySize = parseSizeBytesFromPinPayload(body);
    if (bodySize !== undefined) {
      return calculatePriceUsd(bodySize, durationMonths, paymentPricingConfig);
    }
  } catch {
    // Fall back to the declared request size when the JSON pin payload is unavailable.
  }

  const fallbackSize = parseNonNegativeInteger(c.req.header('content-length')) ?? 0;
  return calculatePriceUsd(fallbackSize, durationMonths, paymentPricingConfig);
}

function resolveUploadPriceUsd(c: Context): number {
  const sizeBytes =
    parseNonNegativeInteger(c.req.header('x-content-size-bytes')) ??
    parseNonNegativeInteger(c.req.header('content-length')) ??
    0;

  return calculatePriceUsd(sizeBytes, 1, paymentPricingConfig);
}

// Shared MPP price resolution — single source of truth for both
// the per-route middleware and the challenge enhancer.
async function resolveMppPrice(c: Context): Promise<string | null> {
  if (c.req.path === '/pins') {
    if (c.req.method !== 'POST') {
      return null;
    }

    return String(await resolvePinPriceUsd(c));
  }

  if (c.req.path === '/upload') {
    if (c.req.method !== 'POST') {
      return null;
    }

    return String(resolveUploadPriceUsd(c));
  }

  const cidParam = c.req.param('cid');
  if (cidParam && c.req.method === 'GET') {
    const policy = pinningService.resolveRetrievalPaymentPolicy(cidParam);
    if (!policy || policy.priceUsd <= 0) {
      return null;
    }

    return String(policy.priceUsd);
  }

  return null;
}

// MPP per-route middleware: handles Authorization: Payment credentials
const mppMiddleware: MiddlewareHandler | undefined = mppx
  ? createMppPaymentMiddleware({
      mppx,
      priceFn: resolveMppPrice,
      extractWallet: (authHeader: string) => {
        const credential = Credential.deserialize(authHeader);
        if (!credential.source) {
          throw new Error('MPP credential missing source field — cannot determine payer wallet');
        }
        return extractWalletFromDid(credential.source);
      },
    })
  : undefined;

// Challenge enhancer: adds MPP WWW-Authenticate header to x402 402 responses
const mppChallengeEnhancer: MiddlewareHandler | undefined = mppx
  ? async (c, next) => {
      const priceUsd = await resolveMppPrice(c);
      await next();

      // If x402 returned 402, add the MPP challenge header too
      if (c.res.status === 402 && !c.req.header('Authorization')?.startsWith('Payment ')) {
        if (!priceUsd) {
          return;
        }

        // Build a minimal synthetic request for challenge generation.
        // Avoids passing c.req.raw whose body may already be consumed by x402.
        // Omitting Authorization header forces a 402 challenge (no credential to verify).
        const challengeReq = new Request(c.req.url, {
          method: c.req.method,
          headers: {},
        });
        const mppResult = await mppx.charge({ amount: priceUsd })(challengeReq);

        if (mppResult.status === 402) {
          const mppChallenge = mppResult.challenge as Response;
          const wwwAuth = mppChallenge.headers.get('WWW-Authenticate');
          if (wwwAuth) {
            const existingBody = await c.res.text();
            const headers = new Headers(c.res.headers);
            headers.set('WWW-Authenticate', wwwAuth);
            c.res = new Response(existingBody, { status: 402, headers });
          }
        }
      }
    }
  : undefined;

const app = createApp({
  pinningService,
  paymentMiddleware,
  mppMiddleware,
  mppChallengeEnhancer,
  walletAuth: {
    secret: config.walletAuthTokenSecret,
    issuer: config.walletAuthTokenIssuer,
    audience: config.walletAuthTokenAudience,
    ttlSeconds: config.walletAuthTokenTtlSeconds
  },
  gatewayCacheControlMaxAgeSeconds: config.gatewayCacheControlMaxAgeSeconds,
  uploadMaxSizeBytes: config.uploadMaxSizeBytes,
  publicBaseUrl: config.publicBaseUrl,
  trustProxy: config.trustProxy,
  trustedProxyCidrs: config.trustedProxyCidrs,
  healthCheck: async () => {
    await ipfsClient.id();
  },
  rateLimiter,
  defaultDurationMonths: config.x402DefaultDurationMonths,
  maxDurationMonths: config.x402MaxDurationMonths,
  agentCard: {
    name: 'Tack',
    description: 'Pin to IPFS, pay with your wallet. No account needed.',
    version: appVersion,
    x402Network: config.x402Network,
    x402UsdcAssetAddress: config.x402UsdcAssetAddress,
    x402RatePerGbMonthUsd: config.x402RatePerGbMonthUsd,
    x402MinPriceUsd: config.x402MinPriceUsd,
    x402MaxPriceUsd: config.x402MaxPriceUsd,
    x402DefaultDurationMonths: config.x402DefaultDurationMonths,
    x402MaxDurationMonths: config.x402MaxDurationMonths,
    mppMethod: mppx ? tempoChain?.mpp?.method : undefined,
    mppChainId: mppx ? tempoChain?.chainId : undefined,
    mppAsset: mppx ? tempoChain?.asset.address : undefined,
    mppAssetSymbol: mppx ? tempoChain?.asset.symbol : undefined
  }
});

const server = serve(
  {
    fetch: app.fetch,
    port: config.port
  },
  () => {
    logger.info({ port: config.port }, 'tack listening');
  }
);

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const SWEEP_STARTUP_DELAY_MS = 30 * 1000; // 30 seconds

async function runSweep(): Promise<void> {
  const startTime = Date.now();
  try {
    const result = await pinningService.sweepExpiredPins();
    if (result.expiredCount > 0 || result.failedCount > 0) {
      logger.info({ ...result, durationMs: Date.now() - startTime }, 'expiry sweep completed');
    }
  } catch (error) {
    logger.error({ err: error, durationMs: Date.now() - startTime }, 'expiry sweep failed');
  }
}

const sweepStartupTimer = setTimeout(() => {
  void runSweep();
}, SWEEP_STARTUP_DELAY_MS);
sweepStartupTimer.unref();

const sweepInterval = setInterval(() => {
  void runSweep();
}, SWEEP_INTERVAL_MS);
sweepInterval.unref();

let shuttingDown = false;

const shutdown = (signal: NodeJS.Signals): void => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, 'received shutdown signal');

  clearTimeout(sweepStartupTimer);
  clearInterval(sweepInterval);

  const forceExitTimer = setTimeout(() => {
    logger.error({ timeoutMs: 10000 }, 'shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  server.close((serverError) => {
    if (serverError) {
      logger.error({ err: serverError }, 'failed to close HTTP server cleanly');
      process.exitCode = 1;
    }

    try {
      db.close();
    } catch (dbError) {
      logger.error({ err: dbError }, 'failed to close sqlite database cleanly');
      process.exitCode = 1;
    } finally {
      clearTimeout(forceExitTimer);
      process.exit(process.exitCode ?? 0);
    }
  });
};

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
