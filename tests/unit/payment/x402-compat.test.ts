// tests/unit/payment/x402-compat.test.ts
import { describe, expect, it } from 'vitest';
import { buildX402ChallengeHeader } from '../../../src/services/payment/x402-compat';

interface X402Challenge {
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    payTo: string;
    asset: string;
    extra: {
      name: string;
      version: string;
    };
  }>;
}

describe('buildX402ChallengeHeader', () => {
  it('produces valid x402 payment-required JSON', () => {
    const result = buildX402ChallengeHeader('1000', {
      network: 'eip155:167000',
      usdcAssetAddress: '0x2222222222222222222222222222222222222222',
      usdcDomainName: 'USD Coin',
      usdcDomainVersion: '2',
    }, '0x1111111111111111111111111111111111111111');

    const parsed = JSON.parse(result) as X402Challenge;
    expect(parsed.accepts).toHaveLength(1);
    expect(parsed.accepts[0].scheme).toBe('exact');
    expect(parsed.accepts[0].network).toBe('eip155:167000');
    expect(parsed.accepts[0].maxAmountRequired).toBe('1000');
    expect(parsed.accepts[0].payTo).toBe('0x1111111111111111111111111111111111111111');
    expect(parsed.accepts[0].asset).toBe('0x2222222222222222222222222222222222222222');
    expect(parsed.accepts[0].extra.name).toBe('USD Coin');
    expect(parsed.accepts[0].extra.version).toBe('2');
  });
});
