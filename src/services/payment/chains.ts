import type { PaymentChain, PaymentProtocol } from './types.js';

export const paymentChains: PaymentChain[] = [
  {
    name: 'taiko',
    chainId: 167000,
    protocol: 'x402',
    rpcUrl: 'https://rpc.mainnet.taiko.xyz',
    asset: {
      address: process.env.X402_USDC_ASSET_ADDRESS ?? '0x0000000000000000000000000000000000000001',
      decimals: 6,
      symbol: 'USDC',
    },
    x402: {
      network: 'eip155:167000',
      facilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://facilitator.taiko.xyz',
      domainName: 'USD Coin',
      domainVersion: '2',
    },
  },
  {
    name: 'tempo',
    chainId: 4217,
    protocol: 'mpp',
    rpcUrl: 'https://rpc.tempo.xyz',
    asset: {
      address: '0x20C000000000000000000000b9537d11c60E8b50',
      decimals: 6,
      symbol: 'USDC.e',
    },
    mpp: {
      method: 'tempo',
      intent: 'charge',
    },
  },
];

export function getChainByName(name: string): PaymentChain | undefined {
  return paymentChains.find((c) => c.name === name);
}

export function getChainByProtocol(protocol: PaymentProtocol): PaymentChain | undefined {
  return paymentChains.find((c) => c.protocol === protocol);
}
