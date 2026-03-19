import { afterEach, describe, expect, it } from 'vitest';
import { getConfig } from '../../src/config';

const originalEnv = { ...process.env };
const realPayTo = '0x1111111111111111111111111111111111111111';
const realUsdc = '0x2222222222222222222222222222222222222222';
const placeholderAddress = '0x0000000000000000000000000000000000000001';

function setTestEnv(overrides: Record<string, string>): void {
  process.env = {
    ...originalEnv,
    ...overrides
  };
}

describe('config validation', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('requires WALLET_AUTH_TOKEN_SECRET', () => {
    setTestEnv({
      WALLET_AUTH_TOKEN_SECRET: ''
    });

    expect(() => getConfig()).toThrow('Missing required environment variable: WALLET_AUTH_TOKEN_SECRET');
  });

  it('fails fast in production when WALLET_AUTH_TOKEN_SECRET is weak', () => {
    setTestEnv({
      NODE_ENV: 'production',
      WALLET_AUTH_TOKEN_SECRET: 'change-me',
      X402_PAY_TO: realPayTo,
      X402_USDC_ASSET_ADDRESS: realUsdc
    });

    expect(() => getConfig()).toThrow('WALLET_AUTH_TOKEN_SECRET must be a strong random secret');
  });

  it('fails fast in production when X402_PAY_TO is a placeholder', () => {
    setTestEnv({
      NODE_ENV: 'production',
      WALLET_AUTH_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
      X402_PAY_TO: placeholderAddress,
      X402_USDC_ASSET_ADDRESS: realUsdc
    });

    expect(() => getConfig()).toThrow('X402_PAY_TO must be a real wallet address');
  });

  it('fails fast in production when X402_USDC_ASSET_ADDRESS is a placeholder', () => {
    setTestEnv({
      NODE_ENV: 'production',
      WALLET_AUTH_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
      X402_PAY_TO: realPayTo,
      X402_USDC_ASSET_ADDRESS: placeholderAddress
    });

    expect(() => getConfig()).toThrow('X402_USDC_ASSET_ADDRESS must be a real token address');
  });

  it('accepts explicit production x402 configuration', () => {
    setTestEnv({
      NODE_ENV: 'production',
      WALLET_AUTH_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
      X402_NETWORK: 'eip155:167000',
      X402_PAY_TO: realPayTo,
      X402_USDC_ASSET_ADDRESS: realUsdc
    });

    const config = getConfig();
    expect(config.x402Network).toBe('eip155:167000');
    expect(config.x402PayTo).toBe(realPayTo);
    expect(config.x402UsdcAssetAddress).toBe(realUsdc);
    expect(config.walletAuthTokenAudience).toBe('tack-owner-api');
    expect(config.walletAuthTokenIssuer).toBe('tack');
    expect(config.walletAuthTokenTtlSeconds).toBe(900);
  });

  it('parses replica URL lists', () => {
    setTestEnv({
      WALLET_AUTH_TOKEN_SECRET: 'test-wallet-auth-secret',
      PIN_REPLICA_IPFS_API_URLS: 'http://ipfs-a:5001, http://ipfs-b:5001',
      PIN_REPLICA_DELEGATE_URLS: 'https://gw-a.example/ipfs,https://gw-b.example/ipfs'
    });

    const config = getConfig();
    expect(config.pinReplicaIpfsApiUrls).toEqual(['http://ipfs-a:5001', 'http://ipfs-b:5001']);
    expect(config.pinReplicaDelegateUrls).toEqual(['https://gw-a.example/ipfs', 'https://gw-b.example/ipfs']);
  });

  it('parses PUBLIC_BASE_URL as an origin', () => {
    setTestEnv({
      WALLET_AUTH_TOKEN_SECRET: 'test-wallet-auth-secret',
      PUBLIC_BASE_URL: 'https://api.tack.example/'
    });

    const config = getConfig();
    expect(config.publicBaseUrl).toBe('https://api.tack.example');
  });

  it('fails when replica delegate URLs do not match replica API URL count', () => {
    setTestEnv({
      WALLET_AUTH_TOKEN_SECRET: 'test-wallet-auth-secret',
      PIN_REPLICA_IPFS_API_URLS: 'http://ipfs-a:5001,http://ipfs-b:5001',
      PIN_REPLICA_DELEGATE_URLS: 'https://gw-a.example/ipfs'
    });

    expect(() => getConfig()).toThrow(
      'PIN_REPLICA_DELEGATE_URLS must have the same number of entries as PIN_REPLICA_IPFS_API_URLS'
    );
  });

  it('rejects PUBLIC_BASE_URL values with paths', () => {
    setTestEnv({
      WALLET_AUTH_TOKEN_SECRET: 'test-wallet-auth-secret',
      PUBLIC_BASE_URL: 'https://api.tack.example/v1'
    });

    expect(() => getConfig()).toThrow('PUBLIC_BASE_URL must be an origin without path, query, or hash');
  });

  it('rejects non-positive wallet auth token ttl', () => {
    setTestEnv({
      WALLET_AUTH_TOKEN_SECRET: 'test-wallet-auth-secret',
      WALLET_AUTH_TOKEN_TTL_SECONDS: '0'
    });

    expect(() => getConfig()).toThrow('WALLET_AUTH_TOKEN_TTL_SECONDS must be a positive integer');
  });

  it('parses new pricing env vars with defaults', () => {
    setTestEnv({
      WALLET_AUTH_TOKEN_SECRET: 'test-wallet-auth-secret'
    });

    const config = getConfig();
    expect(config.x402RatePerGbMonthUsd).toBe(0.05);
    expect(config.x402MinPriceUsd).toBe(0.001);
    expect(config.x402MaxPriceUsd).toBe(50.0);
    expect(config.x402DefaultDurationMonths).toBe(1);
    expect(config.x402MaxDurationMonths).toBe(24);
  });

  it('parses custom pricing env vars', () => {
    setTestEnv({
      WALLET_AUTH_TOKEN_SECRET: 'test-wallet-auth-secret',
      X402_RATE_PER_GB_MONTH_USD: '0.10',
      X402_MIN_PRICE_USD: '0.002',
      X402_MAX_PRICE_USD: '25.0',
      X402_DEFAULT_DURATION_MONTHS: '6',
      X402_MAX_DURATION_MONTHS: '12'
    });

    const config = getConfig();
    expect(config.x402RatePerGbMonthUsd).toBe(0.10);
    expect(config.x402MinPriceUsd).toBe(0.002);
    expect(config.x402MaxPriceUsd).toBe(25.0);
    expect(config.x402DefaultDurationMonths).toBe(6);
    expect(config.x402MaxDurationMonths).toBe(12);
  });
});
