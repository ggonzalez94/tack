import { describe, expect, it } from 'vitest';
import { BASE_CHAIN } from '../../src/services/payment/chains/base';

describe('BASE_CHAIN constants', () => {
  it('points at Base mainnet with Circle native USDC', () => {
    expect(BASE_CHAIN.network).toBe('eip155:8453');
    expect(BASE_CHAIN.usdcAssetAddress).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(BASE_CHAIN.usdcAssetDecimals).toBe(6);
    expect(BASE_CHAIN.usdcDomainName).toBe('USD Coin');
    expect(BASE_CHAIN.usdcDomainVersion).toBe('2');
  });

  it('defaults to the PayAI permissionless facilitator', () => {
    expect(BASE_CHAIN.facilitatorUrl).toBe('https://facilitator.payai.network');
  });
});
