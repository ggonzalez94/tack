import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createPublicClient, http } from 'viem';
import { getTransactionReceipt } from 'viem/actions';
import { tempo, tempoModerato } from 'viem/chains';
import type { Context, MiddlewareHandler } from 'hono';
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
import { createMppChallengeEnhancer } from './services/payment/challenge-enhancer';
import { extractIpfsCidFromPath } from './services/payment/http';
import { createMppInstance } from './services/payment/mpp';
import { BASE_CHAIN } from './services/payment/chains/base';
import { createMppPaymentMiddleware } from './services/payment/middleware';
import { createTempoPayerResolver, type FetchTempoReceipt } from './services/payment/mpp-payer';
import {
  calculatePriceUsd,
  formatUsdAmount,
  parseDurationMonths,
  parseNonNegativeInteger,
  parseSizeBytesFromPinPayload,
  usdToAssetAmount,
  type LinearPricingConfig
} from './services/payment/pricing';

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
  chains: [
    {
      network: config.x402Network as `${string}:${string}`,
      facilitatorUrl: config.x402FacilitatorUrl,
      payTo: config.x402TaikoPayTo,
      usdcAssetAddress: config.x402UsdcAssetAddress,
      usdcAssetDecimals: config.x402UsdcAssetDecimals,
      usdcDomainName: config.x402UsdcDomainName,
      usdcDomainVersion: config.x402UsdcDomainVersion
    },
    {
      network: BASE_CHAIN.network,
      facilitatorUrl: BASE_CHAIN.facilitatorUrl,
      payTo: config.x402BasePayTo,
      usdcAssetAddress: BASE_CHAIN.usdcAssetAddress,
      usdcAssetDecimals: BASE_CHAIN.usdcAssetDecimals,
      usdcDomainName: BASE_CHAIN.usdcDomainName,
      usdcDomainVersion: BASE_CHAIN.usdcDomainVersion
    }
  ],
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
const mppTestnet = config.mppTestnet;
const tempoViemChain = mppTestnet ? tempoModerato : tempo;
// Fallback RPC must track the selected network — using the mainnet
// endpoint while `tempoViemChain` is set to Moderato would point receipt
// lookups at the wrong chain and turn every successful testnet charge
// into a 500 during payer resolution.
const tempoRpcUrl = config.mppTempoRpcUrl ?? tempoViemChain.rpcUrls.default.http[0];
const mppx = config.mppSecretKey
  ? createMppInstance({
      payTo: config.mppPayTo,
      secretKey: config.mppSecretKey,
      realm: config.publicBaseUrl,
      testnet: mppTestnet,
    })
  : null;

// viem public client used to re-read Tempo receipts and derive the
// verified payer wallet from the on-chain Transfer event. Only created
// when MPP is enabled so the RPC is never touched unless the operator
// has explicitly opted in.
const tempoPublicClient = mppx
  ? createPublicClient({
      chain: tempoViemChain,
      transport: http(tempoRpcUrl),
    })
  : null;
const fetchTempoReceipt: FetchTempoReceipt | null = tempoPublicClient
  ? async (hash) => {
      const receipt = await getTransactionReceipt(tempoPublicClient, { hash });
      return {
        status: receipt.status,
        logs: receipt.logs,
      };
    }
  : null;

