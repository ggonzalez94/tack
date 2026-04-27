import { createHash, randomBytes } from 'node:crypto';
import {
  createPublicClient,
  getAddress,
  hashMessage,
  http,
  isAddress,
  isAddressEqual,
  recoverMessageAddress,
  type Hex
} from 'viem';
import { ValidationError } from '../lib/errors';
import type { WalletAuthChallengeRepository } from '../repositories/wallet-auth-challenge-repository';
import { createWalletAuthToken, type WalletAuthConfig } from './wallet-auth';

const DEFAULT_CHALLENGE_TTL_SECONDS = 600;
const SIWE_STATEMENT = 'Sign in to Tack to access wallet-owned storage.';
const EIP1271_MAGIC_VALUE = '0x1626ba7e';

const EIP1271_ABI = [
  {
    type: 'function',
    name: 'isValidSignature',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: [{ name: 'magicValue', type: 'bytes4' }]
  }
] as const;

export interface WalletLoginConfig {
  walletAuth: WalletAuthConfig;
  allowedNetworks: string[];
  eip1271RpcUrls: Record<string, string>;
  challengeTtlSeconds?: number;
}

export interface CreateWalletLoginChallengeInput {
  address: string;
  network?: string;
  chainId?: number;
  origin: string;
}

export interface WalletLoginChallengeResponse {
  message: string;
  nonce: string;
  network: string;
  chainId: number;
  expiresAt: string;
}

export interface WalletLoginTokenResponse {
  wallet: string;
  token: string;
  expiresAt: string;
}

interface ParsedSiweMessage {
  domain: string;
  address: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

function parseNetwork(input: { network?: string; chainId?: number }): { network: string; chainId: number } {
  if (input.network) {
    const match = /^eip155:(\d+)$/.exec(input.network.trim());
    if (!match) {
      throw new ValidationError('unsupported wallet auth network');
    }

    const chainId = Number(match[1]);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new ValidationError('unsupported wallet auth network');
    }

    return { network: `eip155:${chainId}`, chainId };
  }

  if (input.chainId !== undefined) {
    if (!Number.isInteger(input.chainId) || input.chainId <= 0) {
      throw new ValidationError('unsupported wallet auth network');
    }

    return { network: `eip155:${input.chainId}`, chainId: input.chainId };
  }

  throw new ValidationError('wallet auth network is required');
}

function parseOrigin(origin: string): { domain: string; uri: string } {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new ValidationError('wallet auth origin is invalid');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('wallet auth origin must use http or https');
  }

  return {
    domain: url.host,
    uri: url.origin
  };
}

