import { describe, expect, it } from 'vitest';
import { getWalletAuthToken } from '../../src/services/wallet-auth';

describe('getWalletAuthToken', () => {
  it('returns null token for Authorization: Payment header (MPP)', () => {
    const headers = new Headers({ 'Authorization': 'Payment eyJjaGFsbGVuZ2Ui...' });
    const result = getWalletAuthToken(headers);
    expect(result.token).toBeNull();
    expect(result.malformed).toBe(false);
  });

  it('treats case-insensitive Payment auth headers as MPP credentials', () => {
    const headers = new Headers({ 'Authorization': 'payment eyJjaGFsbGVuZ2Ui...' });
    const result = getWalletAuthToken(headers);
    expect(result.token).toBeNull();
    expect(result.malformed).toBe(false);
  });

  it('returns token for Authorization: Bearer header', () => {
    const headers = new Headers({ 'Authorization': 'Bearer my-jwt-token' });
    const result = getWalletAuthToken(headers);
    expect(result.token).toBe('my-jwt-token');
    expect(result.malformed).toBe(false);
  });

  it('returns malformed for unknown scheme', () => {
    const headers = new Headers({ 'Authorization': 'Basic dXNlcjpwYXNz' });
    const result = getWalletAuthToken(headers);
    expect(result.token).toBeNull();
    expect(result.malformed).toBe(true);
  });

  it('returns token from x-wallet-auth-token header', () => {
    const headers = new Headers({ 'x-wallet-auth-token': 'direct-token' });
    const result = getWalletAuthToken(headers);
    expect(result.token).toBe('direct-token');
    expect(result.malformed).toBe(false);
  });

  it('returns null for no auth headers', () => {
    const headers = new Headers();
    const result = getWalletAuthToken(headers);
    expect(result.token).toBeNull();
    expect(result.malformed).toBe(false);
  });
});