const mppCurrencyAddress = (
  mppTestnet
    ? '0x20c0000000000000000000000000000000000000'
    : '0x20C000000000000000000000b9537d11c60E8b50'
) as `0x${string}`;
const mppCurrencySymbol = mppTestnet ? 'pathUSD' : 'USDC.e';
// TIP-20 stablecoins on Tempo (USDC.e, pathUSD, etc.) all use 6 decimals;
// hardcoded here so the agent card and payer resolver stay in lockstep
// with mppx's internal defaults (see `mppx/tempo/internal/defaults.ts`).
const mppCurrencyDecimals = 6;

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

  // Match the x402 priority order so both payment protocols charge the
  // same price for the same request: size headers are authoritative, and
  // the JSON pin payload is only consulted when neither header is set.
  const headerSize =
    parseNonNegativeInteger(c.req.header('x-content-size-bytes')) ??
    parseNonNegativeInteger(c.req.header('content-length'));
  if (headerSize !== undefined) {
    return calculatePriceUsd(headerSize, durationMonths, paymentPricingConfig);
  }

  try {
    const body: unknown = await c.req.raw.clone().json();
    const bodySize = parseSizeBytesFromPinPayload(body);
    if (bodySize !== undefined) {
      return calculatePriceUsd(bodySize, durationMonths, paymentPricingConfig);
    }
  } catch {
    // Pin payload was not a parseable JSON body — fall through to the zero
    // default, which calculatePriceUsd will clamp to minPriceUsd.
  }

  return calculatePriceUsd(0, durationMonths, paymentPricingConfig);
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
async function resolveMppRequirement(c: Context): Promise<{ amount: string; recipient: string } | null> {
  if (c.req.path === '/pins') {
    if (c.req.method !== 'POST') {
      return null;
    }

    return {
      amount: formatUsdAmount(await resolvePinPriceUsd(c)),
      recipient: config.mppPayTo,
    };
  }

  if (c.req.path === '/upload') {
    if (c.req.method !== 'POST') {
      return null;
    }

    return {
      amount: formatUsdAmount(resolveUploadPriceUsd(c)),
      recipient: config.mppPayTo,
    };
  }

  const cidParam = extractIpfsCidFromPath(c.req.path);
  if (cidParam && c.req.method === 'GET') {
    const policy = pinningService.resolveRetrievalPaymentPolicy(cidParam);
    if (!policy || policy.priceUsd <= 0) {
      return null;
    }

    return {
      amount: formatUsdAmount(policy.priceUsd),
      recipient: policy.payTo,
    };
  }

  return null;
}

// MPP per-route middleware: handles Authorization: Payment credentials.
// Ownership is derived from the verified on-chain Transfer event, NOT
// from the optional (client-controlled) `credential.source` DID.
const mppMiddleware: MiddlewareHandler | undefined = mppx && fetchTempoReceipt
  ? createMppPaymentMiddleware({
      mppx,
      requirementFn: resolveMppRequirement,
      resolveVerifiedPayer: createTempoPayerResolver({
        fetchReceipt: fetchTempoReceipt,
        getContext: async (request) => {
          // Reconstruct the expected on-chain transfer parameters from the
          // same request the client just paid for. We reuse the hono
          // context-less requirement resolver via a minimal shim so both
          // middlewares stay in lockstep on pricing.
          const shim: Context = {
            req: {
              path: new URL(request.url).pathname,
              method: request.method,
              header: (name: string) => request.headers.get(name),
              raw: request,
            },
          } as unknown as Context;

          const requirement = await resolveMppRequirement(shim);
          if (!requirement) {
            throw new Error('cannot derive MPP requirement for verified payer lookup');
          }

          const usdAmount = Number(requirement.amount);
          const { amount } = usdToAssetAmount(usdAmount, mppCurrencyAddress, mppCurrencyDecimals);

          return {
            currency: mppCurrencyAddress,
            recipient: requirement.recipient as `0x${string}`,
            amount,
          };
        },
      }),
      onPayerResolutionFailure: (error, request) => {
        logger.error(
          { err: error, url: request.url, method: request.method },
          'mpp payer resolution failed after successful charge'
        );
      },
    })
  : undefined;

const mppChallengeEnhancer: MiddlewareHandler | undefined = mppx
  ? createMppChallengeEnhancer({
      mppx,
      requirementFn: resolveMppRequirement,
      assetDecimals: config.x402UsdcAssetDecimals,
    })
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
    x402Chains: [
      {
        network: config.x402Network,
        usdcAssetAddress: config.x402UsdcAssetAddress,
      },
      {
        network: BASE_CHAIN.network,
        usdcAssetAddress: BASE_CHAIN.usdcAssetAddress,
      }
    ],
    x402RatePerGbMonthUsd: config.x402RatePerGbMonthUsd,
    x402MinPriceUsd: config.x402MinPriceUsd,
    x402MaxPriceUsd: config.x402MaxPriceUsd,
    x402DefaultDurationMonths: config.x402DefaultDurationMonths,
    x402MaxDurationMonths: config.x402MaxDurationMonths,
    mppMethod: mppx ? 'tempo' : undefined,
    mppChainId: mppx ? tempoViemChain.id : undefined,
    mppAsset: mppx ? mppCurrencyAddress : undefined,
    mppAssetSymbol: mppx ? mppCurrencySymbol : undefined
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
