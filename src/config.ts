export interface AppConfig {
  port: number;
  ipfsApiUrl: string;
  pinReplicaIpfsApiUrls: string[];
  pinReplicaDelegateUrls: string[];
  ipfsTimeoutMs: number;
  dbPath: string;
  delegateUrl: string;
  publicBaseUrl?: string;
  trustProxy: boolean;
  walletAuthTokenSecret: string;
  walletAuthTokenIssuer: string;
  walletAuthTokenAudience: string;
  walletAuthTokenTtlSeconds: number;
  uploadMaxSizeBytes: number;
  gatewayMaxContentSizeBytes: number;
  gatewayCacheMaxSizeBytes: number;
  gatewayCacheControlMaxAgeSeconds: number;
  rateLimitRequestsPerMinute: number;
  x402FacilitatorUrl: string;
  x402Network: string;
  x402PayTo: string;
  x402UsdcAssetAddress: string;
  x402UsdcAssetDecimals: number;
  x402UsdcDomainName: string;
  x402UsdcDomainVersion: string;
  x402BasePriceUsd: number;
  x402PricePerMbUsd: number;
  x402MaxPriceUsd: number;
}

const PLACEHOLDER_EVM_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000001'
]);
const PLACEHOLDER_WALLET_AUTH_SECRETS = new Set([
  'change-me',
  'changeme'
]);

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === 'true';
}

function parseNumber(value: string | undefined, fallback: number, fieldName: string): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${fieldName}`);
  }

  return parsed;
}

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePublicBaseUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL for PUBLIC_BASE_URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('PUBLIC_BASE_URL must use http or https');
  }

  if (
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== '/' ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error('PUBLIC_BASE_URL must be an origin without path, query, or hash');
  }

  return parsed.origin;
}

function isPlaceholderEvmAddress(value: string): boolean {
  return PLACEHOLDER_EVM_ADDRESSES.has(value.trim().toLowerCase());
}

function validateProductionConfig(config: AppConfig): void {
  if (
    config.pinReplicaDelegateUrls.length > 0 &&
    config.pinReplicaDelegateUrls.length !== config.pinReplicaIpfsApiUrls.length
  ) {
    throw new Error(
      'Invalid configuration: PIN_REPLICA_DELEGATE_URLS must have the same number of entries as PIN_REPLICA_IPFS_API_URLS'
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  if (config.walletAuthTokenSecret.trim().length < 32 || PLACEHOLDER_WALLET_AUTH_SECRETS.has(config.walletAuthTokenSecret.trim().toLowerCase())) {
    throw new Error('Invalid production configuration: WALLET_AUTH_TOKEN_SECRET must be a strong random secret');
  }

  if (isPlaceholderEvmAddress(config.x402PayTo)) {
    throw new Error('Invalid production configuration: X402_PAY_TO must be a real wallet address');
  }

  if (isPlaceholderEvmAddress(config.x402UsdcAssetAddress)) {
    throw new Error('Invalid production configuration: X402_USDC_ASSET_ADDRESS must be a real token address');
  }
}

export function getConfig(): AppConfig {
  const walletAuthTokenSecret = process.env.WALLET_AUTH_TOKEN_SECRET?.trim();
  if (!walletAuthTokenSecret) {
    throw new Error('Missing required environment variable: WALLET_AUTH_TOKEN_SECRET');
  }

  const config: AppConfig = {
    port: Number(process.env.PORT ?? 3000),
    ipfsApiUrl: process.env.IPFS_API_URL ?? 'http://ipfs:5001',
    pinReplicaIpfsApiUrls: parseList(process.env.PIN_REPLICA_IPFS_API_URLS),
    pinReplicaDelegateUrls: parseList(process.env.PIN_REPLICA_DELEGATE_URLS),
    ipfsTimeoutMs: parseNumber(process.env.IPFS_TIMEOUT_MS, 30000, 'IPFS_TIMEOUT_MS'),
    dbPath: process.env.DATABASE_PATH ?? './data/tack.db',
    delegateUrl: process.env.DELEGATE_URL ?? 'http://localhost:8080/ipfs',
    publicBaseUrl: parsePublicBaseUrl(process.env.PUBLIC_BASE_URL),
    trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
    walletAuthTokenSecret,
    walletAuthTokenIssuer: process.env.WALLET_AUTH_TOKEN_ISSUER ?? 'tack',
    walletAuthTokenAudience: process.env.WALLET_AUTH_TOKEN_AUDIENCE ?? 'tack-owner-api',
    walletAuthTokenTtlSeconds: parseNumber(
      process.env.WALLET_AUTH_TOKEN_TTL_SECONDS,
      900,
      'WALLET_AUTH_TOKEN_TTL_SECONDS'
    ),
    uploadMaxSizeBytes: parseNumber(process.env.UPLOAD_MAX_SIZE_BYTES, 100 * 1024 * 1024, 'UPLOAD_MAX_SIZE_BYTES'),
    gatewayMaxContentSizeBytes: parseNumber(process.env.GATEWAY_MAX_CONTENT_SIZE_BYTES, 50 * 1024 * 1024, 'GATEWAY_MAX_CONTENT_SIZE_BYTES'),
    gatewayCacheMaxSizeBytes: parseNumber(process.env.GATEWAY_CACHE_MAX_SIZE_BYTES, 100 * 1024 * 1024, 'GATEWAY_CACHE_MAX_SIZE_BYTES'),
    gatewayCacheControlMaxAgeSeconds: parseNumber(
      process.env.GATEWAY_CACHE_CONTROL_MAX_AGE_SECONDS,
      31536000,
      'GATEWAY_CACHE_CONTROL_MAX_AGE_SECONDS'
    ),
    rateLimitRequestsPerMinute: parseNumber(
      process.env.RATE_LIMIT_REQUESTS_PER_MINUTE,
      120,
      'RATE_LIMIT_REQUESTS_PER_MINUTE'
    ),
    x402FacilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://facilitator.taiko.xyz',
    x402Network: process.env.X402_NETWORK ?? 'eip155:167000',
    x402PayTo: process.env.X402_PAY_TO ?? '0x0000000000000000000000000000000000000001',
    x402UsdcAssetAddress: process.env.X402_USDC_ASSET_ADDRESS ?? '0x0000000000000000000000000000000000000001',
    x402UsdcAssetDecimals: parseNumber(process.env.X402_USDC_ASSET_DECIMALS, 6, 'X402_USDC_ASSET_DECIMALS'),
    x402UsdcDomainName: process.env.X402_USDC_DOMAIN_NAME ?? 'USD Coin',
    x402UsdcDomainVersion: process.env.X402_USDC_DOMAIN_VERSION ?? '2',
    x402BasePriceUsd: parseNumber(process.env.X402_BASE_PRICE_USD, 0.001, 'X402_BASE_PRICE_USD'),
    x402PricePerMbUsd: parseNumber(process.env.X402_PRICE_PER_MB_USD, 0.001, 'X402_PRICE_PER_MB_USD'),
    x402MaxPriceUsd: parseNumber(process.env.X402_MAX_PRICE_USD, 0.01, 'X402_MAX_PRICE_USD')
  };

  if (!Number.isInteger(config.walletAuthTokenTtlSeconds) || config.walletAuthTokenTtlSeconds <= 0) {
    throw new Error('WALLET_AUTH_TOKEN_TTL_SECONDS must be a positive integer');
  }

  validateProductionConfig(config);
  return config;
}
