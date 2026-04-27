import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { createDb } from '../../src/db';
import { WalletAuthChallengeRepository } from '../../src/repositories/wallet-auth-challenge-repository';
import { verifyWalletAuthToken, type WalletAuthConfig } from '../../src/services/wallet-auth';
import { WalletLoginService } from '../../src/services/wallet-login';

const walletAuthConfig: WalletAuthConfig = {
  secret: '0123456789abcdef0123456789abcdef',
  issuer: 'tack',
  audience: 'tack-owner-api',
  ttlSeconds: 900
};

const account = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const wallet = account.address.toLowerCase();

describe('WalletLoginService', () => {
  let db: Database.Database;
  let service: WalletLoginService;

  beforeEach(() => {
    vi.useRealTimers();
    db = createDb(':memory:');
    service = new WalletLoginService(new WalletAuthChallengeRepository(db), {
      walletAuth: walletAuthConfig,
      allowedNetworks: ['eip155:167000', 'eip155:8453'],
      eip1271RpcUrls: {},
      challengeTtlSeconds: 600
    });
  });

  it('creates an OWS-compatible SIWE challenge from a CAIP-2 network', () => {
    const challenge = service.createChallenge({
      address: wallet,
      network: 'eip155:8453',
      origin: 'https://tack.example'
    });

    expect(challenge.network).toBe('eip155:8453');
    expect(challenge.chainId).toBe(8453);
    expect(challenge.message).toContain('tack.example wants you to sign in with your Ethereum account:');
    expect(challenge.message).toContain(account.address);
    expect(challenge.message).toContain('Chain ID: 8453');
    expect(challenge.message).toContain('Sign in to Tack to access wallet-owned storage.');
    expect(challenge.nonce).toMatch(/^[a-f0-9]{32}$/);
  });

  it('accepts numeric chainId and normalizes it to a CAIP-2 network', () => {
    const challenge = service.createChallenge({
      address: wallet,
      chainId: 167000,
      origin: 'https://tack.example'
    });

    expect(challenge.network).toBe('eip155:167000');
    expect(challenge.chainId).toBe(167000);
  });

  it('rejects unsupported networks', () => {
    expect(() => service.createChallenge({
      address: wallet,
      network: 'solana:mainnet',
      origin: 'https://tack.example'
    })).toThrow('unsupported wallet auth network');
  });

  it('issues a wallet auth token for a valid EIP-191 signature', async () => {
    const challenge = service.createChallenge({
      address: wallet,
      network: 'eip155:8453',
      origin: 'https://tack.example'
    });
    const signature = await account.signMessage({ message: challenge.message });

    const result = await service.exchangeToken({ message: challenge.message, signature });
    const verified = verifyWalletAuthToken(result.token, walletAuthConfig);

    expect(result.wallet).toBe(wallet);
    expect(result.expiresAt).toBeTruthy();
    expect(verified.wallet).toBe(wallet);
    expect(verified.error).toBeNull();
  });

  it('rejects replayed challenges', async () => {
    const challenge = service.createChallenge({
      address: wallet,
      network: 'eip155:8453',
      origin: 'https://tack.example'
    });
    const signature = await account.signMessage({ message: challenge.message });

    await service.exchangeToken({ message: challenge.message, signature });

    await expect(service.exchangeToken({ message: challenge.message, signature }))
      .rejects.toThrow('wallet auth challenge was already used');
  });

  it('rejects expired challenges', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));
    const challenge = service.createChallenge({
      address: wallet,
      network: 'eip155:8453',
      origin: 'https://tack.example'
    });
    const signature = await account.signMessage({ message: challenge.message });

    vi.setSystemTime(new Date('2026-04-23T12:11:00.000Z'));

    await expect(service.exchangeToken({ message: challenge.message, signature }))
      .rejects.toThrow('wallet auth challenge has expired');
  });

  it('rejects signatures from a different wallet', async () => {
    const other = privateKeyToAccount(`0x${'2'.repeat(64)}`);
    const challenge = service.createChallenge({
      address: wallet,
      network: 'eip155:8453',
      origin: 'https://tack.example'
    });
    const signature = await other.signMessage({ message: challenge.message });

    await expect(service.exchangeToken({ message: challenge.message, signature }))
      .rejects.toThrow('wallet auth signature is invalid');
  });
});
