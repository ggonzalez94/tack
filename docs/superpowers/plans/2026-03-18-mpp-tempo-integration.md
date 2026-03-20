# MPP + Tempo Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MPP (Machine Payment Protocol) charge support on Tempo blockchain alongside existing x402 on Taiko, using same endpoints with protocol detection.

**Architecture:** Protocol-detection middleware checks for `Authorization: Payment` (MPP) or `payment-signature` (x402) headers, dispatches to the correct handler, and composes dual-challenge 402 responses when no credential is present. Chain config is in code; each chain declares its protocol.

**Tech Stack:** TypeScript, Hono, mppx (MPP SDK), @x402/core, @x402/hono, viem, vitest

**Spec:** `docs/superpowers/specs/2026-03-18-mpp-tempo-integration-design.md`

---

### Task 1: Install mppx and verify exports

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install mppx**

```bash
pnpm add mppx
```

- [ ] **Step 2: Verify export paths match spec assumptions**

```bash
node -e "
  const server = require('mppx/server');
  console.log('mppx/server exports:', Object.keys(server));
  const core = require('mppx');
  console.log('mppx exports:', Object.keys(core));
"
```

Expected: `Mppx`, `tempo`, `Expires`, `Store` from `mppx/server`; `Credential` from `mppx`. If import paths differ, note the correct ones for all subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add mppx dependency for MPP payment support"
```

---

### Task 2: Payment types and chain config

**Files:**
- Create: `src/services/payment/types.ts`
- Create: `src/services/payment/chains.ts`
- Test: `tests/unit/payment/chains.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/payment/chains.test.ts
import { describe, expect, it } from 'vitest';
import { paymentChains, getChainByName, getChainByProtocol } from '../../../src/services/payment/chains';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/payment/chains.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Create types**

```typescript
// src/services/payment/types.ts
export type PaymentProtocol = 'x402' | 'mpp';

export interface PaymentChain {
  name: string;
  chainId: number;
  protocol: PaymentProtocol;
  rpcUrl: string;
  asset: {
    address: string;
    decimals: number;
    symbol: string;
  };
  x402?: {
    network: string;
    facilitatorUrl: string;
    domainName: string;
    domainVersion: string;
  };
  mpp?: {
    method: string;
    intent: 'charge';
  };
}

export interface PaymentResult {
  wallet: string;
  protocol: PaymentProtocol;
  chainName: string;
  receipt?: string;
}
```

- [ ] **Step 4: Create chains config**

```typescript
// src/services/payment/chains.ts
import type { PaymentChain, PaymentProtocol } from './types.js';

export const paymentChains: PaymentChain[] = [
  {
    name: 'taiko',
    chainId: 167000,
    protocol: 'x402',
    rpcUrl: 'https://rpc.mainnet.taiko.xyz',
    asset: {
      address: process.env.X402_USDC_ASSET_ADDRESS ?? '0x0000000000000000000000000000000000000001',
      decimals: 6,
      symbol: 'USDC',
    },
    x402: {
      network: 'eip155:167000',
      facilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://facilitator.taiko.xyz',
      domainName: 'USD Coin',
      domainVersion: '2',
    },
  },
  {
    name: 'tempo',
    chainId: 4217,
    protocol: 'mpp',
    rpcUrl: 'https://rpc.tempo.xyz',
    asset: {
      address: '0x20C000000000000000000000b9537d11c60E8b50',
      decimals: 6,
      symbol: 'USDC.e',
    },
    mpp: {
      method: 'tempo',
      intent: 'charge',
    },
  },
];

export function getChainByName(name: string): PaymentChain | undefined {
  return paymentChains.find((c) => c.name === name);
}

export function getChainByProtocol(protocol: PaymentProtocol): PaymentChain | undefined {
  return paymentChains.find((c) => c.protocol === protocol);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/payment/chains.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/payment/types.ts src/services/payment/chains.ts tests/unit/payment/chains.test.ts
git commit -m "feat(payment): add payment types and chain config for taiko + tempo"
```

---

### Task 3: Wallet extraction utilities

