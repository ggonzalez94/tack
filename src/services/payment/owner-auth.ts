import { HTTPException } from 'hono/http-exception';
import {
  getWalletAuthToken,
  verifyWalletAuthToken,
  type WalletAuthConfig,
} from '../wallet-auth.js';

// Derives the owner wallet for an MPP renewal from the raw request headers.
// Works identically for the Hono middleware pass (full Context) and the
// minimal Context shim that the Tempo payer resolver rebuilds during
// post-charge payer lookup — both paths must compute the owner the same
// way, or the charge settles on-chain without the renewal ever being
// persisted.
export function requireOwnerWalletFromHeaders(
  headers: Headers,
  config: WalletAuthConfig
): string {
  const { token, malformed } = getWalletAuthToken(headers);
  if (token === null) {
    throw new HTTPException(401, {
      message: malformed
        ? 'wallet auth token is malformed'
        : 'authenticated wallet identity is required (bearer token)',
    });
  }

  const { wallet, error } = verifyWalletAuthToken(token, config);
  if (wallet === null) {
    throw new HTTPException(401, {
      message: error ?? 'invalid wallet auth token',
    });
  }

  return wallet;
}
