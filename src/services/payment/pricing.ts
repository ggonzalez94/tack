export interface LinearPricingConfig {
  ratePerGbMonthUsd: number;
  minPriceUsd: number;
  maxPriceUsd: number;
}

export function parseNonNegativeInteger(raw: string | null | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    return undefined;
  }

  return value;
}

export function parseDurationMonths(raw: string | null | undefined, defaultDuration: number, maxDuration: number): number {
  if (!raw) {
    return defaultDuration;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return defaultDuration;
  }

  return Math.min(value, maxDuration);
}

export function parseSizeBytesFromPinPayload(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const bodyRecord = body as Record<string, unknown>;
  const directSize = bodyRecord.sizeBytes;

  if (typeof directSize === 'number' && Number.isFinite(directSize) && directSize >= 0) {
    return Math.trunc(directSize);
  }

  const meta = bodyRecord.meta;
  if (!meta || typeof meta !== 'object') {
    return undefined;
  }

  const metaRecord = meta as Record<string, unknown>;
  const metaSize = metaRecord.contentSizeBytes ?? metaRecord.sizeBytes;

  if (typeof metaSize === 'number' && Number.isFinite(metaSize) && metaSize >= 0) {
    return Math.trunc(metaSize);
  }

  if (typeof metaSize === 'string') {
    return parseNonNegativeInteger(metaSize);
  }

  return undefined;
}

export function calculatePriceUsd(sizeBytes: number, durationMonths: number, config: LinearPricingConfig): number {
  const fileSizeGb = sizeBytes / 1_073_741_824;
  const computed = fileSizeGb * config.ratePerGbMonthUsd * durationMonths;
  return Math.min(Math.max(computed, config.minPriceUsd), config.maxPriceUsd);
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