function buildSiweMessage(input: {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    `${input.domain} wants you to sign in with your Ethereum account:`,
    input.address,
    '',
    SIWE_STATEMENT,
    '',
    `URI: ${input.uri}`,
    'Version: 1',
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`
  ].join('\n');
}

function parseSiweMessage(message: string): ParsedSiweMessage {
  const lines = message.split('\n');
  const firstLine = lines[0] ?? '';
  const domainMatch = /^(.+) wants you to sign in with your Ethereum account:$/.exec(firstLine);
  if (!domainMatch) {
    throw new ValidationError('wallet auth message is invalid');
  }

  const address = lines[1] ?? '';
  const statement = lines[3] ?? '';
  if (statement !== SIWE_STATEMENT) {
    throw new ValidationError('wallet auth statement is invalid');
  }

  const fields = new Map<string, string>();
  for (const line of lines.slice(5)) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    fields.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }

  const chainId = Number(fields.get('Chain ID'));
  const nonce = fields.get('Nonce') ?? '';
  const uri = fields.get('URI') ?? '';
  const version = fields.get('Version') ?? '';
  const issuedAt = fields.get('Issued At') ?? '';
  const expirationTime = fields.get('Expiration Time') ?? '';

  if (!isAddress(address) || version !== '1' || !Number.isInteger(chainId) || chainId <= 0 || nonce.length === 0) {
    throw new ValidationError('wallet auth message is invalid');
  }

  return {
    domain: domainMatch[1],
    address: getAddress(address),
    uri,
    version,
    chainId,
    nonce,
    issuedAt,
    expirationTime
  };
}

export class WalletLoginService {
  private readonly challengeTtlSeconds: number;

  constructor(
    private readonly repository: WalletAuthChallengeRepository,
    private readonly config: WalletLoginConfig
  ) {
    this.challengeTtlSeconds = config.challengeTtlSeconds ?? DEFAULT_CHALLENGE_TTL_SECONDS;
  }

  createChallenge(input: CreateWalletLoginChallengeInput): WalletLoginChallengeResponse {
    const address = isAddress(input.address) ? getAddress(input.address) : null;
    if (!address) {
      throw new ValidationError('wallet auth address is invalid');
    }

    const { network, chainId } = parseNetwork(input);
    if (!this.config.allowedNetworks.includes(network)) {
      throw new ValidationError('unsupported wallet auth network');
    }

    const { domain, uri } = parseOrigin(input.origin);
    const now = new Date();
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.challengeTtlSeconds * 1000).toISOString();
    const nonce = randomBytes(16).toString('hex');
    const message = buildSiweMessage({
      domain,
      address,
      uri,
      chainId,
      nonce,
      issuedAt,
      expiresAt
    });

    this.repository.deleteExpired(issuedAt);
    this.repository.create({
      nonceHash: hashNonce(nonce),
      address: address.toLowerCase(),
      network,
      chainId,
      domain,
      uri,
      message,
      expiresAt,
      consumedAt: null,
      created: issuedAt
    });

    return {
      message,
      nonce,
      network,
      chainId,
      expiresAt
    };
  }

  async exchangeToken(input: { message: string; signature: string }): Promise<WalletLoginTokenResponse> {
    const parsed = parseSiweMessage(input.message);
    const nonceHash = hashNonce(parsed.nonce);
    const record = this.repository.findByNonceHash(nonceHash);
    if (!record || record.message !== input.message) {
      throw new ValidationError('wallet auth challenge was not found');
    }

    if (record.consumedAt !== null) {
      throw new ValidationError('wallet auth challenge was already used');
    }

    const now = new Date().toISOString();
    if (record.expiresAt <= now) {
      throw new ValidationError('wallet auth challenge has expired');
    }

    const valid = await this.verifySignature(record.address, record.network, input.message, input.signature);
    if (!valid) {
      throw new ValidationError('wallet auth signature is invalid');
    }

    if (!this.repository.consume(nonceHash, now)) {
      throw new ValidationError('wallet auth challenge was already used');
    }

    const token = createWalletAuthToken(record.address, this.config.walletAuth);
    return {
      wallet: record.address,
      token: token.token,
      expiresAt: token.expiresAt
    };
  }

  private async verifySignature(address: string, network: string, message: string, signature: string): Promise<boolean> {
    if (!/^0x[0-9a-fA-F]+$/.test(signature)) {
      return false;
    }

    try {
      const recovered = await recoverMessageAddress({
        message,
        signature: signature as Hex
      });
      if (isAddressEqual(recovered, address as Hex)) {
        return true;
      }
    } catch {
      // Try EIP-1271 below when an RPC is configured.
    }

    const rpcUrl = this.config.eip1271RpcUrls[network];
    if (!rpcUrl) {
      return false;
    }

    const client = createPublicClient({ transport: http(rpcUrl) });
    try {
      const magicValue = await client.readContract({
        address: address as Hex,
        abi: EIP1271_ABI,
        functionName: 'isValidSignature',
        args: [hashMessage(message), signature as Hex]
      });
      return magicValue.toLowerCase() === EIP1271_MAGIC_VALUE;
    } catch {
      return false;
    }
  }
}