**Files:**
- Create: `src/services/payment/wallet.ts`
- Test: `tests/unit/payment/wallet.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/payment/wallet.test.ts
import { describe, expect, it } from 'vitest';
import { normalizeAddress, extractWalletFromDid } from '../../../src/services/payment/wallet';

describe('normalizeAddress', () => {
  it('normalizes a valid checksummed address to lowercase', () => {
    expect(normalizeAddress('0xABCDEF1234567890abcdef1234567890ABCDEF12'))
      .toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });

  it('throws on invalid address (too short)', () => {
    expect(() => normalizeAddress('0xabc')).toThrow('Invalid EVM address');
  });

  it('throws on address without 0x prefix', () => {
    expect(() => normalizeAddress('abcdef1234567890abcdef1234567890abcdef12')).toThrow('Invalid EVM address');
  });
});

describe('extractWalletFromDid', () => {
  it('extracts address from valid DID PKH', () => {
    expect(extractWalletFromDid('did:pkh:eip155:4217:0xABCDEF1234567890abcdef1234567890ABCDEF12'))
      .toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });

  it('works with different chain IDs', () => {
    expect(extractWalletFromDid('did:pkh:eip155:1:0x1111111111111111111111111111111111111111'))
      .toBe('0x1111111111111111111111111111111111111111');
  });

  it('throws on invalid DID format (missing parts)', () => {
    expect(() => extractWalletFromDid('did:pkh:eip155')).toThrow('Invalid DID format');
  });

  it('throws on non-DID string', () => {
    expect(() => extractWalletFromDid('not-a-did')).toThrow('Invalid DID format');
  });

  it('throws on DID with invalid address', () => {
    expect(() => extractWalletFromDid('did:pkh:eip155:4217:0xinvalid')).toThrow('Invalid EVM address');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/payment/wallet.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/services/payment/wallet.ts

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/payment/wallet.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/payment/wallet.ts tests/unit/payment/wallet.test.ts
git commit -m "feat(payment): add wallet extraction utilities with DID PKH parsing"
```

---

### Task 4: Extract pricing logic from x402.ts

**Files:**
- Create: `src/services/payment/pricing.ts`
- Modify: `src/services/x402.ts` (import from pricing.ts, re-export for backward compat)
- Test: `tests/unit/payment/pricing.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/payment/pricing.test.ts
import { describe, expect, it } from 'vitest';
import { calculatePriceUsd, usdToAssetAmount } from '../../../src/services/payment/pricing';

describe('calculatePriceUsd', () => {
  const config = { basePriceUsd: 0.001, pricePerMbUsd: 0.001, maxPriceUsd: 0.01 };

  it('returns base price for files <= 1MB', () => {
    expect(calculatePriceUsd(500_000, config)).toBe(0.001);
    expect(calculatePriceUsd(1_000_000, config)).toBe(0.001);
  });

  it('adds per-MB cost for files > 1MB', () => {
    expect(calculatePriceUsd(2_000_001, config)).toBe(0.003); // base + 2 extra MB
  });

  it('caps at max price', () => {
    expect(calculatePriceUsd(100_000_000, config)).toBe(0.01);
  });

  it('returns base price for 0-byte files', () => {
    expect(calculatePriceUsd(0, config)).toBe(0.001);
  });
});

describe('usdToAssetAmount', () => {
  it('converts USD to 6-decimal asset amount', () => {
    const result = usdToAssetAmount(0.001, '0x2222222222222222222222222222222222222222', 6);
    expect(result.amount).toBe('1000');
    expect(result.asset).toBe('0x2222222222222222222222222222222222222222');
  });

  it('returns minimum of 1 for very small amounts', () => {
    const result = usdToAssetAmount(0, '0x2222222222222222222222222222222222222222', 6);
    expect(Number(result.amount)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/payment/pricing.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create pricing.ts by extracting from x402.ts**

Move `calculatePriceUsd` (x402.ts:142-154) and `usdToAssetAmount` (x402.ts:156-164) into a new file:

```typescript
// src/services/payment/pricing.ts
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
```

- [ ] **Step 4: Update x402.ts to import from pricing.ts**

In `src/services/x402.ts`, replace the `calculatePriceUsd` and `usdToAssetAmount` function definitions (lines 142-164) with re-exports:

```typescript
// At top of src/services/x402.ts, add:
import { calculatePriceUsd, usdToAssetAmount } from './payment/pricing.js';
export { calculatePriceUsd } from './payment/pricing.js';
```

Remove the local function bodies (lines 142-164) since they are now imported.

- [ ] **Step 5: Run ALL tests to verify no regressions**

Run: `pnpm vitest run`
Expected: All existing tests PASS + new pricing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/payment/pricing.ts src/services/x402.ts tests/unit/payment/pricing.test.ts
git commit -m "refactor(payment): extract pricing logic from x402 into shared module"
```

---

### Task 5: Extract wallet auth (JWT) from x402.ts

**Files:**
- Create: `src/services/wallet-auth.ts`
- Modify: `src/services/x402.ts` (remove JWT functions, import from wallet-auth.ts)
- Modify: `src/app.ts` (update imports)
- Modify: `src/index.ts` (update imports if needed)
- Test: `tests/unit/wallet-auth.test.ts`

- [ ] **Step 1: Write the failing test for Authorization: Payment disambiguation**

