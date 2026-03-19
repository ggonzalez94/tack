interface PricingConfig {
  basePriceUsd: number;
  pricePerMbUsd: number;
  maxPriceUsd: number;
}

export function calculatePriceUsd(sizeBytes: number, config: PricingConfig): number {
  const base = config.basePriceUsd;
  const max = config.maxPriceUsd;
  const perMb = config.pricePerMbUsd;

  if (sizeBytes <= 1_000_000) {
    return Math.min(base, max);
  }

  const additionalBytes = sizeBytes - 1_000_000;
  const additionalMegabytes = Math.ceil(additionalBytes / 1_000_000);
  return Math.min(base + additionalMegabytes * perMb, max);
}

export function usdToAssetAmount(
  usdAmount: number,
  assetAddress: string,
  assetDecimals: number,
): { amount: string; asset: string } {
  const factor = 10 ** assetDecimals;
  const scaled = Math.max(1, Math.round((usdAmount + Number.EPSILON) * factor));

  return {
    amount: String(scaled),
    asset: assetAddress,
  };
}
