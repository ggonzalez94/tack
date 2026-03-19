import { describe, expect, it } from 'vitest';
import { calculatePriceUsd, usdToAssetAmount } from '../../../src/services/payment/pricing';

describe('calculatePriceUsd', () => {
  const config = { basePriceUsd: 0.001, pricePerMbUsd: 0.001, maxPriceUsd: 0.01 };

  it('returns base price for files <= 1MB', () => {
    expect(calculatePriceUsd(500_000, config)).toBe(0.001);
    expect(calculatePriceUsd(1_000_000, config)).toBe(0.001);
  });

  it('adds per-MB cost for files > 1MB', () => {
    expect(calculatePriceUsd(2_000_001, config)).toBe(0.003);
  });

  it('caps at max price', () => {
    expect(calculatePriceUsd(100_000_000, config)).toBe(0.01);
  });

  it('returns base price for 0-byte files', () => {
    expect(calculatePriceUsd(0, config)).toBe(0.001);
  });
});

describe('usdToAssetAmount', () => {
  it('converts USD to 6-decimal asset amount', () => {
    const result = usdToAssetAmount(0.001, '0x2222222222222222222222222222222222222222', 6);
    expect(result.amount).toBe('1000');
    expect(result.asset).toBe('0x2222222222222222222222222222222222222222');
  });

  it('returns minimum of 1 for very small amounts', () => {
    const result = usdToAssetAmount(0, '0x2222222222222222222222222222222222222222', 6);
    expect(Number(result.amount)).toBeGreaterThanOrEqual(1);
  });
});
