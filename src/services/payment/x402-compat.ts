// src/services/payment/x402-compat.ts

export interface X402ChallengeConfig {
  network: string;
  usdcAssetAddress: string;
  usdcDomainName: string;
  usdcDomainVersion: string;
}

export function buildX402ChallengeHeader(
  priceUsd: string,
  config: X402ChallengeConfig,
  payTo: string,
): string {
  return JSON.stringify({
    accepts: [{
      scheme: 'exact',
      network: config.network,
      maxAmountRequired: priceUsd,
      asset: config.usdcAssetAddress,
      payTo,
      extra: {
        name: config.usdcDomainName,
        version: config.usdcDomainVersion,
      },
    }],
  });
}
