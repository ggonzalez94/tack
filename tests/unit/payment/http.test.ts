import { describe, expect, it } from 'vitest';
import { extractIpfsCidFromPath, extractPaymentAuthorizationCredential } from '../../../src/services/payment/http';

describe('extractPaymentAuthorizationCredential', () => {
  it('extracts the serialized credential from a Payment auth header', () => {
    expect(extractPaymentAuthorizationCredential('Payment credential-token')).toBe('credential-token');
  });

  it('accepts case-insensitive Payment auth schemes', () => {
    expect(extractPaymentAuthorizationCredential('payment credential-token')).toBe('credential-token');
  });

  it('returns null when the auth header is not Payment', () => {
    expect(extractPaymentAuthorizationCredential('Bearer token')).toBeNull();
  });

  it('returns null when the credential is missing', () => {
    expect(extractPaymentAuthorizationCredential('Payment   ')).toBeNull();
  });
});

describe('extractIpfsCidFromPath', () => {
  it('extracts the CID from the /ipfs/:cid route path', () => {
    expect(extractIpfsCidFromPath('/ipfs/bafy-test-cid')).toBe('bafy-test-cid');
  });

  it('returns null for non-IPFS paths', () => {
    expect(extractIpfsCidFromPath('/pins')).toBeNull();
  });

  it('returns null when the CID segment is empty or contains nested paths', () => {
    expect(extractIpfsCidFromPath('/ipfs/')).toBeNull();
    expect(extractIpfsCidFromPath('/ipfs/bafy-test-cid/extra')).toBeNull();
  });
});
