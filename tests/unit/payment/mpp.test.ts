import { describe, expect, it } from 'vitest';
import { createMppInstance } from '../../../src/services/payment/mpp';

describe('createMppInstance', () => {
  it('creates an mppx instance with charge handler', () => {
    const mppx = createMppInstance({
      payTo: '0x1111111111111111111111111111111111111111',
      secretKey: 'test-secret-key-at-least-32-bytes-long!',
    });
    expect(typeof mppx.charge).toBe('function');
  });

  it('honours explicit realm for deterministic challenge binding', () => {
    const mppx = createMppInstance({
      payTo: '0x1111111111111111111111111111111111111111',
      secretKey: 'test-secret-key-at-least-32-bytes-long!',
      realm: 'https://tack.example',
    });
    expect(mppx.realm).toBe('https://tack.example');
  });

  it('supports testnet mode', () => {
    const mppx = createMppInstance({
      payTo: '0x1111111111111111111111111111111111111111',
      secretKey: 'test-secret-key-at-least-32-bytes-long!',
      testnet: true,
    });
    expect(typeof mppx.charge).toBe('function');
  });
});
