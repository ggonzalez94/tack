import { describe, expect, it } from 'vitest';
import { normalizeAddress, extractWalletFromDid } from '../../../src/services/payment/wallet';

describe('normalizeAddress', () => {
  it('normalizes a valid checksummed address to lowercase', () => {
    expect(normalizeAddress('0xABCDEF1234567890abcdef1234567890ABCDEF12'))
      .toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });

  it('throws on invalid address (too short)', () => {
    expect(() => normalizeAddress('0xabc')).toThrow('Invalid EVM address');
  });

  it('throws on address without 0x prefix', () => {
    expect(() => normalizeAddress('abcdef1234567890abcdef1234567890abcdef12')).toThrow('Invalid EVM address');
  });
});

describe('extractWalletFromDid', () => {
  it('extracts address from valid DID PKH', () => {
    expect(extractWalletFromDid('did:pkh:eip155:4217:0xABCDEF1234567890abcdef1234567890ABCDEF12'))
      .toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });

  it('works with different chain IDs', () => {
    expect(extractWalletFromDid('did:pkh:eip155:1:0x1111111111111111111111111111111111111111'))
      .toBe('0x1111111111111111111111111111111111111111');
  });

  it('throws on invalid DID format (missing parts)', () => {
    expect(() => extractWalletFromDid('did:pkh:eip155')).toThrow('Invalid DID format');
  });

  it('throws on non-DID string', () => {
    expect(() => extractWalletFromDid('not-a-did')).toThrow('Invalid DID format');
  });

  it('throws on DID with invalid address', () => {
    expect(() => extractWalletFromDid('did:pkh:eip155:4217:0xinvalid')).toThrow('Invalid EVM address');
  });
});
