# Linear Pricing by Size and Duration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat capped pricing model with linear pricing by file size and duration, add pin expiry with an in-process sweep timer.

**Architecture:** New pricing formula `max(min, sizeGB * rate * months)` replaces the old base+perMB+cap model. Pins get an `expires_at` column computed from a caller-provided `X-Pin-Duration-Months` header. An in-process `setInterval` sweeps expired pins by unpinning from Kubo and hard-deleting records.

**Tech Stack:** TypeScript, Hono, SQLite (better-sqlite3), Vitest, x402 SDK

**Spec:** `docs/superpowers/specs/2026-03-19-linear-pricing-duration-design.md`

---

### Task 1: Update config and types for new pricing model

**Files:**
- Modify: `src/config.ts:1-196`
- Modify: `src/types.ts:1-37`
- Test: `tests/unit/config.test.ts`

- [ ] **Step 1: Write failing tests for new config env vars**

Add to `tests/unit/config.test.ts`:

```typescript
it('parses new pricing env vars with defaults', () => {
  setTestEnv({
    WALLET_AUTH_TOKEN_SECRET: 'test-wallet-auth-secret'
  });

  const config = getConfig();
  expect(config.x402RatePerGbMonthUsd).toBe(0.05);
  expect(config.x402MinPriceUsd).toBe(0.001);
  expect(config.x402MaxPriceUsd).toBe(50.0);
  expect(config.x402DefaultDurationMonths).toBe(1);
  expect(config.x402MaxDurationMonths).toBe(24);
});

it('parses custom pricing env vars', () => {
  setTestEnv({
    WALLET_AUTH_TOKEN_SECRET: 'test-wallet-auth-secret',
    X402_RATE_PER_GB_MONTH_USD: '0.10',
    X402_MIN_PRICE_USD: '0.002',
    X402_MAX_PRICE_USD: '25.0',
    X402_DEFAULT_DURATION_MONTHS: '6',
    X402_MAX_DURATION_MONTHS: '12'
  });

  const config = getConfig();
  expect(config.x402RatePerGbMonthUsd).toBe(0.10);
  expect(config.x402MinPriceUsd).toBe(0.002);
  expect(config.x402MaxPriceUsd).toBe(25.0);
  expect(config.x402DefaultDurationMonths).toBe(6);
  expect(config.x402MaxDurationMonths).toBe(12);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/config.test.ts`
Expected: FAIL — properties do not exist on `AppConfig`

- [ ] **Step 3: Update `AppConfig` and `getConfig()` in `src/config.ts`**

Replace the three old fields in the `AppConfig` interface:

```typescript
// Remove these:
//   x402BasePriceUsd: number;
//   x402PricePerMbUsd: number;
//   x402MaxPriceUsd: number;
// Add these:
  x402RatePerGbMonthUsd: number;
  x402MinPriceUsd: number;
  x402MaxPriceUsd: number;
  x402DefaultDurationMonths: number;
  x402MaxDurationMonths: number;
```

Also add a `parsePositiveInteger` helper to `config.ts` (the existing `parseNumber` accepts floats, but duration must be an integer):

```typescript
function parsePositiveInteger(value: string | undefined, fallback: number, fieldName: string): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return parsed;
}
```

In `getConfig()`, replace the three parsing lines (185-187) with:

```typescript
    x402RatePerGbMonthUsd: parseNumber(process.env.X402_RATE_PER_GB_MONTH_USD, 0.05, 'X402_RATE_PER_GB_MONTH_USD'),
    x402MinPriceUsd: parseNumber(process.env.X402_MIN_PRICE_USD, 0.001, 'X402_MIN_PRICE_USD'),
    x402MaxPriceUsd: parseNumber(process.env.X402_MAX_PRICE_USD, 50.0, 'X402_MAX_PRICE_USD'),
    x402DefaultDurationMonths: parsePositiveInteger(process.env.X402_DEFAULT_DURATION_MONTHS, 1, 'X402_DEFAULT_DURATION_MONTHS'),
    x402MaxDurationMonths: parsePositiveInteger(process.env.X402_MAX_DURATION_MONTHS, 24, 'X402_MAX_DURATION_MONTHS'),
```

- [ ] **Step 4: Add `expires_at` to `StoredPinRecord` in `src/types.ts`**

```typescript
export interface StoredPinRecord {
  requestid: string;
  cid: string;
  name: string | null;
  status: PinStatusValue;
  origins: string[];
  meta: Record<string, string>;
  delegates: string[];
  info: Record<string, unknown>;
  owner: string;
  created: string;
  updated: string;
  expires_at: string | null;
}
```

- [ ] **Step 5: Run tests to verify config tests pass**

Run: `pnpm vitest run tests/unit/config.test.ts`
Expected: PASS

Note: Other tests will break because the old config fields are gone. That's expected — they'll be fixed in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/types.ts tests/unit/config.test.ts
git commit -m "feat: replace pricing config with linear rate + duration env vars (#9)"
```

---

### Task 2: Update schema to add `expires_at` column

**Files:**
- Modify: `src/db.ts:1-39`

- [ ] **Step 1: Add `expires_at` column and index to `src/db.ts`**

Add after the existing `CREATE INDEX` statements (before the closing backtick):

```sql
    ALTER TABLE pins ADD COLUMN expires_at TEXT;
