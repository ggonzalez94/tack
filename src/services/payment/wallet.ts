/**
 * Normalize EVM address to lowercase with 0x prefix.
 * Validates format: 0x-prefixed, 40 hex chars.
 */
export function normalizeAddress(address: string): string {
  const normalized = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }
  return normalized;
}

/**
 * Extract 0x address from DID PKH format.
 * Input: "did:pkh:eip155:4217:0xABC..."
 * Output: "0xabc..." (normalized lowercase)
 */
export function extractWalletFromDid(did: string): string {
  const parts = did.split(':');
  if (parts.length < 5 || parts[0] !== 'did' || parts[1] !== 'pkh') {
    throw new Error(`Invalid DID format: ${did}`);
  }
  return normalizeAddress(parts[4]);
}