```typescript
// tests/unit/wallet-auth.test.ts
import { describe, expect, it } from 'vitest';
import { getWalletAuthToken } from '../../src/services/wallet-auth';

describe('getWalletAuthToken', () => {
  it('returns null token for Authorization: Payment header (MPP)', () => {
    const headers = new Headers({ 'Authorization': 'Payment eyJjaGFsbGVuZ2Ui...' });
    const result = getWalletAuthToken(headers);
    expect(result.token).toBeNull();
    expect(result.malformed).toBe(false);
  });

  it('returns token for Authorization: Bearer header', () => {
    const headers = new Headers({ 'Authorization': 'Bearer my-jwt-token' });
    const result = getWalletAuthToken(headers);
    expect(result.token).toBe('my-jwt-token');
    expect(result.malformed).toBe(false);
  });

  it('returns malformed for unknown scheme', () => {
    const headers = new Headers({ 'Authorization': 'Basic dXNlcjpwYXNz' });
    const result = getWalletAuthToken(headers);
    expect(result.token).toBeNull();
    expect(result.malformed).toBe(true);
  });

  it('returns token from x-wallet-auth-token header', () => {
    const headers = new Headers({ 'x-wallet-auth-token': 'direct-token' });
    const result = getWalletAuthToken(headers);
    expect(result.token).toBe('direct-token');
    expect(result.malformed).toBe(false);
  });

  it('returns null for no auth headers', () => {
    const headers = new Headers();
    const result = getWalletAuthToken(headers);
    expect(result.token).toBeNull();
    expect(result.malformed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/wallet-auth.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create wallet-auth.ts**

Extract from `src/services/x402.ts`:
- `getWalletAuthToken` (lines 259-288) — **updated with Payment scheme check**
- `verifyWalletAuthToken` (lines 290-392)
- `createWalletAuthToken` (lines 394-427)
- `resolveWalletFromHeaders` (lines 429-447)
- Helper functions: `toBase64Url`, `fromBase64Url`, `normalizeWalletAddress`
- Types: `WalletAuthConfig`, `WalletAuthToken`, `RequestOwnerIdentity`
- Constants: `WALLET_AUTH_TOKEN_RESPONSE_HEADER`, `WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER`, `MAX_WALLET_AUTH_CLOCK_SKEW_SECONDS`

Key change to `getWalletAuthToken`:

```typescript
// Add this check before the Bearer check:
if (trimmed.startsWith('Payment ')) {
  return { token: null, malformed: false };
}
```

- [ ] **Step 4: Update x402.ts to re-export from wallet-auth.ts**

Replace the extracted functions in `src/services/x402.ts` with re-exports:

```typescript
export {
  createWalletAuthToken,
  resolveWalletFromHeaders,
  type WalletAuthConfig,
  type WalletAuthToken,
  type RequestOwnerIdentity,
  WALLET_AUTH_TOKEN_RESPONSE_HEADER,
  WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER,
} from './wallet-auth.js';
```

This preserves backward compatibility for `src/app.ts` and `src/index.ts` which currently import from `./services/x402`.

- [ ] **Step 5: Run ALL tests**

Run: `pnpm vitest run`
Expected: All tests PASS. Existing x402 tests continue to pass because x402.ts re-exports everything.

- [ ] **Step 6: Commit**

```bash
git add src/services/wallet-auth.ts src/services/x402.ts tests/unit/wallet-auth.test.ts
git commit -m "refactor(payment): extract wallet auth JWT logic from x402 with MPP Payment scheme support"
```

---

### Task 6: x402 compatibility layer

**Files:**
- Create: `src/services/payment/x402-compat.ts`
- Test: `tests/unit/payment/x402-compat.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/payment/x402-compat.test.ts
import { describe, expect, it } from 'vitest';
import { buildX402ChallengeHeader } from '../../../src/services/payment/x402-compat';