```

But `ALTER TABLE ... ADD COLUMN` errors if the column already exists. Since SQLite doesn't have `ADD COLUMN IF NOT EXISTS`, use a safe migration approach. Add this after the `db.exec(...)` block:

```typescript
  // Migration: add expires_at column if missing
  const columns = db.pragma('table_info(pins)') as Array<{ name: string }>;
  if (!columns.some((col) => col.name === 'expires_at')) {
    db.exec('ALTER TABLE pins ADD COLUMN expires_at TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_pins_expires_at ON pins(expires_at)');
```

- [ ] **Step 2: Run existing tests to verify schema change doesn't break anything**

Run: `pnpm vitest run tests/unit/pinning-service.test.ts`
Expected: May fail due to `StoredPinRecord` now requiring `expires_at`. Proceed to fix in next task.

- [ ] **Step 3: Commit**

```bash
git add src/db.ts
git commit -m "feat: add expires_at column to pins table (#9)"
```

---

### Task 3: Update repository to persist and query `expires_at`

**Files:**
- Modify: `src/repositories/pin-repository.ts:1-323`

- [ ] **Step 1: Update `DbPinRow` interface**

Add `expires_at` field:

```typescript
interface DbPinRow {
  requestid: string;
  cid: string;
  name: string | null;
  status: PinStatusValue;
  origins: string;
  meta: string;
  delegates: string;
  info: string;
  owner: string;
  created: string;
  updated: string;
  expires_at: string | null;
}
```

- [ ] **Step 2: Update `create()` SQL to include `expires_at`**

```typescript
  create(record: StoredPinRecord): void {
    const statement = this.db.prepare(`
      INSERT INTO pins (
        requestid, cid, name, status, origins, meta, delegates, info, owner, created, updated, expires_at
      ) VALUES (
        @requestid, @cid, @name, @status, @origins, @meta, @delegates, @info, @owner, @created, @updated, @expires_at
      )
    `);

    statement.run({
      ...record,
      origins: JSON.stringify(record.origins),
      meta: JSON.stringify(record.meta),
      delegates: JSON.stringify(record.delegates),
      info: JSON.stringify(record.info)
    });
  }
```

- [ ] **Step 3: Update `update()` SQL to include `expires_at`**

Add `expires_at = @expires_at` to the SET clause:

```typescript
    const statement = this.db.prepare(`
      UPDATE pins
      SET cid = @cid,
          name = @name,
          status = @status,
          origins = @origins,
          meta = @meta,
          delegates = @delegates,
          info = @info,
          owner = @owner,
          created = @created,
          updated = @updated,
          expires_at = @expires_at
      WHERE requestid = @requestid
    `);
```

- [ ] **Step 4: Update all SELECT queries to include `expires_at`**

In `findByRequestId`, `findLatestByCid`, `findLatestByCidAndOwner`, and `list` — add `expires_at` to every SELECT column list. For example:

```sql
SELECT requestid, cid, name, status, origins, meta, delegates, info, owner, created, updated, expires_at FROM pins WHERE ...
```

- [ ] **Step 5: Update `mapRow()` to include `expires_at`**

```typescript
  private mapRow(row: DbPinRow): StoredPinRecord {
    return {
      requestid: row.requestid,
      cid: row.cid,
      name: row.name,
      status: row.status,
      origins: JSON.parse(row.origins) as string[],
      meta: JSON.parse(row.meta) as Record<string, string>,
      delegates: JSON.parse(row.delegates) as string[],
      info: JSON.parse(row.info) as Record<string, unknown>,
      owner: row.owner,
      created: row.created,
      updated: row.updated,
      expires_at: row.expires_at
    };
  }
```

- [ ] **Step 6: Add `findExpired(limit)` method**

```typescript
  findExpired(limit: number, now: string): StoredPinRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT requestid, cid, name, status, origins, meta, delegates, info, owner, created, updated, expires_at
          FROM pins
          WHERE expires_at IS NOT NULL AND expires_at <= ? AND status IN ('pinned', 'failed')
          ORDER BY expires_at ASC
          LIMIT ?
        `
      )
      .all(now, limit) as DbPinRow[];

    return rows.map((row) => this.mapRow(row));
  }
```

- [ ] **Step 7: Add `countActivePinsForCid(cid, now)` method**

```typescript
  countActivePinsForCid(cid: string, now: string): number {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) as count
          FROM pins
          WHERE cid = ? AND (expires_at IS NULL OR expires_at > ?)
        `
      )
      .get(cid, now) as { count: number };

    return row.count;
  }
```

- [ ] **Step 8: Add `deleteCidOwnerIfOrphaned(cid)` method**

```typescript
  deleteCidOwnerIfOrphaned(cid: string): void {
    const pinCount = this.db
      .prepare('SELECT COUNT(*) as count FROM pins WHERE cid = ?')
      .get(cid) as { count: number };

    if (pinCount.count === 0) {
      this.db.prepare('DELETE FROM cid_owners WHERE cid = ?').run(cid);
    }
  }
