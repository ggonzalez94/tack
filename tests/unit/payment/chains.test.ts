// tests/unit/payment/chains.test.ts
import { describe, expect, it } from 'vitest';
import { getChainByName, getChainByProtocol } from '../../../src/services/payment/chains';

describe('paymentChains', () => {
  it('includes taiko with x402 protocol', () => {
    const taiko = getChainByName('taiko');
    expect(taiko).toBeDefined();
    expect(taiko!.chainId).toBe(167000);
    expect(taiko!.protocol).toBe('x402');
    expect(taiko!.x402).toBeDefined();
  });

  it('includes tempo with mpp protocol', () => {
    const tempo = getChainByName('tempo');
    expect(tempo).toBeDefined();
    expect(tempo!.chainId).toBe(4217);
    expect(tempo!.protocol).toBe('mpp');
    expect(tempo!.mpp).toBeDefined();
    expect(tempo!.asset.address).toBe('0x20C000000000000000000000b9537d11c60E8b50');
  });

  it('getChainByProtocol returns correct chain', () => {
    expect(getChainByProtocol('x402')!.name).toBe('taiko');
    expect(getChainByProtocol('mpp')!.name).toBe('tempo');
  });
});