describe('buildX402ChallengeHeader', () => {
  it('produces valid x402 payment-required JSON', () => {
    const result = buildX402ChallengeHeader('1000', {
      network: 'eip155:167000',
      usdcAssetAddress: '0x2222222222222222222222222222222222222222',
      usdcDomainName: 'USD Coin',
      usdcDomainVersion: '2',
    }, '0x1111111111111111111111111111111111111111');

    const parsed = JSON.parse(result);
    expect(parsed.accepts).toHaveLength(1);
    expect(parsed.accepts[0].scheme).toBe('exact');
    expect(parsed.accepts[0].network).toBe('eip155:167000');
    expect(parsed.accepts[0].maxAmountRequired).toBe('1000');
    expect(parsed.accepts[0].payTo).toBe('0x1111111111111111111111111111111111111111');
    expect(parsed.accepts[0].asset).toBe('0x2222222222222222222222222222222222222222');
    expect(parsed.accepts[0].extra.name).toBe('USD Coin');
    expect(parsed.accepts[0].extra.version).toBe('2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/payment/x402-compat.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write x402-compat.ts**

```typescript
// src/services/payment/x402-compat.ts
import type { Context, Next } from 'hono';
import type { PaymentResult } from './types.js';
import { extractPaidWalletFromHeader } from '../x402.js';

interface X402ChallengeConfig {
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

export { extractPaidWalletFromHeader } from '../x402.js';
```

Note: The full `handleX402Payment` function wrapping `x402HTTPResourceServer` will be implemented in Task 8 when integrating the middleware, as it requires the actual x402 server instance.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/payment/x402-compat.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/payment/x402-compat.ts tests/unit/payment/x402-compat.test.ts
git commit -m "feat(payment): add x402 compatibility layer for challenge building"
```

---

### Task 7: MPP handler setup

**Files:**
- Create: `src/services/payment/mpp.ts`
- Test: `tests/unit/payment/mpp.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/payment/mpp.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/payment/mpp.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write mpp.ts**

```typescript
// src/services/payment/mpp.ts
import { Mppx, tempo } from 'mppx/server';

export function createMppInstance(payTo: string, secretKey: string) {
  return Mppx.create({
    secretKey,
    methods: [
      tempo.charge({
        currency: '0x20C000000000000000000000b9537d11c60E8b50', // USDC.e on Tempo mainnet
        recipient: payTo,
      }),
    ],
  });
}

export type MppInstance = ReturnType<typeof createMppInstance>;
```

Note: The actual import path for `Mppx` and `tempo` may differ from the spec — verify against the installed package in Task 1 and adjust. If `mppx/server` doesn't export `tempo.charge` directly, check `mppx/hono` or the documented exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/payment/mpp.test.ts`
Expected: PASS. If it fails due to import paths, fix the imports and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/services/payment/mpp.ts tests/unit/payment/mpp.test.ts
git commit -m "feat(payment): add mppx instance factory for Tempo charge payments"
```

---

### Task 8: Protocol detection middleware

This is the core task. The middleware detects which payment protocol the client used and dispatches accordingly.

**Files:**
- Create: `src/services/payment/middleware.ts`
- Test: `tests/unit/payment/middleware.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/payment/middleware.test.ts
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createPaymentMiddleware } from '../../../src/services/payment/middleware';

// Mock mppx instance
function createMockMppx() {
  const charge = vi.fn();
  return {
    charge,
    _setChargeResult(result: unknown) {
      charge.mockReturnValue(vi.fn().mockResolvedValue(result));
    },
  };
}

describe('createPaymentMiddleware', () => {
  it('returns 402 with both challenge headers when no credential present', async () => {
    const mockMppx = createMockMppx();
    const challenge402 = new Response(JSON.stringify({ error: 'Payment required' }), {
      status: 402,
      headers: { 'WWW-Authenticate': 'Payment id="test", method="tempo"' },
    });
    mockMppx._setChargeResult({ status: 402, challenge: challenge402 });

    const app = new Hono();
    const middleware = createPaymentMiddleware({
      mppx: mockMppx as any,
      x402ChallengeConfig: {
        network: 'eip155:167000',
        usdcAssetAddress: '0x2222222222222222222222222222222222222222',
        usdcDomainName: 'USD Coin',
        usdcDomainVersion: '2',
      },
      payTo: '0x1111111111111111111111111111111111111111',
      priceFn: () => '1000',
    });

    app.get('/test', middleware, (c) => c.json({ ok: true }));
    const res = await app.request('/test');

    expect(res.status).toBe(402);
    expect(res.headers.get('WWW-Authenticate')).toContain('Payment');
    expect(res.headers.get('payment-required')).toBeTruthy();
  });

  it('calls next() without payment when priceFn returns null', async () => {
    const mockMppx = createMockMppx();
    const app = new Hono();
    const middleware = createPaymentMiddleware({
      mppx: mockMppx as any,
      x402ChallengeConfig: {
        network: 'eip155:167000',
        usdcAssetAddress: '0x2222222222222222222222222222222222222222',
        usdcDomainName: 'USD Coin',
        usdcDomainVersion: '2',
      },
      payTo: '0x1111111111111111111111111111111111111111',
      priceFn: () => null,
    });

    app.get('/free', middleware, (c) => c.json({ free: true }));
    const res = await app.request('/free');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ free: true });
  });

  it('detects MPP credential via Authorization: Payment header', async () => {
    const mockMppx = createMockMppx();
    const withReceipt = vi.fn((res: Response) => {
      const newRes = new Response(res.body, { status: res.status, headers: res.headers });
      newRes.headers.set('Payment-Receipt', 'test-receipt');
      return newRes;
    });
    mockMppx._setChargeResult({ status: 200, withReceipt });

    const app = new Hono();
    const middleware = createPaymentMiddleware({
      mppx: mockMppx as any,
      x402ChallengeConfig: {
        network: 'eip155:167000',
        usdcAssetAddress: '0x2222222222222222222222222222222222222222',
        usdcDomainName: 'USD Coin',
        usdcDomainVersion: '2',
      },
      payTo: '0x1111111111111111111111111111111111111111',
      priceFn: () => '1000',
      extractMppWallet: () => '0xabcdef1234567890abcdef1234567890abcdef12',
    });

    app.get('/test', middleware, (c) => {
      const result = c.get('paymentResult' as any);
      return c.json({ wallet: result?.wallet, protocol: result?.protocol });
    });

    const res = await app.request('/test', {
      headers: { 'Authorization': 'Payment eyJ0ZXN0IjoiY3JlZGVudGlhbCJ9' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.wallet).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
    expect(body.protocol).toBe('mpp');
  });

  it('detects x402 credential via payment-signature header', async () => {
    const mockMppx = createMockMppx();
    const app = new Hono();
    const middleware = createPaymentMiddleware({
      mppx: mockMppx as any,
      x402ChallengeConfig: {
        network: 'eip155:167000',
        usdcAssetAddress: '0x2222222222222222222222222222222222222222',
        usdcDomainName: 'USD Coin',
        usdcDomainVersion: '2',
      },
      payTo: '0x1111111111111111111111111111111111111111',
      priceFn: () => '1000',
      handleX402: async (c, next) => {
        c.set('paymentResult' as any, {
          wallet: '0x1111111111111111111111111111111111111111',
          protocol: 'x402',
          chainName: 'taiko',
        });
        await next();
      },
    });

    app.get('/test', middleware, (c) => {
      const result = c.get('paymentResult' as any);
      return c.json({ wallet: result?.wallet, protocol: result?.protocol });
    });

    const res = await app.request('/test', {
      headers: { 'payment-signature': 'test-signature' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.wallet).toBe('0x1111111111111111111111111111111111111111');
    expect(body.protocol).toBe('x402');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/payment/middleware.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the middleware**

```typescript
// src/services/payment/middleware.ts
import type { Context, Next, MiddlewareHandler } from 'hono';
import type { PaymentResult } from './types.js';
import { buildX402ChallengeHeader } from './x402-compat.js';

interface X402ChallengeConfig {
  network: string;
  usdcAssetAddress: string;
  usdcDomainName: string;
  usdcDomainVersion: string;
}

interface PaymentMiddlewareConfig {
  mppx: { charge: (options: { amount: string }) => (req: Request) => Promise<any> };
  x402ChallengeConfig: X402ChallengeConfig;
  payTo: string;
  /** Returns price as USD string (e.g. "0.001") for MPP, or null if free */
  priceFn: (c: Context) => string | null;
  /** Converts USD price to asset base units (e.g. "1000" for $0.001 USDC) for x402 challenge */
  usdToAssetFn?: (usdPrice: string) => string;
  extractMppWallet?: (authHeader: string) => string;
  handleX402?: (c: Context, next: Next) => Promise<void | Response>;
}

export function createPaymentMiddleware(config: PaymentMiddlewareConfig): MiddlewareHandler {
  const { mppx, x402ChallengeConfig, payTo, priceFn, extractMppWallet, handleX402 } = config;

  return async (c: Context, next: Next) => {
    const priceUsd = priceFn(c);

    // No payment required (e.g., free retrieval)
    if (priceUsd === null) return next();

    const authHeader = c.req.header('Authorization');
    const paymentSigHeader = c.req.header('payment-signature');

    // --- MPP credential present ---
    if (authHeader?.startsWith('Payment ')) {
      const result = await mppx.charge({ amount: priceUsd })(c.req.raw);

      if (result.status === 402) {
        return result.challenge;
      }

      // Payment verified + settled. Extract wallet.
      const wallet = extractMppWallet
        ? extractMppWallet(authHeader)
        : (() => { throw new Error('extractMppWallet not configured'); })();

      c.set('paymentResult' as any, {
        wallet,
        protocol: 'mpp',
        chainName: 'tempo',
      } satisfies PaymentResult);

      await next();
      c.res = result.withReceipt(c.res);
      return;
    }

    // --- x402 credential present ---
    if (paymentSigHeader && handleX402) {
      return await handleX402(c, next);
    }

    // --- No credential — return 402 with BOTH challenges ---
    const mppResult = await mppx.charge({ amount: priceUsd })(c.req.raw);
    const mppChallengeResponse = mppResult.challenge as Response;

    const x402Challenge = buildX402ChallengeHeader(priceUsd, x402ChallengeConfig, payTo);

    const body = await mppChallengeResponse.text();
    const response = new Response(body, {
      status: 402,
      headers: new Headers(mppChallengeResponse.headers),
    });
    response.headers.set('payment-required', x402Challenge);
    return response;
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/payment/middleware.test.ts`
Expected: PASS

- [ ] **Step 5: Run ALL tests to verify no regressions**

Run: `pnpm vitest run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/payment/middleware.ts tests/unit/payment/middleware.test.ts
git commit -m "feat(payment): add protocol detection middleware with dual-challenge 402 support"
```

---

### Task 9: Config changes (MPP_SECRET_KEY)

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/unit/config.test.ts` (if MPP config validation tests needed)

- [ ] **Step 1: Add `mppSecretKey` to AppConfig**

In `src/config.ts`, add `mppSecretKey: string;` to the `AppConfig` interface (after line 30).

- [ ] **Step 2: Parse MPP_SECRET_KEY in getConfig()**

In `src/config.ts:getConfig()`, add after the `walletAuthTokenSecret` parsing (around line 141):

```typescript
const mppSecretKey = process.env.MPP_SECRET_KEY?.trim() ?? '';
```

Add to the config object:

```typescript
mppSecretKey,
```

- [ ] **Step 3: Add production validation**

In `validateProductionConfig()`, add after the x402 address validation (around line 137):

```typescript
if (config.mppSecretKey.length < 32) {
  throw new Error('Invalid production configuration: MPP_SECRET_KEY must be at least 32 bytes');
}
```

- [ ] **Step 4: Run existing config tests**

Run: `pnpm vitest run tests/unit/config.test.ts`
Expected: PASS (existing tests don't run in production mode, so the new validation won't trigger).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add MPP_SECRET_KEY for mppx HMAC challenge binding"
```

---

### Task 10: Wire everything together in index.ts and app.ts

This is the integration task. The strategy: keep the existing x402 global middleware but make it **skip** when `paymentResult` is already set by the MPP per-route middleware. This avoids extracting x402HTTPResourceServer internals while still allowing MPP to handle payments on the same endpoints.

**Architecture:**
1. MPP per-route middleware runs FIRST (applied per-route before the route handler)
2. x402 global middleware runs SECOND (via `app.use`)
3. x402 middleware checks `c.get('paymentResult')` — if already set by MPP, it calls `next()` and skips payment logic
4. If no MPP credential was present, x402 middleware operates as before

This is approach (B) from the spec — minimal changes to x402, maximum backward compatibility.

**Files:**
- Modify: `src/index.ts`
- Modify: `src/app.ts`
- Modify: `src/services/x402.ts` (add paymentResult skip check)
- Modify: `tests/integration/app.test.ts`

**Price unit clarification:** The `priceFn` returns a **USD string** (e.g., `"0.001"`), which is what mppx `charge({ amount })` expects. The x402 challenge header uses asset-denominated units (e.g., `"1000"` for $0.001 USDC). The middleware handles this conversion: `priceFn` returns USD for MPP, and `buildX402ChallengeHeader` receives the USD-to-asset converted value separately.

- [ ] **Step 1: Update AppEnv in app.ts**

In `src/app.ts`, add `paymentResult` to `AppEnv` Variables (line 372-376):

```typescript
interface AppEnv {
  Bindings: {
    incoming?: { socket?: { remoteAddress?: string | null } };
  };
  Variables: {
    requestId: string;
    walletAddress: string | null;
    walletAuthError: string | null;
    paymentResult?: import('./services/payment/types.js').PaymentResult;
  };
}
```

- [ ] **Step 2: Update AppServices to add MPP middleware**

In `src/app.ts`, add to `AppServices` (lines 350-362). Keep `paymentMiddleware` for x402:

```typescript
export interface AppServices {
  pinningService: PinningService;
  paymentMiddleware: MiddlewareHandler;  // x402 global middleware (unchanged)
  mppMiddleware?: MiddlewareHandler;     // MPP per-route middleware (new)
  walletAuth: WalletAuthConfig;
  // ... rest unchanged
}
```

- [ ] **Step 3: Update x402 middleware to skip when paymentResult is set**

In `src/services/x402.ts`, in the `createPaymentMiddleware` function (line 612), add a check at the beginning of the middleware handler (after line 615):

```typescript
// Skip x402 payment if MPP already handled it
const existingPaymentResult = c.get('paymentResult' as any);
if (existingPaymentResult) {
  return next();
}
```

This is a 3-line change to the existing x402 middleware. When MPP middleware has already verified payment and set `paymentResult`, x402 skips.

- [ ] **Step 4: Add MPP per-route middleware to payment-gated routes**

In `src/app.ts`, update the payment-gated routes to apply MPP middleware before the route handler. The x402 global middleware at `app.use(services.paymentMiddleware)` (line 445) stays.

```typescript
// POST /pins — MPP middleware runs first, then x402 global middleware
app.post('/pins', ...(services.mppMiddleware ? [services.mppMiddleware] : []), async (c) => {
  // Try paymentResult (set by MPP middleware) first, fall back to x402 wallet extraction
  const paymentResult = c.get('paymentResult');
  const paidWallet = paymentResult?.wallet ?? requirePaidWallet(c.req.raw.headers);
  issueWalletAuthToken(c, paidWallet, services.walletAuth);
  const result = await services.pinningService.createPin({ ...body, owner: paidWallet });
  return c.json(toPinStatusResponse(result), 202);
});

// POST /upload — same pattern
app.post('/upload', ...(services.mppMiddleware ? [services.mppMiddleware] : []), async (c) => {
  const paymentResult = c.get('paymentResult');
  const paidWallet = paymentResult?.wallet ?? requirePaidWallet(c.req.raw.headers);
  // ... rest unchanged
});

// GET /ipfs/:cid — same pattern (MPP middleware checks price, skips if free)
app.get('/ipfs/:cid', ...(services.mppMiddleware ? [services.mppMiddleware] : []), async (c) => {
  // ... existing logic unchanged
});
```

**Why this works:**
- When an MPP credential is present: MPP middleware verifies + settles, sets `paymentResult`, calls `next()`. x402 global middleware sees `paymentResult` is set, skips. Route handler reads wallet from `paymentResult`.
- When an x402 credential is present: MPP middleware sees no `Authorization: Payment` header, calls `next()` without setting `paymentResult`. x402 global middleware handles payment as before. Route handler falls back to `requirePaidWallet()`.
- When no credential: MPP middleware returns 402 with MPP challenge. x402 middleware never runs (response already sent). **Problem:** this only returns the MPP challenge, not the dual-challenge response.

**Fix for no-credential case:** The MPP middleware needs to NOT return 402 directly, but instead call `next()` and let x402 handle the no-credential case. Then x402 returns its 402. But we need BOTH challenges.

**Revised approach for the no-credential case:** Create a dedicated `mppChallengeMiddleware` that only adds the `WWW-Authenticate` header to 402 responses. It runs AFTER x402:

```typescript
// In src/app.ts, add after the x402 global middleware:
if (services.mppChallengeEnhancer) {
  app.use(services.mppChallengeEnhancer);
}
```

The `mppChallengeEnhancer` is a response middleware that checks: if the response is 402 and already has a `payment-required` header (from x402), add the MPP `WWW-Authenticate` challenge header too.

- [ ] **Step 5: Create the MPP middleware and challenge enhancer in index.ts**

```typescript
// In src/index.ts, add imports:
import { Credential } from 'mppx';
import { createMppInstance } from './services/payment/mpp.js';
import { extractWalletFromDid } from './services/payment/wallet.js';
import { calculatePriceUsd, usdToAssetAmount } from './services/payment/pricing.js';
import type { PaymentResult } from './services/payment/types.js';

const mppx = config.mppSecretKey
  ? createMppInstance(config.x402PayTo, config.mppSecretKey)
  : null;

// MPP per-route middleware: handles MPP credentials only
const mppMiddleware: MiddlewareHandler | undefined = mppx
  ? async (c, next) => {
      const authHeader = c.req.header('Authorization');
      if (!authHeader?.startsWith('Payment ')) {
        // Not an MPP request — let x402 handle it
        return next();
      }

      // Calculate price in USD string (what mppx expects)
      const sizeBytes = Number(
        c.req.header('x-content-size-bytes') ?? c.req.header('content-length') ?? '0'
      );
      const priceUsd = String(calculatePriceUsd(sizeBytes, x402Config));

      const result = await mppx.charge({ amount: priceUsd })(c.req.raw);

      if (result.status === 402) {
        // MPP credential invalid — return MPP-specific 402
        return result.challenge;
      }

      // Verified + settled. Extract wallet from credential's source DID.
      const base64url = authHeader.slice('Payment '.length);
      const credential = Credential.deserialize(base64url);
      if (!credential.source) {
        throw new Error('MPP credential missing source field — cannot determine payer wallet');
      }

      c.set('paymentResult', {
        wallet: extractWalletFromDid(credential.source),
        protocol: 'mpp',
        chainName: 'tempo',
      } satisfies PaymentResult);

      await next();
      c.res = result.withReceipt(c.res);
    }
  : undefined;

// Challenge enhancer: adds MPP WWW-Authenticate to x402 402 responses
const mppChallengeEnhancer: MiddlewareHandler | undefined = mppx
  ? async (c, next) => {
      await next();

      // If x402 returned 402, add the MPP challenge header too
      if (c.res.status === 402 && !c.req.header('Authorization')?.startsWith('Payment ')) {
        const sizeBytes = Number(
          c.req.header('x-content-size-bytes') ?? c.req.header('content-length') ?? '0'
        );
        const priceUsd = String(calculatePriceUsd(sizeBytes, x402Config));
        const mppResult = await mppx.charge({ amount: priceUsd })(c.req.raw);

        if (mppResult.status === 402) {
          const mppChallenge = mppResult.challenge as Response;
          const wwwAuth = mppChallenge.headers.get('WWW-Authenticate');
          if (wwwAuth) {
            const headers = new Headers(c.res.headers);
            headers.set('WWW-Authenticate', wwwAuth);
            c.res = new Response(c.res.body, { status: 402, headers });
          }
        }
      }
    }
  : undefined;
```

Then update the `createApp` call:

```typescript
const app = createApp({
  pinningService,
  paymentMiddleware,  // existing x402 global middleware
  mppMiddleware,
  mppChallengeEnhancer,
  walletAuth: { /* ... same ... */ },
  // ... rest unchanged
});
```

- [ ] **Step 6: Update AppServices for the new fields**

```typescript
export interface AppServices {
  pinningService: PinningService;
  paymentMiddleware: MiddlewareHandler;
  mppMiddleware?: MiddlewareHandler;
  mppChallengeEnhancer?: MiddlewareHandler;
  walletAuth: WalletAuthConfig;
  // ... rest unchanged
}
```

- [ ] **Step 7: Update createApp middleware wiring**

In `src/app.ts` `createApp()`:
- Keep `app.use(services.paymentMiddleware);` (line 445)
- Add after it: `if (services.mppChallengeEnhancer) { app.use(services.mppChallengeEnhancer); }`
- Add MPP middleware to payment routes:

```typescript
const mppMw = services.mppMiddleware ? [services.mppMiddleware] : [];

app.post('/pins', ...mppMw, async (c) => {
  const body = parsePinPayload(await parseJsonBody(c));
  const paymentResult = c.get('paymentResult');
  const paidWallet = paymentResult?.wallet ?? requirePaidWallet(c.req.raw.headers);
  issueWalletAuthToken(c, paidWallet, services.walletAuth);
  const result = await services.pinningService.createPin({ ...body, owner: paidWallet });
  return c.json(toPinStatusResponse(result), 202);
});
```

- [ ] **Step 8: Update integration tests**

In `tests/integration/app.test.ts`, the `buildApp` helper creates an `AppServices` with `paymentMiddleware`. Add the new optional fields:

```typescript
// In the test's buildApp helper, add:
mppMiddleware: undefined,      // MPP not configured in integration tests
mppChallengeEnhancer: undefined,
```

This keeps all existing x402 tests working. MPP-specific integration tests can be added later with a configured mppx instance.

- [ ] **Step 9: Run ALL tests**

Run: `pnpm vitest run`
Expected: All tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app.ts src/index.ts src/services/x402.ts tests/
git commit -m "feat(payment): wire MPP + x402 dual-protocol support into routes"
```

---

### Task 11: Update agent card

**Files:**
- Modify: `src/app.ts` (agent card route, lines 470-521)
- Modify: `src/app.ts` (`AgentCardConfig` interface, lines 339-348)

- [ ] **Step 1: Update AgentCardConfig to include MPP info**

```typescript
export interface AgentCardConfig {
  name: string;
  description: string;
  version: string;
  x402Network: string;
  x402UsdcAssetAddress: string;
  x402BasePriceUsd: number;
  x402PricePerMbUsd: number;
  x402MaxPriceUsd: number;
  // New MPP fields:
  mppMethod: string;
  mppChainId: number;
  mppAsset: string;
  mppAssetSymbol: string;
}
```

- [ ] **Step 2: Update the agent card route to include MPP protocol info**

In the `/.well-known/agent.json` handler, add the `payments.protocols` array alongside the existing `pricing` section. Keep existing fields for backward compatibility.

- [ ] **Step 3: Update index.ts to pass MPP agent card config**

```typescript
agentCard: {
  // ... existing x402 fields ...
  mppMethod: 'tempo',
  mppChainId: 4217,
  mppAsset: '0x20C000000000000000000000b9537d11c60E8b50',
  mppAssetSymbol: 'USDC.e',
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/index.ts
git commit -m "feat(agent-card): advertise MPP Tempo payment option in agent card"
```

---

### Task 12: Update .env.example and docs

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md` (update project structure)

- [ ] **Step 1: Add MPP_SECRET_KEY to .env.example**

```
# MPP (Machine Payment Protocol) — required for MPP payments on Tempo
MPP_SECRET_KEY=change-me-to-a-strong-random-secret-at-least-32-bytes
```

- [ ] **Step 2: Update CLAUDE.md project structure**

Add the `payment/` directory to the project structure section. Update the "Non-Obvious Things" section to mention dual-protocol support.

- [ ] **Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: add MPP config to .env.example and update CLAUDE.md structure"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm vitest run
```

Expected: All tests PASS.

- [ ] **Step 2: Run TypeScript compilation**

```bash
pnpm build
```

Expected: No type errors.

- [ ] **Step 3: Verify dev server starts**

```bash
MPP_SECRET_KEY=test-secret-key-for-local-development-only WALLET_AUTH_TOKEN_SECRET=test-secret-key-for-local-development-only node dist/index.js &
sleep 2
curl -s http://localhost:3000/health | jq .
curl -s http://localhost:3000/.well-known/agent.json | jq '.capabilities.payments // .pricing'
kill %1
```

Expected: Health check returns `{"status":"ok"}` or `{"status":"degraded"}`. Agent card includes MPP protocol info.

- [ ] **Step 4: Verify 402 response includes both challenges**

```bash
MPP_SECRET_KEY=test-secret-key-for-local-development-only WALLET_AUTH_TOKEN_SECRET=test-secret-key-for-local-development-only node dist/index.js &
sleep 2
curl -si http://localhost:3000/pins -X POST -H 'Content-Type: application/json' -d '{"cid":"QmTest"}' 2>&1 | head -30
kill %1
```

Expected: Response includes BOTH `WWW-Authenticate: Payment` and `payment-required` headers on the 402 response.

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix: address issues found during final verification"
```
