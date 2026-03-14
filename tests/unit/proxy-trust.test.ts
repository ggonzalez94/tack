import { describe, expect, it } from 'vitest';
import { isTrustedProxy } from '../../src/lib/proxy-trust';

describe('isTrustedProxy', () => {
  it('matches IPv4 CIDR ranges', () => {
    expect(isTrustedProxy('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(isTrustedProxy('203.0.113.4', ['10.0.0.0/8'])).toBe(false);
  });

  it('matches exact IPv6 addresses and mapped IPv4 addresses', () => {
    expect(isTrustedProxy('2001:db8::1', ['2001:db8::1'])).toBe(true);
    expect(isTrustedProxy('::ffff:10.1.2.3', ['10.0.0.0/8'])).toBe(true);
  });

  it('fails closed for invalid input', () => {
    expect(isTrustedProxy(undefined, ['10.0.0.0/8'])).toBe(false);
    expect(isTrustedProxy('10.1.2.3', [])).toBe(false);
    expect(isTrustedProxy('not-an-ip', ['10.0.0.0/8'])).toBe(false);
  });
});
