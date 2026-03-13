import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
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
  basePriceUsd: config.x402BasePriceUsd,
  pricePerMbUsd: config.x402PricePerMbUsd,
  maxPriceUsd: config.x402MaxPriceUsd
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

const app = createApp({
  pinningService,
  paymentMiddleware,
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
  healthCheck: async () => {
    await ipfsClient.id();
  },
  rateLimiter,
  agentCard: {
    name: 'Tack',
    description: 'Pin to IPFS, pay with your wallet. No account needed.',
    version: appVersion,
    x402Network: config.x402Network,
    x402UsdcAssetAddress: config.x402UsdcAssetAddress,
    x402BasePriceUsd: config.x402BasePriceUsd,
    x402PricePerMbUsd: config.x402PricePerMbUsd,
    x402MaxPriceUsd: config.x402MaxPriceUsd
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

let shuttingDown = false;

const shutdown = (signal: NodeJS.Signals): void => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, 'received shutdown signal');

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
