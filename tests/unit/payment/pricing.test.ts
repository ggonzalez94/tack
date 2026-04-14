import { describe, expect, it } from 'vitest';
import {
  calculatePriceUsd,
  formatUsdAmount,
  parseDurationMonths,
  parseNonNegativeInteger,
  parseSizeBytesFromPinPayload,
  usdToAssetAmount
} from '../../../src/services/payment/pricing';

describe('calculatePriceUsd', () => {
  const config = {
    ratePerGbMonthUsd: 0.10,
    minPriceUsd: 0.001,
    maxPriceUsd: 50.0
  };

  it('returns the minimum price for tiny files', () => {
    expect(calculatePriceUsd(500_000, 1, config)).toBe(0.001);
    expect(calculatePriceUsd(1_000_000, 1, config)).toBe(0.001);
    expect(calculatePriceUsd(0, 1, config)).toBe(0.001);
  });

  it('prices linearly by size and duration', () => {
    const oneGb = 1_073_741_824;
    expect(calculatePriceUsd(oneGb, 1, config)).toBeCloseTo(0.10, 6);
    expect(calculatePriceUsd(oneGb, 6, config)).toBeCloseTo(0.60, 6);
    expect(calculatePriceUsd(100 * 1_000_000, 6, config)).toBeCloseTo(0.056, 3);
  });

  it('caps the computed price', () => {
    const tenGb = 10 * 1_073_741_824;
    expect(calculatePriceUsd(tenGb, 24, config)).toBeCloseTo(24.0, 2);
    expect(calculatePriceUsd(tenGb, 24, { ...config, maxPriceUsd: 5.0 })).toBe(5.0);
  });
});

describe('parseDurationMonths', () => {
  it('falls back to default for missing or invalid values', () => {
    expect(parseDurationMonths(null, 1, 24)).toBe(1);
    expect(parseDurationMonths(undefined, 6, 24)).toBe(6);
    expect(parseDurationMonths('', 1, 24)).toBe(1);
    expect(parseDurationMonths('0', 1, 24)).toBe(1);
    expect(parseDurationMonths('1.5', 1, 24)).toBe(1);
    expect(parseDurationMonths('abc', 1, 24)).toBe(1);
  });

  it('parses valid values and clamps to the max duration', () => {
    expect(parseDurationMonths('1', 1, 24)).toBe(1);
    expect(parseDurationMonths('12', 1, 24)).toBe(12);
    expect(parseDurationMonths('25', 1, 24)).toBe(24);
  });
});

describe('parseNonNegativeInteger', () => {
  it('parses valid integers and rejects invalid values', () => {
    expect(parseNonNegativeInteger('0')).toBe(0);
    expect(parseNonNegativeInteger('42')).toBe(42);
    expect(parseNonNegativeInteger('-1')).toBeUndefined();
    expect(parseNonNegativeInteger('1.5')).toBeUndefined();
    expect(parseNonNegativeInteger('abc')).toBeUndefined();
  });
});

describe('parseSizeBytesFromPinPayload', () => {
  it('uses top-level sizeBytes when present', () => {
    expect(parseSizeBytesFromPinPayload({ cid: 'bafy-test', sizeBytes: 1234 })).toBe(1234);
  });

  it('falls back to metadata contentSizeBytes or sizeBytes', () => {
    expect(parseSizeBytesFromPinPayload({ meta: { contentSizeBytes: '4567' } })).toBe(4567);
    expect(parseSizeBytesFromPinPayload({ meta: { sizeBytes: 8910 } })).toBe(8910);
  });

  it('ignores malformed payloads', () => {
    expect(parseSizeBytesFromPinPayload(null)).toBeUndefined();
    expect(parseSizeBytesFromPinPayload({ meta: { contentSizeBytes: 'invalid' } })).toBeUndefined();
  });
});

describe('formatUsdAmount', () => {
  it('formats whole-dollar and sub-dollar values as plain decimals', () => {
    expect(formatUsdAmount(0)).toBe('0.000001');
    expect(formatUsdAmount(0.001)).toBe('0.001');
    expect(formatUsdAmount(0.01)).toBe('0.01');
    expect(formatUsdAmount(1)).toBe('1');
    expect(formatUsdAmount(1.5)).toBe('1.5');
    expect(formatUsdAmount(50.123456)).toBe('50.123456');
  });

  it('never emits scientific notation for tiny values', () => {
    // Native String(1e-7) -> "1e-7", which mppx rejects. The formatter
    // snaps the minimum to the asset's smallest unit (1 micro-USD by
    // default) and always returns a plain decimal string.
    const formatted = formatUsdAmount(1e-7);
    expect(formatted).not.toContain('e');
    expect(formatted).toBe('0.000001');
  });

  it('rejects invalid amounts', () => {
    expect(() => formatUsdAmount(Number.NaN)).toThrow('Invalid USD amount');
    expect(() => formatUsdAmount(-1)).toThrow('Invalid USD amount');
  });
});

describe('usdToAssetAmount', () => {
  it('converts USD to 6-decimal asset amount', () => {
    const result = usdToAssetAmount(0.001, '0x2222222222222222222222222222222222222222', 6);
    expect(result.amount).toBe('1000');
    expect(result.asset).toBe('0x2222222222222222222222222222222222222222');
  });

  it('returns a minimum asset amount of 1', () => {
    const result = usdToAssetAmount(0, '0x2222222222222222222222222222222222222222', 6);
    expect(Number(result.amount)).toBeGreaterThanOrEqual(1);
  });
});