```

- [ ] **Step 9: Run pinning-service tests to check compatibility**

Run: `pnpm vitest run tests/unit/pinning-service.test.ts`
Expected: May still fail because `PinningService.createPin` doesn't set `expires_at` yet. That's the next task.

- [ ] **Step 10: Commit**

```bash
git add src/repositories/pin-repository.ts
git commit -m "feat: persist expires_at, add findExpired and CID safety queries (#9)"
```

---

### Task 4: New pricing formula with duration

**Files:**
- Modify: `src/services/x402.ts:142-154`
- Test: `tests/unit/x402.test.ts`

- [ ] **Step 1: Write failing tests for new pricing formula**

Replace the existing `calculates size-based pricing` test and add new cases in `tests/unit/x402.test.ts`:

First, update `testConfig` to use the new fields:

```typescript
const testConfig: X402PaymentConfig = {
  facilitatorUrl: 'http://localhost:9999',
  network: 'eip155:167000',
  payTo: '0x1111111111111111111111111111111111111111',
  usdcAssetAddress: '0x2222222222222222222222222222222222222222',
  usdcAssetDecimals: 6,
  usdcDomainName: 'USD Coin',
  usdcDomainVersion: '2',
  ratePerGbMonthUsd: 0.05,
  minPriceUsd: 0.001,
  maxPriceUsd: 50.0,
  defaultDurationMonths: 1,
  maxDurationMonths: 24
};
```

Then replace the pricing test:

```typescript
describe('calculatePriceUsd', () => {
  const pricingConfig = {
    ratePerGbMonthUsd: 0.05,
    minPriceUsd: 0.001,
    maxPriceUsd: 50.0
  };

  it('returns the floor for tiny files', () => {
    expect(calculatePriceUsd(1024, 1, pricingConfig)).toBe(0.001);
    expect(calculatePriceUsd(1_000_000, 1, pricingConfig)).toBe(0.001);
    expect(calculatePriceUsd(1_000_000, 6, pricingConfig)).toBe(0.001);
  });

  it('prices linearly by size and duration', () => {
    const oneGb = 1_073_741_824;
    // 1 GB * $0.05/GB/month * 1 month = $0.05
    expect(calculatePriceUsd(oneGb, 1, pricingConfig)).toBeCloseTo(0.05, 6);
    // 1 GB * $0.05 * 6 months = $0.30
    expect(calculatePriceUsd(oneGb, 6, pricingConfig)).toBeCloseTo(0.30, 6);
    // 1 GB * $0.05 * 12 months = $0.60
    expect(calculatePriceUsd(oneGb, 12, pricingConfig)).toBeCloseTo(0.60, 6);
  });

  it('prices 100 MB correctly', () => {
    const hundredMb = 100 * 1_000_000;
    // ~0.0931 GB * $0.05 * 1 month = ~$0.00466
    expect(calculatePriceUsd(hundredMb, 1, pricingConfig)).toBeCloseTo(0.00466, 4);
    // ~0.0931 GB * $0.05 * 6 months = ~$0.028
    expect(calculatePriceUsd(hundredMb, 6, pricingConfig)).toBeCloseTo(0.028, 3);
  });

  it('caps at max price', () => {
    const tenGb = 10 * 1_073_741_824;
    // 10 GB * $0.05 * 24 months = $12.00 — under $50 cap
    expect(calculatePriceUsd(tenGb, 24, pricingConfig)).toBeCloseTo(12.0, 2);

    const lowCap = { ...pricingConfig, maxPriceUsd: 5.0 };
    expect(calculatePriceUsd(tenGb, 24, lowCap)).toBe(5.0);
  });

  it('returns zero-byte files at min price', () => {
    expect(calculatePriceUsd(0, 1, pricingConfig)).toBe(0.001);
    expect(calculatePriceUsd(0, 12, pricingConfig)).toBe(0.001);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/x402.test.ts`
Expected: FAIL — `calculatePriceUsd` has wrong signature

- [ ] **Step 3: Update `X402PaymentConfig` interface**

In `src/services/x402.ts`, replace the old pricing fields:

```typescript
export interface X402PaymentConfig {
  facilitatorUrl: string;
  network: `${string}:${string}`;
  payTo: string;
  usdcAssetAddress: string;
  usdcAssetDecimals: number;
  usdcDomainName: string;
  usdcDomainVersion: string;
  ratePerGbMonthUsd: number;
  minPriceUsd: number;
  maxPriceUsd: number;
  defaultDurationMonths: number;
  maxDurationMonths: number;
}
```

- [ ] **Step 4: Implement new `calculatePriceUsd`**

Replace the existing function:

```typescript
export function calculatePriceUsd(
  sizeBytes: number,
  durationMonths: number,
  config: Pick<X402PaymentConfig, 'ratePerGbMonthUsd' | 'minPriceUsd' | 'maxPriceUsd'>
): number {
  const fileSizeGb = sizeBytes / 1_073_741_824;
  const computed = fileSizeGb * config.ratePerGbMonthUsd * durationMonths;
  return Math.min(Math.max(computed, config.minPriceUsd), config.maxPriceUsd);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/x402.test.ts`
Expected: The `calculatePriceUsd` tests pass. The middleware tests may still fail due to config shape changes — fixed in next step.

- [ ] **Step 6: Commit**

```bash
git add src/services/x402.ts tests/unit/x402.test.ts
git commit -m "feat: linear pricing formula by size and duration (#9)"
```

---

### Task 5: Update x402 middleware for duration header and 402 body

**Files:**
- Modify: `src/services/x402.ts` (routes config, duration parsing, 402 body, retrieval fallback)
- Test: `tests/unit/x402.test.ts`

- [ ] **Step 1: Add exported `parseDurationMonths` helper**

In `src/services/x402.ts`, add after the existing `parsePositiveInteger`. Export it so `app.ts` can reuse it (avoids duplicate parsing logic):

```typescript
export function parseDurationMonths(raw: string | null | undefined, defaultDuration: number, maxDuration: number): number {
  if (!raw) {
    return defaultDuration;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maxDuration) {
    return defaultDuration;
  }

  return value;
}
```

Then add a private wrapper for the x402 middleware context:

```typescript
function resolveDurationMonths(context: HTTPRequestContext, config: Pick<X402PaymentConfig, 'defaultDurationMonths' | 'maxDurationMonths'>): number {
  return parseDurationMonths(context.adapter.getHeader('x-pin-duration-months'), config.defaultDurationMonths, config.maxDurationMonths);
}
```

- [ ] **Step 2: Update `POST /pins` route price resolver to use duration**

In the routes config inside `createX402PaymentMiddleware`, update the `POST /pins` price function:

```typescript
    'POST /pins': {
      accepts: {
        scheme: 'exact',
        network: config.network,
        payTo: config.payTo,
        extra: exactTransferExtra,
        price: async (context: HTTPRequestContext) => {
          const sizeBytes = await resolvePinRequestSizeBytes(context);
          const durationMonths = resolveDurationMonths(context, config);
          const usdPrice = calculatePriceUsd(sizeBytes, durationMonths, config);
          return usdToAssetAmount(usdPrice, config.usdcAssetAddress, config.usdcAssetDecimals);
        }
      },
      // ...rest stays the same
```

- [ ] **Step 3: Update `POST /upload` route price resolver to use duration=1**

```typescript
    'POST /upload': {
      accepts: {
        scheme: 'exact',
        network: config.network,
        payTo: config.payTo,
        extra: exactTransferExtra,
        price: (context: HTTPRequestContext) => {
          const sizeBytes = resolveUploadSizeBytes(context);
          const usdPrice = calculatePriceUsd(sizeBytes, 1, config);
          return usdToAssetAmount(usdPrice, config.usdcAssetAddress, config.usdcAssetDecimals);
        }
      },
      // ...rest stays the same
```

- [ ] **Step 4: Update the unpaid response body to include pricing info**

Update `makeUnpaidResponseBody` to accept config and duration:

```typescript
function makeUnpaidResponseBody(description: string, config?: Pick<X402PaymentConfig, 'ratePerGbMonthUsd' | 'minPriceUsd' | 'defaultDurationMonths'>) {
  return () => ({
    contentType: 'application/json' as const,
    body: {
      error: 'Payment required',
      description,
      ...(config ? {
        pricing: {
          ratePerGbMonthUsd: config.ratePerGbMonthUsd,
          durationMonths: config.defaultDurationMonths,
          minPriceUsd: config.minPriceUsd
        }
      } : {}),
      protocol: buildProtocolInfo(),
      client: buildRecommendedClientInfo(),
      note: 'Decode the base64 Payment-Required response header for full payment requirements. If your payment fails, the error reason is in that same header.'
    }
  });
}
```

Then in the routes config, pass config to the pins route:

```typescript
unpaidResponseBody: makeUnpaidResponseBody('Pin a CID to IPFS.', config),
```

And for upload:

```typescript
unpaidResponseBody: makeUnpaidResponseBody('Upload content to IPFS and pin it.'),
```

- [ ] **Step 5: Fix retrieval price fallback**

In the retrieval route price resolver (around line 771), change:

```typescript
const usdPrice = requirement?.priceUsd ?? config.minPriceUsd;
```

(Was `config.basePriceUsd` which no longer exists.)

- [ ] **Step 6: Add `parseDurationMonths` unit tests**

```typescript
describe('parseDurationMonths', () => {
  it('returns default when header is missing', () => {
    expect(parseDurationMonths(null, 1, 24)).toBe(1);
    expect(parseDurationMonths(undefined, 6, 24)).toBe(6);
    expect(parseDurationMonths('', 1, 24)).toBe(1);
  });

  it('parses valid integer values', () => {
    expect(parseDurationMonths('1', 1, 24)).toBe(1);
    expect(parseDurationMonths('12', 1, 24)).toBe(12);
    expect(parseDurationMonths('24', 1, 24)).toBe(24);
  });

  it('falls back to default for invalid values', () => {
    expect(parseDurationMonths('0', 1, 24)).toBe(1);
    expect(parseDurationMonths('-1', 1, 24)).toBe(1);
    expect(parseDurationMonths('25', 1, 24)).toBe(1);
    expect(parseDurationMonths('1.5', 1, 24)).toBe(1);
    expect(parseDurationMonths('abc', 1, 24)).toBe(1);
  });
});
```

- [ ] **Step 7: Update middleware test config and add 402 body assertion (renumbered)**

In `tests/unit/x402.test.ts`, the `testConfig` was already updated in Task 4. Update the middleware test to check for pricing info in the 402 body:

```typescript
  it('returns 402 when payment proof is missing and allows paid requests', async () => {
    // ... existing test setup ...

    const unpaidBody = (await unpaid.json()) as {
      error: string;
      pricing: { ratePerGbMonthUsd: number; durationMonths: number; minPriceUsd: number };
      protocol: { spec: string };
      client: { package: string };
    };
    expect(unpaidBody.error).toBe('Payment required');
    expect(unpaidBody.pricing.ratePerGbMonthUsd).toBe(0.05);
    expect(unpaidBody.pricing.durationMonths).toBe(1);
    expect(unpaidBody.pricing.minPriceUsd).toBe(0.001);
    // ... rest of paid flow test ...
  });
```

- [ ] **Step 7: Run all x402 tests**

Run: `pnpm vitest run tests/unit/x402.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/services/x402.ts tests/unit/x402.test.ts
git commit -m "feat: duration header parsing, pricing in 402 body, fix retrieval fallback (#9)"
```

---

### Task 6: Compute `expires_at` on pin creation and expose in service

**Files:**
- Modify: `src/services/pinning-service.ts`
- Test: `tests/unit/pinning-service.test.ts`

- [ ] **Step 1: Write failing tests for `expires_at` on create**

Add to `tests/unit/pinning-service.test.ts`:

```typescript
  it('sets expires_at when durationMonths is provided', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:00:00.000Z'));

    const result = await service.createPin({ cid: 'bafy-expiry', owner: wallet, durationMonths: 3 });

    expect(result.expires_at).toBe('2026-06-19T12:00:00.000Z');
    expect(result.status).toBe('pinned');
  });

  it('leaves expires_at null when called without durationMonths (internal/legacy path)', async () => {
    const result = await service.createPin({ cid: 'bafy-no-expiry', owner: wallet });

    expect(result.expires_at).toBeNull();
  });

  it('inherits expires_at when replacing a pin', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:00:00.000Z'));

    const created = await service.createPin({ cid: 'bafy-original', owner: wallet, durationMonths: 6 });
    expect(created.expires_at).toBe('2026-09-19T12:00:00.000Z');

    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    const replaced = await service.replacePin(created.requestid, { cid: 'bafy-replacement' }, wallet);

    expect(replaced.expires_at).toBe('2026-09-19T12:00:00.000Z');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/pinning-service.test.ts`
Expected: FAIL — `durationMonths` not in `CreatePinInput`

- [ ] **Step 3: Update `CreatePinInput` and `createPin`**

In `src/services/pinning-service.ts`:

Add to `CreatePinInput`:

```typescript
export interface CreatePinInput {
  cid: string;
  name?: string;
  origins?: string[];
  meta?: Record<string, string>;
  owner: string;
  durationMonths?: number;
}
```

Add a helper to compute `expires_at`.

**Note:** JavaScript's `setUTCMonth` overflows at month boundaries (e.g., Jan 31 + 1 month = Mar 3). We clamp the day to avoid this:

```typescript
function computeExpiresAt(durationMonths: number | undefined): string | null {
  if (durationMonths === undefined || durationMonths <= 0) {
    return null;
  }

  const now = new Date();
  const targetYear = now.getUTCFullYear();
  const targetMonth = now.getUTCMonth() + durationMonths;
  // Clamp day to last day of target month to avoid overflow (e.g., Jan 31 + 1mo = Feb 28)
  const maxDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(now.getUTCDate(), maxDay);

  const target = new Date(Date.UTC(
    targetYear,
    targetMonth,
    clampedDay,
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds()
  ));
  return target.toISOString();
}
```

Update `createPin` to set `expires_at` on the record:

```typescript
  async createPin(input: CreatePinInput): Promise<StoredPinRecord> {
    const now = new Date().toISOString();

    const record: StoredPinRecord = {
      requestid: randomUUID(),
      cid: input.cid,
      name: input.name ?? null,
      status: 'pinning',
      origins: input.origins ?? [],
      meta: input.meta ?? {},
      delegates: this.delegates,
      info: {},
      owner: input.owner,
      created: now,
      updated: now,
      expires_at: computeExpiresAt(input.durationMonths)
    };
    // ... rest unchanged
```

Update `replacePin` to carry `expires_at` from the existing record:

```typescript
    const next: StoredPinRecord = {
      ...existing,
      cid: input.cid,
      name: input.name ?? null,
      origins: input.origins ?? [],
      meta: input.meta ?? {},
      status: 'pinning',
      info: {},
      updated: new Date().toISOString(),
      expires_at: existing.expires_at  // inherit
    };
```

Also update the `failed` fallback records in `createPin` and `replacePin` to include `expires_at`:

In `createPin` catch block, the spread `...record` already includes `expires_at`. Same for `replacePin` with `...next`. Verify this is the case.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/pinning-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/pinning-service.ts tests/unit/pinning-service.test.ts
git commit -m "feat: compute expires_at on pin creation, inherit on replace (#9)"
```

---

### Task 7: Implement expiry sweep

**Files:**
- Modify: `src/services/pinning-service.ts`
- Test: `tests/unit/pinning-service.test.ts`

- [ ] **Step 1: Write failing tests for sweep**

Add to `tests/unit/pinning-service.test.ts`:

```typescript
  it('sweeps expired pins: unpin, delete record, evict cache', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

    const created = await service.createPin({ cid: 'bafy-sweep', owner: wallet, durationMonths: 1 });
    expect(created.status).toBe('pinned');

    // Advance past expiry
    vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));

    const result = await service.sweepExpiredPins();

    expect(result.expiredCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(ipfsClient.pinRm).toHaveBeenCalledWith('bafy-sweep');
    expect(() => service.getPin(created.requestid, wallet)).toThrow('not found');
  });

  it('skips Kubo unpin when another active pin shares the CID', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

    await service.createPin({ cid: 'bafy-shared', owner: wallet, durationMonths: 1 });
    await service.createPin({ cid: 'bafy-shared', owner: otherWallet, durationMonths: 12 });

    // Advance past first pin's expiry but not second
    vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));
    ipfsClient.pinRm.mockClear();

    const result = await service.sweepExpiredPins();

    expect(result.expiredCount).toBe(1);
    expect(result.skippedUnpinCount).toBe(1);
    expect(ipfsClient.pinRm).not.toHaveBeenCalled();
  });

  it('does not sweep pins with null expires_at', async () => {
    await service.createPin({ cid: 'bafy-legacy', owner: wallet });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-01-01T00:00:00.000Z'));

    const result = await service.sweepExpiredPins();
    expect(result.expiredCount).toBe(0);
  });

  it('cleans up orphaned cid_owners after sweep', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

    await service.createPin({ cid: 'bafy-orphan', owner: wallet, durationMonths: 1 });

    vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));
    await service.sweepExpiredPins();

    const cidOwner = db
      .prepare('SELECT * FROM cid_owners WHERE cid = ?')
      .get('bafy-orphan');
    expect(cidOwner).toBeUndefined();
  });

  it('evicts content cache when sweeping expired pins', async () => {
    const contentCache = new GatewayContentCache(10 * 1024 * 1024);
    service = new PinningService(repository, ipfsClient, 'http://localhost:8080/ipfs', { contentCache });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

    await service.createPin({ cid: 'bafy-cache-evict', owner: wallet, durationMonths: 1 });
    // Seed the cache
    contentCache.set({ cid: 'bafy-cache-evict', content: new ArrayBuffer(4), contentType: 'text/plain', filename: null, size: 4 });
    expect(contentCache.get('bafy-cache-evict')).toBeTruthy();

    vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));
    await service.sweepExpiredPins();

    expect(contentCache.get('bafy-cache-evict')).toBeUndefined();
  });

  it('retries next cycle when Kubo unpin fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

    const created = await service.createPin({ cid: 'bafy-retry', owner: wallet, durationMonths: 1 });

    vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));
    ipfsClient.pinRm.mockRejectedValueOnce(new Error('kubo down'));

    const firstSweep = await service.sweepExpiredPins();
    expect(firstSweep.failedCount).toBe(1);
    expect(firstSweep.expiredCount).toBe(0);
    // Record still exists
    expect(service.getPin(created.requestid, wallet)).toBeTruthy();

    // Next sweep succeeds
    ipfsClient.pinRm.mockResolvedValueOnce(undefined);
    const secondSweep = await service.sweepExpiredPins();
    expect(secondSweep.expiredCount).toBe(1);
    expect(() => service.getPin(created.requestid, wallet)).toThrow('not found');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/pinning-service.test.ts`
Expected: FAIL — `sweepExpiredPins` does not exist

- [ ] **Step 3: Implement `sweepExpiredPins`**

Add to `PinningService`:

```typescript
  async sweepExpiredPins(batchSize = 50): Promise<{ expiredCount: number; failedCount: number; skippedUnpinCount: number }> {
    const now = new Date().toISOString();
    const expired = this.repository.findExpired(batchSize, now);

    let expiredCount = 0;
    let failedCount = 0;
    let skippedUnpinCount = 0;

    for (const pin of expired) {
      const activeCount = this.repository.countActivePinsForCid(pin.cid, now);
      // activeCount includes pins that haven't expired yet (or have null expires_at).
      // We need to exclude the current pin from the count — but since it IS expired,
      // countActivePinsForCid won't include it (it only counts expires_at > now or NULL).
      const shouldUnpin = activeCount === 0;

      if (shouldUnpin) {
        try {
          await this.ipfsClient.pinRm(pin.cid);
          await this.unpinOnReplicas(pin.cid);
        } catch {
          failedCount++;
          continue;
        }
      } else {
        skippedUnpinCount++;
      }

      this.repository.delete(pin.requestid);
      this.repository.deleteCidOwnerIfOrphaned(pin.cid);

      if (shouldUnpin) {
        this.contentCache?.delete(pin.cid);
      }

      expiredCount++;
    }

    return { expiredCount, failedCount, skippedUnpinCount };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/pinning-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/pinning-service.ts tests/unit/pinning-service.test.ts
git commit -m "feat: implement expiry sweep with CID safety check (#9)"
```

---

### Task 8: Update app routes, agent card, and integration tests

**Files:**
- Modify: `src/app.ts`
- Modify: `src/index.ts`
- Test: `tests/integration/app.test.ts`

- [ ] **Step 1: Update `POST /pins` handler to pass duration**

In `src/app.ts`, update the `POST /pins` handler to parse duration and pass it to the service:

```typescript
  app.post('/pins', async (c) => {
    const body = parsePinPayload(await parseJsonBody(c));
    const paidWallet = requirePaidWallet(c.req.raw.headers);
    issueWalletAuthToken(c, paidWallet, services.walletAuth);

    const durationMonths = parseDurationMonths(c.req.raw.headers.get('x-pin-duration-months'), services.defaultDurationMonths ?? 1, services.maxDurationMonths ?? 24);
    const result = await services.pinningService.createPin({
      ...body,
      owner: paidWallet,
      durationMonths
    });
    return c.json(toPinStatusResponse(result), 202);
  });
```

Import `parseDurationMonths` from `x402.ts` (reuse, no duplicate logic):

```typescript
import {
  // ... existing imports
  parseDurationMonths,
} from './services/x402';
```

Add to `AppServices`:

```typescript
export interface AppServices {
  // ... existing fields
  defaultDurationMonths?: number;
  maxDurationMonths?: number;
}
```

- [ ] **Step 2: Surface `expiresAt` in `toPinStatusResponse`**

In `src/services/pinning-service.ts`, update `toPinStatusResponse`:

```typescript
export function toPinStatusResponse(record: StoredPinRecord): PinStatusResponse {
  return {
    requestid: record.requestid,
    status: record.status,
    created: record.created,
    pin: {
      cid: record.cid,
      name: record.name ?? undefined,
      origins: record.origins,
      meta: record.meta
    },
    delegates: record.delegates,
    info: {
      ...record.info,
      ...(record.expires_at ? { expiresAt: record.expires_at } : {})
    }
  };
}
```

- [ ] **Step 3: Update `AgentCardConfig` and agent card response**

In `src/app.ts`, update the `AgentCardConfig` interface:

```typescript
export interface AgentCardConfig {
  name: string;
  description: string;
  version: string;
  x402Network: string;
  x402UsdcAssetAddress: string;
  x402RatePerGbMonthUsd: number;
  x402MinPriceUsd: number;
  x402DefaultDurationMonths: number;
  x402MaxDurationMonths: number;
}
```

Update the agent card route pricing section:

```typescript
      pricing: {
        pinning: {
          protocol: 'x402',
          spec: X402_SPEC_URL,
          clientSdk: '@x402/fetch',
          paymentHeader: 'Payment-Signature',
          network: agent?.x402Network,
          asset: agent?.x402UsdcAssetAddress,
          ratePerGbMonthUsd: agent?.x402RatePerGbMonthUsd,
          minPriceUsd: agent?.x402MinPriceUsd,
          defaultDurationMonths: agent?.x402DefaultDurationMonths,
          maxDurationMonths: agent?.x402MaxDurationMonths,
          durationHeader: 'X-Pin-Duration-Months'
        },
        retrieval: {
          protocol: 'x402-optional',
          metadataField: 'meta.retrievalPrice',
          settlement: 'owner-wallet'
        }
      },
```

- [ ] **Step 4: Update `src/index.ts` wiring**

Update the payment config to use new fields:

```typescript
const paymentMiddleware = createX402PaymentMiddleware({
  facilitatorUrl: config.x402FacilitatorUrl,
  network: config.x402Network as `${string}:${string}`,
  payTo: config.x402PayTo,
  usdcAssetAddress: config.x402UsdcAssetAddress,
  usdcAssetDecimals: config.x402UsdcAssetDecimals,
  usdcDomainName: config.x402UsdcDomainName,
  usdcDomainVersion: config.x402UsdcDomainVersion,
  ratePerGbMonthUsd: config.x402RatePerGbMonthUsd,
  minPriceUsd: config.x402MinPriceUsd,
  maxPriceUsd: config.x402MaxPriceUsd,
  defaultDurationMonths: config.x402DefaultDurationMonths,
  maxDurationMonths: config.x402MaxDurationMonths
}, /* ... */);
```

Update the app creation to pass duration config:

```typescript
const app = createApp({
  // ... existing fields
  defaultDurationMonths: config.x402DefaultDurationMonths,
  maxDurationMonths: config.x402MaxDurationMonths,
  agentCard: {
    name: 'Tack',
    description: 'Pin to IPFS, pay with your wallet. No account needed.',
    version: appVersion,
    x402Network: config.x402Network,
    x402UsdcAssetAddress: config.x402UsdcAssetAddress,
    x402RatePerGbMonthUsd: config.x402RatePerGbMonthUsd,
    x402MinPriceUsd: config.x402MinPriceUsd,
    x402DefaultDurationMonths: config.x402DefaultDurationMonths,
    x402MaxDurationMonths: config.x402MaxDurationMonths
  }
});
```

- [ ] **Step 5: Update integration test `paymentConfig` and add duration test**

In `tests/integration/app.test.ts`, update `paymentConfig`:

```typescript
const paymentConfig: X402PaymentConfig = {
  facilitatorUrl: 'http://localhost:9999',
  network: 'eip155:167000',
  payTo: '0x1111111111111111111111111111111111111111',
  usdcAssetAddress: '0x2222222222222222222222222222222222222222',
  usdcAssetDecimals: 6,
  usdcDomainName: 'USD Coin',
  usdcDomainVersion: '2',
  ratePerGbMonthUsd: 0.05,
  minPriceUsd: 0.001,
  maxPriceUsd: 50.0,
  defaultDurationMonths: 1,
  maxDurationMonths: 24
};
```

Update `buildApp` to pass duration config:

```typescript
  const buildApp = (overrides?: Partial<Parameters<typeof createApp>[0]>): ReturnType<typeof createApp> => {
    // ... existing middleware setup ...
    return createApp({
      pinningService: service,
      paymentMiddleware,
      walletAuth: walletAuthConfig,
      defaultDurationMonths: 1,
      maxDurationMonths: 24,
      ...overrides
    });
  };
```

Add integration test:

```typescript
  it('creates a pin with X-Pin-Duration-Months and includes expiresAt in response', async () => {
    const createRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pin-duration-months': '6'
      },
      body: JSON.stringify({ cid: 'bafy-duration', name: 'test-duration' })
    }));

    expect(createRes.status).toBe(202);
    const created = (await createRes.json()) as {
      requestid: string;
      info: { expiresAt?: string };
    };
    expect(created.info.expiresAt).toBeTruthy();

    // Verify the expiry is approximately 6 months from now
    const expiresAt = new Date(created.info.expiresAt!);
    const now = new Date();
    const diffMonths = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
    expect(diffMonths).toBeGreaterThan(5);
    expect(diffMonths).toBeLessThan(7);
  });

  it('uses default duration when X-Pin-Duration-Months header is missing', async () => {
    const createRes = await paidRequest(app, 'http://localhost/pins', walletA, () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid: 'bafy-default-duration' })
    }));

    expect(createRes.status).toBe(202);
    const created = (await createRes.json()) as {
      info: { expiresAt?: string };
    };
    expect(created.info.expiresAt).toBeTruthy();

    const expiresAt = new Date(created.info.expiresAt!);
    const now = new Date();
    const diffMonths = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
    expect(diffMonths).toBeGreaterThan(0.5);
    expect(diffMonths).toBeLessThan(1.5);
  });

  it('returns updated agent card with new pricing fields', async () => {
    const agentCardApp = buildApp({
      agentCard: {
        name: 'Tack',
        description: 'Test agent',
        version: '0.0.1',
        x402Network: 'eip155:167000',
        x402UsdcAssetAddress: '0x2222222222222222222222222222222222222222',
        x402RatePerGbMonthUsd: 0.05,
        x402MinPriceUsd: 0.001,
        x402DefaultDurationMonths: 1,
        x402MaxDurationMonths: 24
      }
    });

    const response = await agentCardApp.request('http://localhost/.well-known/agent.json');
    expect(response.status).toBe(200);

    const card = (await response.json()) as {
      pricing: {
        pinning: {
          ratePerGbMonthUsd: number;
          minPriceUsd: number;
          defaultDurationMonths: number;
          maxDurationMonths: number;
          durationHeader: string;
        };
      };
    };

    expect(card.pricing.pinning.ratePerGbMonthUsd).toBe(0.05);
    expect(card.pricing.pinning.minPriceUsd).toBe(0.001);
    expect(card.pricing.pinning.defaultDurationMonths).toBe(1);
    expect(card.pricing.pinning.maxDurationMonths).toBe(24);
    expect(card.pricing.pinning.durationHeader).toBe('X-Pin-Duration-Months');
  });
```

- [ ] **Step 6: Run all tests**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/index.ts src/services/pinning-service.ts tests/integration/app.test.ts
git commit -m "feat: wire duration through routes, agent card, and integration tests (#9)"
```

---

### Task 9: Wire sweep timer in `index.ts` with shutdown cleanup

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add sweep timer after server starts**

After the `serve(...)` call in `src/index.ts`, add:

```typescript
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const SWEEP_STARTUP_DELAY_MS = 30 * 1000; // 30 seconds

async function runSweep(): Promise<void> {
  const startTime = Date.now();
  try {
    const result = await pinningService.sweepExpiredPins();
    if (result.expiredCount > 0 || result.failedCount > 0) {
      logger.info({ ...result, durationMs: Date.now() - startTime }, 'expiry sweep completed');
    }
  } catch (error) {
    logger.error({ err: error, durationMs: Date.now() - startTime }, 'expiry sweep failed');
  }
}

const sweepStartupTimer = setTimeout(() => {
  void runSweep();
}, SWEEP_STARTUP_DELAY_MS);
sweepStartupTimer.unref();

const sweepInterval = setInterval(() => {
  void runSweep();
}, SWEEP_INTERVAL_MS);
sweepInterval.unref();
```

- [ ] **Step 2: Clean up timers during shutdown**

Update the `shutdown` function to clear the timers. Add before `server.close(...)`:

```typescript
  clearTimeout(sweepStartupTimer);
  clearInterval(sweepInterval);
```

- [ ] **Step 3: Verify build succeeds**

Run: `pnpm build`
Expected: Compiles with no errors

- [ ] **Step 4: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire in-process expiry sweep timer with shutdown cleanup (#9)"
```

---

### Task 10: Final verification and cleanup

- [ ] **Step 1: Run the full test suite**

Run: `pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run the build**

Run: `pnpm build`
Expected: No TypeScript errors

- [ ] **Step 3: Verify no old config references remain**

Search for removed field names:

Run: `grep -r 'basePriceUsd\|pricePerMbUsd\|pricePerMb\|x402BasePriceUsd\|x402PricePerMbUsd' src/ tests/`
Expected: No matches (only in comments/docs is acceptable)

- [ ] **Step 4: Update `.env.example`**

Replace lines 53-56 in `.env.example` with:

```env
# Pricing for paid endpoints (linear: max(min, sizeGB * rate * durationMonths))
X402_RATE_PER_GB_MONTH_USD=0.05
X402_MIN_PRICE_USD=0.001
X402_MAX_PRICE_USD=50.0
X402_DEFAULT_DURATION_MONTHS=1
X402_MAX_DURATION_MONTHS=24
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup for linear pricing (#9)"
```
