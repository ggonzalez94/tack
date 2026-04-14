import { Mppx, tempo } from 'mppx/server';

/**
 * Default TIP-20 stablecoin addresses on Tempo. These match the mppx SDK's
 * built-in defaults (see `mppx/tempo/internal/defaults`) and are duplicated
 * here so we can pass them as explicit type-level defaults to `tempo()` —
 * the SDK's runtime resolution based on `testnet` isn't reflected in the
 * method's default types, which forces charge callers to specify `currency`
 * at every call site unless we set it explicitly here.
 */
const TEMPO_USDC_E_MAINNET = '0x20C000000000000000000000b9537d11c60E8b50' as const;
const TEMPO_PATH_USD_TESTNET = '0x20c0000000000000000000000000000000000000' as const;

export interface CreateMppInstanceOptions {
  payTo: string;
  secretKey: string;
  /**
   * Server realm used in the `WWW-Authenticate` challenge. Set explicitly
   * to the public origin (e.g. `https://tack.example`) so that HMAC-bound
   * challenge IDs remain consistent across replicas and environments
   * instead of relying on mppx's env-variable auto-detection.
   */
  realm?: string;
  /**
   * Use Tempo testnet (Moderato) instead of mainnet. Defaults to mainnet.
   */
  testnet?: boolean;
}

export function createMppInstance(options: CreateMppInstanceOptions) {
  const { payTo, secretKey, realm, testnet = false } = options;
  const currency = testnet ? TEMPO_PATH_USD_TESTNET : TEMPO_USDC_E_MAINNET;

  return Mppx.create({
    secretKey,
    realm,
    methods: [
      tempo({
        currency,
        recipient: payTo as `0x${string}`,
        testnet,
      }),
    ],
  });
}

export type MppInstance = ReturnType<typeof createMppInstance>;
