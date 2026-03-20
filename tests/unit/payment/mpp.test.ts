import { describe, expect, it } from 'vitest';
import { createMppInstance } from '../../../src/services/payment/mpp';

describe('createMppInstance', () => {
  it('creates an mppx instance with charge handler', () => {
    const mppx = createMppInstance(
      '0x1111111111111111111111111111111111111111',
      'test-secret-key-at-least-32-bytes-long!'
    );
    // mppx.charge should be a function (the charge handler accessor)
    expect(typeof mppx.charge).toBe('function');
  });
});
