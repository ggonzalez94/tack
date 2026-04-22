# Base x402 Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept x402 payments on Base mainnet (`eip155:8453`) alongside Taiko Alethia on the same endpoints — using PayAI (permissionless facilitator), zero new env vars, shared `X402_PAY_TO` wallet.

**Architecture:** Refactor `X402PaymentConfig` from single-chain (flat fields) to multi-chain (`chains: X402ChainConfig[]`, shared pricing). Bootstrap builds a two-entry array: Taiko from env, Base from hardcoded constants. `x402ResourceServer` receives both `HTTPFacilitatorClient` instances; each route's `accepts` becomes a per-chain array. Taiko stays at `accepts[0]` to preserve the MPP challenge-enhancer's `accepts[0]` price mirror. Agent card emits one x402 entry per chain.

**Tech Stack:** TypeScript, Hono, `@x402/core` v2.6, `@x402/evm`, Vitest.

**Design spec:** `docs/superpowers/specs/2026-04-21-base-x402-support-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/services/payment/chains/base.ts` | Create | Export `BASE_CHAIN` constants (network, facilitator URL, USDC address, domain, decimals) |
| `src/services/x402.ts` | Modify | Introduce `X402ChainConfig`; reshape `X402PaymentConfig` to `{ chains, …shared pricing }`; rebuild middleware to register multiple chains and emit multi-accept routes |
| `src/index.ts` | Modify | Build `chains: [taiko, base]` array, pass to `createX402PaymentMiddleware`; pass agent-card chain list |
| `src/app.ts` | Modify | `AgentCardConfig.x402Chains: Array<{network, usdcAssetAddress}>` replaces the two flat fields; emit one x402 `protocols` entry per chain; extend chainId→name map with `8453 → 'base'` |
| `tests/unit/x402.test.ts` | Modify | Fixtures move to `chains: [taikoChain]`; add "registers and prices both chains" test covering multi-chain `accepts`, price parity, per-chain `payTo` |
| `tests/unit/chains-base.test.ts` | Create | Pin `BASE_CHAIN` constant values |
| `tests/integration/app.test.ts` | Modify | Update `paymentConfig` to new shape; add 402 response test covering both chains' `accepts` + `accepts[0]` price equals `accepts[1]`; update agent-card test |
| `CHANGELOG.md` | Modify | New `Unreleased` entry under `Added` |

---

## Task 1: Create `BASE_CHAIN` constants

**Files:**
- Create: `src/services/payment/chains/base.ts`
- Create: `tests/unit/chains-base.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/chains-base.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { BASE_CHAIN } from '../../src/services/payment/chains/base';

describe('BASE_CHAIN constants', () => {
  it('points at Base mainnet with Circle native USDC', () => {
    expect(BASE_CHAIN.network).toBe('eip155:8453');
    expect(BASE_CHAIN.usdcAssetAddress).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(BASE_CHAIN.usdcAssetDecimals).toBe(6);
    expect(BASE_CHAIN.usdcDomainName).toBe('USD Coin');
    expect(BASE_CHAIN.usdcDomainVersion).toBe('2');
  });

  it('defaults to the PayAI permissionless facilitator', () => {
    expect(BASE_CHAIN.facilitatorUrl).toBe('https://facilitator.payai.network');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/chains-base.test.ts`
Expected: FAIL with "Cannot find module '../../src/services/payment/chains/base'".

- [ ] **Step 3: Write minimal implementation**

Create `src/services/payment/chains/base.ts`:

```typescript
export const BASE_CHAIN = {
  network: 'eip155:8453',
  facilitatorUrl: 'https://facilitator.payai.network',
  usdcAssetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  usdcDomainName: 'USD Coin',
  usdcDomainVersion: '2',
  usdcAssetDecimals: 6,
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/unit/chains-base.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/payment/chains/base.ts tests/unit/chains-base.test.ts
git commit -m "feat(x402): add Base chain constants"
```

---

## Task 2: Refactor `X402PaymentConfig` to multi-chain shape

This task changes the type surface of `createX402PaymentMiddleware` and its config. Taiko stays as the only entry so behavior is unchanged; Task 3 adds Base.

**Files:**
- Modify: `src/services/x402.ts` (lines 47–60 for the config type; lines 454–547 for `createX402PaymentMiddleware`)
- Modify: `tests/unit/x402.test.ts` (lines 19–32 for the fixture)
- Modify: `tests/integration/app.test.ts` (lines 38–51 for the fixture)
- Modify: `src/index.ts` (lines 68–93 for the middleware call)

- [ ] **Step 1: Update the unit test fixture to the new shape (failing test)**

Edit `tests/unit/x402.test.ts`, replace the `testConfig` block at lines 19–32 with:

```typescript
const taikoChain = {
  network: 'eip155:167000' as const,
  facilitatorUrl: 'http://localhost:9999',
  payTo: '0x1111111111111111111111111111111111111111',
  usdcAssetAddress: '0x2222222222222222222222222222222222222222',
  usdcAssetDecimals: 6,
  usdcDomainName: 'USD Coin',
  usdcDomainVersion: '2'
};

const testConfig: X402PaymentConfig = {
  chains: [taikoChain],
  ratePerGbMonthUsd: 0.10,
  minPriceUsd: 0.001,
  maxPriceUsd: 50.0,
  defaultDurationMonths: 1,
  maxDurationMonths: 24
};
```

Then, in the same file, replace every remaining `testConfig.network`, `testConfig.payTo`, `testConfig.usdcAssetAddress` reference with `taikoChain.network`, `taikoChain.payTo`, `taikoChain.usdcAssetAddress`. (The test file uses them in the `mockFacilitator` `getSupported` stub and in expectations — `taikoChain` is the single source of truth now.)

- [ ] **Step 2: Update the integration test fixture**

Edit `tests/integration/app.test.ts` lines 38–51. Replace the `paymentConfig` block with:

```typescript
const taikoChain = {
  network: 'eip155:167000' as const,
  facilitatorUrl: 'http://localhost:9999',
  payTo: '0x1111111111111111111111111111111111111111',
  usdcAssetAddress: '0x2222222222222222222222222222222222222222',
  usdcAssetDecimals: 6,
  usdcDomainName: 'USD Coin',
  usdcDomainVersion: '2'
};

const paymentConfig: X402PaymentConfig = {
  chains: [taikoChain],
  ratePerGbMonthUsd: 0.10,
  minPriceUsd: 0.001,
  maxPriceUsd: 50.0,
  defaultDurationMonths: 1,
  maxDurationMonths: 24
};
```

Then update the two `paymentConfig.network` and `paymentConfig.payTo` references further down the file (lines 88–90 in `mockFacilitator.getSupported`) to use `taikoChain.network` / `taikoChain.payTo`.

Leave the agent-card integration test at lines 988–1005 alone for now — that fixture still uses `x402Network` / `x402UsdcAssetAddress`. Task 4 reshapes it.

- [ ] **Step 3: Run tests to verify they fail at compile time**

Run: `pnpm typecheck`
Expected: FAIL — errors like "Property 'chains' does not exist on type 'X402PaymentConfig'" and "Property 'x402Chains' does not exist".

- [ ] **Step 4: Reshape `X402PaymentConfig` and rewrite middleware**

Edit `src/services/x402.ts`. Replace the `X402PaymentConfig` interface at lines 47–60 with:

```typescript
export interface X402ChainConfig {
  network: `${string}:${string}`;
  facilitatorUrl: string;
  payTo: string;
  usdcAssetAddress: string;
  usdcAssetDecimals: number;
  usdcDomainName: string;
  usdcDomainVersion: string;
}

export interface X402PaymentConfig {
  chains: X402ChainConfig[];
  ratePerGbMonthUsd: number;
  minPriceUsd: number;
  maxPriceUsd: number;
  defaultDurationMonths: number;
  maxDurationMonths: number;
}
```

Then replace the `createX402PaymentMiddleware` function body (currently lines 454–547) with:

```typescript
export function createX402PaymentMiddleware(
  config: X402PaymentConfig,
  facilitatorClient?: FacilitatorClient,
  options?: X402PaymentMiddlewareOptions
): MiddlewareHandler {
  if (config.chains.length === 0) {
    throw new Error('createX402PaymentMiddleware requires at least one chain');
  }

  const retrievalResolver = options?.resolveRetrievalPayment;

  // When a single facilitator is injected (tests), reuse it for every chain.
  // In production each chain gets its own HTTPFacilitatorClient.
  const facilitators = facilitatorClient
    ? [facilitatorClient]
    : config.chains.map((chain) => new HTTPFacilitatorClient({ url: chain.facilitatorUrl }));

  const resourceServer = new x402ResourceServer(facilitators);
  for (const chain of config.chains) {
    resourceServer.register(chain.network, new ExactEvmScheme());
  }

  const buildAccepts = (
    priceUsdForChain: () => Promise<number>,
    payToOverride?: (chain: X402ChainConfig) => string | Promise<string>
  ) => {
    return config.chains.map((chain) => ({
      scheme: 'exact' as const,
      network: chain.network,
      payTo: payToOverride ? (async () => payToOverride(chain)) : chain.payTo,
      extra: { name: chain.usdcDomainName, version: chain.usdcDomainVersion },
      price: async () => {
        const usdPrice = await priceUsdForChain();
        return usdToAssetAmount(usdPrice, chain.usdcAssetAddress, chain.usdcAssetDecimals);
      }
    }));
  };

  const routes: RoutesConfig = {
    'POST /pins': {
      accepts: config.chains.map((chain) => ({
        scheme: 'exact' as const,
        network: chain.network,
        payTo: chain.payTo,
        extra: { name: chain.usdcDomainName, version: chain.usdcDomainVersion },
        price: async (context: HTTPRequestContext) => {
          const sizeBytes = await resolvePinRequestSizeBytes(context);
          const durationMonths = resolveDurationMonths(context, config);
          const usdPrice = calculatePriceUsd(sizeBytes, durationMonths, config);
          return usdToAssetAmount(usdPrice, chain.usdcAssetAddress, chain.usdcAssetDecimals);
        }
      })),
      description: 'Create IPFS pin',
      mimeType: 'application/json',
      unpaidResponseBody: makeUnpaidResponseBody('Pin a CID to IPFS.', config),
      settlementFailedResponseBody: makeSettlementFailedResponseBody()
    },
    'POST /upload': {
      accepts: config.chains.map((chain) => ({
        scheme: 'exact' as const,
        network: chain.network,
        payTo: chain.payTo,
        extra: { name: chain.usdcDomainName, version: chain.usdcDomainVersion },
        price: (context: HTTPRequestContext) => {
          const sizeBytes = resolveUploadSizeBytes(context);
          const usdPrice = calculatePriceUsd(sizeBytes, 1, config);
          return usdToAssetAmount(usdPrice, chain.usdcAssetAddress, chain.usdcAssetDecimals);
        }
      })),
      description: 'Upload content to IPFS',
      mimeType: 'application/json',
      unpaidResponseBody: makeUnpaidResponseBody('Upload content to IPFS and pin it.'),
      settlementFailedResponseBody: makeSettlementFailedResponseBody()
    }
  };

  if (retrievalResolver) {
    routes['GET /ipfs/[cid]'] = {
      accepts: config.chains.map((chain) => ({
        scheme: 'exact' as const,
        network: chain.network,
        extra: { name: chain.usdcDomainName, version: chain.usdcDomainVersion },
        payTo: async (context: HTTPRequestContext) => {
          const requirement = await resolveRetrievalRequirement(context, retrievalResolver);
          return requirement?.payTo ?? chain.payTo;
        },
        price: async (context: HTTPRequestContext) => {
          const requirement = await resolveRetrievalRequirement(context, retrievalResolver);
          const usdPrice = requirement?.priceUsd ?? config.minPriceUsd;
          return usdToAssetAmount(usdPrice, chain.usdcAssetAddress, chain.usdcAssetDecimals);
        }
      })),
      description: 'Retrieve IPFS content',
      mimeType: 'application/octet-stream',
      unpaidResponseBody: () => ({
        contentType: 'application/json',
        body: { error: 'Payment required to retrieve premium content' }
      })
    };
  }

  const httpServer = new x402HTTPResourceServer(resourceServer, routes);

  if (retrievalResolver) {
    httpServer.onProtectedRequest(async (context) => {
      if (context.method !== 'GET') {
        return;
      }

      const requirement = await resolveRetrievalRequirement(context, retrievalResolver);
      if (!requirement || requirement.priceUsd <= 0) {
        return { grantAccess: true };
      }

      return;
    });
  }

  return createPaymentMiddleware(httpServer);
}
```

Note the unused `buildAccepts` helper from the sketch above is not kept — each route inlines its own factory since price calculation differs. Delete the `buildAccepts` block if you pasted it; it's not referenced.

- [ ] **Step 5: Fix `src/index.ts` call site**

Edit `src/index.ts` lines 68–81. Replace the `createX402PaymentMiddleware` call with:

```typescript
const paymentMiddleware = createX402PaymentMiddleware({
  chains: [
    {
      network: config.x402Network as `${string}:${string}`,
      facilitatorUrl: config.x402FacilitatorUrl,
      payTo: config.x402PayTo,
      usdcAssetAddress: config.x402UsdcAssetAddress,
      usdcAssetDecimals: config.x402UsdcAssetDecimals,
      usdcDomainName: config.x402UsdcDomainName,
      usdcDomainVersion: config.x402UsdcDomainVersion
    }
  ],
  ratePerGbMonthUsd: config.x402RatePerGbMonthUsd,
  minPriceUsd: config.x402MinPriceUsd,
  maxPriceUsd: config.x402MaxPriceUsd,
  defaultDurationMonths: config.x402DefaultDurationMonths,
  maxDurationMonths: config.x402MaxDurationMonths
}, undefined, {
  resolveRetrievalPayment: (cid) => {
    const policy = pinningService.resolveRetrievalPaymentPolicy(cid);
    if (!policy) {
      return null;
    }

    return {
      payTo: policy.payTo,
      priceUsd: policy.priceUsd
    };
  }
});
```

- [ ] **Step 6: Run typecheck and tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. All existing tests continue to pass because the only functional change is how the config is shaped — the route definitions are equivalent for a single-chain array.

`app.ts` references `agent.x402Network` and `agent.x402UsdcAssetAddress` at lines 358–359, 514, 518–519, 576–577 and `src/index.ts` populates them at lines 311–312. Do not touch any of those in this task — Task 4 reshapes them. The only files this task edits are: `src/services/x402.ts`, `src/index.ts` (only the `createX402PaymentMiddleware` call block, lines 68–93), `tests/unit/x402.test.ts`, and the `paymentConfig` fixture in `tests/integration/app.test.ts`. Ensure `pnpm test` passes before committing.

- [ ] **Step 7: Commit**

```bash
git add src/services/x402.ts src/index.ts tests/unit/x402.test.ts tests/integration/app.test.ts
git commit -m "refactor(x402): reshape config to chains[] array (single-chain, no behavior change)"
```

---

## Task 3: Add Base as second chain in bootstrap + x402 unit test for multi-chain

**Files:**
- Modify: `src/index.ts` (the `createX402PaymentMiddleware` call from Task 2)
- Modify: `tests/unit/x402.test.ts` (add multi-chain test)

- [ ] **Step 1: Write the failing multi-chain test**

Append to `tests/unit/x402.test.ts` inside the `describe('x402 middleware', …)` block:

```typescript
  it('advertises one accepts entry per registered chain with matching asset amount', async () => {
    const baseChain = {
      network: 'eip155:8453' as const,
      facilitatorUrl: 'http://localhost:9998',
      payTo: taikoChain.payTo,
      usdcAssetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      usdcAssetDecimals: 6,
      usdcDomainName: 'USD Coin',
      usdcDomainVersion: '2'
    };
    const multiChainConfig: X402PaymentConfig = {
      ...testConfig,
      chains: [taikoChain, baseChain]
    };

    const app = new Hono();
    app.use(createX402PaymentMiddleware(multiChainConfig, mockFacilitator));
    app.post('/pins', (c) => c.json({ ok: true }));

    const unpaid = await app.request(
      new Request('http://localhost/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cid: 'bafy-test' })
      })
    );

    expect(unpaid.status).toBe(402);
    const paymentRequiredHeader = unpaid.headers.get('payment-required');
    expect(paymentRequiredHeader).toBeTruthy();
    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader!);

    expect(paymentRequired.accepts).toHaveLength(2);
    expect(paymentRequired.accepts[0].network).toBe('eip155:167000');
    expect(paymentRequired.accepts[1].network).toBe('eip155:8453');
    expect(paymentRequired.accepts[0].payTo).toBe(taikoChain.payTo);
    expect(paymentRequired.accepts[1].payTo).toBe(baseChain.payTo);
    // USDC has 6 decimals on both chains; the same USD price → same asset amount.
    expect(paymentRequired.accepts[0].amount).toBe(paymentRequired.accepts[1].amount);
    expect(paymentRequired.accepts[0].asset).toBe(taikoChain.usdcAssetAddress);
    expect(paymentRequired.accepts[1].asset).toBe(baseChain.usdcAssetAddress);
  });
```

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `pnpm test -- tests/unit/x402.test.ts`
Expected: PASS for this new test (the middleware built in Task 2 already supports N chains; this test only confirms the contract). If it fails, fix the middleware — the bug is in `src/services/x402.ts`.

- [ ] **Step 3: Add Base to the production bootstrap**

Edit `src/index.ts`. Add the import at the top of the existing imports section (after the other `./services/payment/*` imports):

```typescript
import { BASE_CHAIN } from './services/payment/chains/base';
```

Then edit the `createX402PaymentMiddleware` call from Task 2's Step 5 — replace the `chains` array with both entries:

```typescript
  chains: [
    {
      network: config.x402Network as `${string}:${string}`,
      facilitatorUrl: config.x402FacilitatorUrl,
      payTo: config.x402PayTo,
      usdcAssetAddress: config.x402UsdcAssetAddress,
      usdcAssetDecimals: config.x402UsdcAssetDecimals,
      usdcDomainName: config.x402UsdcDomainName,
      usdcDomainVersion: config.x402UsdcDomainVersion
    },
    {
      network: BASE_CHAIN.network,
      facilitatorUrl: BASE_CHAIN.facilitatorUrl,
      payTo: config.x402PayTo,
      usdcAssetAddress: BASE_CHAIN.usdcAssetAddress,
      usdcAssetDecimals: BASE_CHAIN.usdcAssetDecimals,
      usdcDomainName: BASE_CHAIN.usdcDomainName,
      usdcDomainVersion: BASE_CHAIN.usdcDomainVersion
    }
  ],
```

- [ ] **Step 4: Run tests**

Run: `pnpm typecheck && pnpm test -- tests/unit/x402.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/x402.ts src/index.ts tests/unit/x402.test.ts
git commit -m "feat(x402): register Base mainnet as a second chain"
```

---

## Task 4: Agent card exposes both chains

**Files:**
- Modify: `src/app.ts` (AgentCardConfig at lines 354–369; `/.well-known/agent.json` handler at lines 511–604)
- Modify: `src/index.ts` (agentCard field at lines 307–322)
- Modify: `tests/integration/app.test.ts` (agent-card test at lines 988–1070)

- [ ] **Step 1: Write the failing test**

Edit `tests/integration/app.test.ts`. Replace the agent-card test at lines 988–1006 (the `buildApp` call's `agentCard` argument) with the new shape:

```typescript
  it('returns updated agent card with new pricing fields', async () => {
    const agentCardApp = buildApp({
      agentCard: {
        name: 'Tack',
        description: 'Test agent',
        version: '0.0.1',
        x402Chains: [
          {
            network: 'eip155:167000',
            usdcAssetAddress: '0x2222222222222222222222222222222222222222',
          },
          {
            network: 'eip155:8453',
            usdcAssetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          }
        ],
        x402RatePerGbMonthUsd: 0.10,
        x402MinPriceUsd: 0.001,
        x402MaxPriceUsd: 50.0,
        x402DefaultDurationMonths: 1,
        x402MaxDurationMonths: 24,
        mppMethod: 'tempo',
        mppChainId: 4217,
        mppAsset: '0x20C000000000000000000000b9537d11c60E8b50',
        mppAssetSymbol: 'USDC.e'
      }
    });
```

Then update the assertions further down the same test. Find the section asserting on the `protocols` array and replace it with (locate by searching for `payments.protocols` inside this test):

```typescript
    const x402Protocols = card.payments.protocols.filter((p) => p.protocol === 'x402');
    expect(x402Protocols).toHaveLength(2);
    expect(x402Protocols[0]).toMatchObject({ chainId: 167000, chain: 'taiko' });
    expect(x402Protocols[1]).toMatchObject({ chainId: 8453, chain: 'base' });

    const mppProtocol = card.payments.protocols.find((p) => p.protocol === 'mpp');
    expect(mppProtocol).toMatchObject({ chain: 'tempo', chainId: 4217 });
```

Update the response-body type annotation just above, at the line `const card = (await response.json()) as {`, so `protocols` is typed as `Array<{ protocol: string; chainId?: number; chain?: string }>`.

- [ ] **Step 2: Run test to verify it fails at compile time**

Run: `pnpm typecheck`
Expected: FAIL — "Property 'x402Chains' does not exist on type 'AgentCardConfig'".

- [ ] **Step 3: Reshape `AgentCardConfig`**

Edit `src/app.ts` lines 354–369. Replace:

```typescript
export interface AgentCardConfig {
  name: string;
  description: string;
  version: string;
  x402Network: string;
  x402UsdcAssetAddress: string;
  x402RatePerGbMonthUsd: number;
  x402MinPriceUsd: number;
  x402MaxPriceUsd: number;
  x402DefaultDurationMonths: number;
  x402MaxDurationMonths: number;
  mppMethod?: string;
  mppChainId?: number;
  mppAsset?: string;
  mppAssetSymbol?: string;
}
```

with:

```typescript
export interface AgentCardX402Chain {
  network: string;
  usdcAssetAddress: string;
}

export interface AgentCardConfig {
  name: string;
  description: string;
  version: string;
  x402Chains: AgentCardX402Chain[];
  x402RatePerGbMonthUsd: number;
  x402MinPriceUsd: number;
  x402MaxPriceUsd: number;
  x402DefaultDurationMonths: number;
  x402MaxDurationMonths: number;
  mppMethod?: string;
  mppChainId?: number;
  mppAsset?: string;
  mppAssetSymbol?: string;
}
```

- [ ] **Step 4: Update the agent card handler**

Edit `src/app.ts` lines 511–604. Replace the `app.get('/.well-known/agent.json', …)` block with:

```typescript
  app.get('/.well-known/agent.json', (c) => {
    const origin = new URL(c.req.url).origin;
    const agent = services.agentCard;

    const chainNameByChainId: Record<number, string> = {
      167000: 'taiko',
      8453: 'base',
    };

    const protocols: Array<Record<string, unknown>> = [];

    for (const chain of agent?.x402Chains ?? []) {
      const chainId = parseEip155ChainId(chain.network);
      const entry: Record<string, unknown> = {
        protocol: 'x402',
        asset: chain.usdcAssetAddress,
        network: chain.network,
      };
      if (chainId !== undefined) {
        entry.chainId = chainId;
        const chainName = chainNameByChainId[chainId];
        if (chainName !== undefined) {
          entry.chain = chainName;
        }
      }
      protocols.push(entry);
    }

    if (agent?.mppMethod) {
      protocols.push({
        protocol: 'mpp',
        method: agent.mppMethod,
        chain: 'tempo',
        chainId: agent.mppChainId,
        asset: agent.mppAsset,
        assetSymbol: agent.mppAssetSymbol,
        intent: 'charge',
      });
    }

    const primaryX402 = agent?.x402Chains?.[0];

    return c.json({
      protocol: 'a2a',
      version: '1.0',
      name: agent?.name ?? 'Tack',
      description: agent?.description ?? 'Pin to IPFS, pay with your wallet. No account needed.',
      endpoint: origin,
      capabilities: {
        pinningApi: {
          spec: 'IPFS Pinning Service API',
          endpoints: ['/pins', '/pins/:requestid', '/upload']
        },
        gateway: {
          endpoint: '/ipfs/:cid',
          supports: ['etag', 'range', 'cache-control', 'optional-paywall']
        }
      },
      payments: {
        protocols,
        pricing: {
          ratePerGbMonthUsd: agent?.x402RatePerGbMonthUsd,
          minPriceUsd: agent?.x402MinPriceUsd,
          maxPriceUsd: agent?.x402MaxPriceUsd,
          defaultDurationMonths: agent?.x402DefaultDurationMonths,
          maxDurationMonths: agent?.x402MaxDurationMonths,
          durationHeader: 'X-Pin-Duration-Months',
          currency: 'USD',
        },
      },
      pricing: {
        pinning: {
          protocol: 'x402',
          spec: X402_SPEC_URL,
          clientSdk: '@x402/fetch',
          paymentHeader: 'Payment-Signature',
          network: primaryX402?.network,
          asset: primaryX402?.usdcAssetAddress,
          ratePerGbMonthUsd: agent?.x402RatePerGbMonthUsd,
          minPriceUsd: agent?.x402MinPriceUsd,
          maxPriceUsd: agent?.x402MaxPriceUsd,
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
      authentication: {
        walletAuthToken: {
          description: 'Paid requests return x-wallet-auth-token. Use as Bearer token for owner endpoints (GET /pins, DELETE /pins/:id).',
          responseHeaders: [WALLET_AUTH_TOKEN_RESPONSE_HEADER, WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER],
          usage: 'Authorization: Bearer <token>',
        }
      },
      links: {
        x402Spec: X402_SPEC_URL,
        x402ClientSdk: 'https://www.npmjs.com/package/@x402/fetch',
        ipfsPinningSpec: 'https://ipfs.github.io/pinning-services-api-spec/',
      }
    });
  });
```

Note: the `pricing.pinning.network` and `pricing.pinning.asset` fields at the top level are kept for wire-format stability — they now come from `primaryX402` (the first entry, Taiko). This preserves the exact keys existing clients read.

- [ ] **Step 5: Update `src/index.ts` to pass `x402Chains`**

Edit `src/index.ts` lines 307–322. Replace the `agentCard` literal with:

```typescript
  agentCard: {
    name: 'Tack',
    description: 'Pin to IPFS, pay with your wallet. No account needed.',
    version: appVersion,
    x402Chains: [
      {
        network: config.x402Network,
        usdcAssetAddress: config.x402UsdcAssetAddress,
      },
      {
        network: BASE_CHAIN.network,
        usdcAssetAddress: BASE_CHAIN.usdcAssetAddress,
      }
    ],
    x402RatePerGbMonthUsd: config.x402RatePerGbMonthUsd,
    x402MinPriceUsd: config.x402MinPriceUsd,
    x402MaxPriceUsd: config.x402MaxPriceUsd,
    x402DefaultDurationMonths: config.x402DefaultDurationMonths,
    x402MaxDurationMonths: config.x402MaxDurationMonths,
    mppMethod: mppx ? 'tempo' : undefined,
    mppChainId: mppx ? tempoViemChain.id : undefined,
    mppAsset: mppx ? mppCurrencyAddress : undefined,
    mppAssetSymbol: mppx ? mppCurrencySymbol : undefined
  }
```

- [ ] **Step 6: Run typecheck and tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS across the whole suite.

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/index.ts tests/integration/app.test.ts
git commit -m "feat(agent-card): emit both Taiko and Base x402 protocols"
```

---

## Task 5: Integration test — 402 response advertises both chains

Ensure the full app (with middleware + agent card wired together) emits the right 402 when a client hits `/pins` without payment.

**Files:**
- Modify: `tests/integration/app.test.ts`

- [ ] **Step 1: Build a multi-chain test fixture**

Near the top of `tests/integration/app.test.ts`, just after `const paymentConfig: X402PaymentConfig = { … }`, add:

```typescript
const multiChainPaymentConfig: X402PaymentConfig = {
  ...paymentConfig,
  chains: [
    taikoChain,
    {
      network: 'eip155:8453',
      facilitatorUrl: 'http://localhost:9998',
      payTo: taikoChain.payTo,
      usdcAssetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      usdcAssetDecimals: 6,
      usdcDomainName: 'USD Coin',
      usdcDomainVersion: '2'
    }
  ]
};
```

- [ ] **Step 2: Add the failing integration test**

Inside the existing `describe('API integration', …)` block, add a new `describe`:

```typescript
  describe('multi-chain x402', () => {
    it('advertises both Taiko and Base in the 402 payment-required header', async () => {
      const multiChainApp = createApp({
        pinningService: service,
        paymentMiddleware: createX402PaymentMiddleware(multiChainPaymentConfig, mockFacilitator),
        walletAuth: walletAuthConfig,
        defaultDurationMonths: 1,
        maxDurationMonths: 24
      });

      const res = await multiChainApp.request(
        new Request('http://localhost/pins', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cid: 'bafy-test' })
        })
      );

      expect(res.status).toBe(402);

      const paymentRequiredHeader = res.headers.get('payment-required');
      expect(paymentRequiredHeader).toBeTruthy();

      const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader!);
      const networks = paymentRequired.accepts.map((a) => a.network);
      expect(networks).toEqual(['eip155:167000', 'eip155:8453']);
      // Price parity: same USD price → same asset amount (both USDC, 6 decimals).
      expect(paymentRequired.accepts[0].amount).toBe(paymentRequired.accepts[1].amount);
    });
  });
```

- [ ] **Step 3: Run the new test**

Run: `pnpm test -- tests/integration/app.test.ts -t "multi-chain"`
Expected: PASS.

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/app.test.ts
git commit -m "test(x402): assert 402 advertises Taiko + Base on /pins"
```

---

## Task 6: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md` (lines 10–12, the `[Unreleased]` section)

- [ ] **Step 1: Add the Unreleased note**

Edit `CHANGELOG.md`. Replace lines 10–12:

```markdown
## [Unreleased]

- None yet.
```

with:

```markdown
## [Unreleased]

### Added
- Tack now accepts x402 payments on Base mainnet (`eip155:8453`) alongside Taiko Alethia. The same endpoints (`POST /pins`, `POST /upload`, paywalled `GET /ipfs/:cid`) serve both chains — unpaid requests receive a single `402` whose `payment-required` header advertises Taiko USDC and Base USDC at the same USD price. Clients pick whichever chain they already hold USDC on. Base settlement goes through the permissionless PayAI facilitator; no operator-side credentials required.
- The agent card at `/.well-known/agent.json` now publishes one x402 protocol entry per supported chain (`chain: 'taiko'` and `chain: 'base'`).
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note Base x402 support under Unreleased"
```

---

## Task 7: Full verification

- [ ] **Step 1: Run the full check**

Run: `pnpm check`
Expected: lint + typecheck + full test suite + build all pass.

- [ ] **Step 2: Verify constants one more time**

Read `src/services/payment/chains/base.ts` and confirm:
- `network` is `'eip155:8453'` (Base mainnet)
- `usdcAssetAddress` is `'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'` (Circle native USDC on Base; NOT USDbC which is `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA`)
- `usdcAssetDecimals` is `6`

- [ ] **Step 3: Spot-check the 402 output by hand**

Start the dev server locally and hit `POST /pins` with no payment:

```bash
pnpm dev &
sleep 3
curl -s -X POST http://localhost:3000/pins \
  -H 'content-type: application/json' \
  -d '{"cid":"bafy-test"}' \
  -D - -o /dev/null
kill %1
```

Expected: HTTP 402; `payment-required` header present; decoded header (via `echo <value> | base64 -d`) includes entries for both `eip155:167000` and `eip155:8453`. Note: this requires a valid `.env` — if the local dev environment rejects placeholder EVM addresses in prod mode, this step is informational only; the unit + integration tests are authoritative.

- [ ] **Step 4: Final commit (if anything needed tweaking)**

No new commit if all checks pass clean. Otherwise fix and commit incrementally.

---

## Self-Review Notes (for the plan author)

- **Spec coverage**: every section of the spec maps to a task — Task 1 (constants), Task 2 + 3 (middleware + bootstrap), Task 4 (agent card), Task 5 (integration test for 402), Task 6 (CHANGELOG), Task 7 (verification). No gaps.
- **Type consistency**: `X402ChainConfig` fields (`network`, `facilitatorUrl`, `payTo`, `usdcAssetAddress`, `usdcAssetDecimals`, `usdcDomainName`, `usdcDomainVersion`) are reused verbatim in Tasks 2, 3, and 5. `AgentCardX402Chain` has only `network` + `usdcAssetAddress` (Task 4) — the agent card doesn't need the full config, just the public discovery fields.
- **Taiko at `accepts[0]`**: enforced by bootstrap order in Task 3 Step 3 (Taiko first, Base second). The MPP challenge-enhancer reads `accepts[0]` at `challenge-enhancer.ts:33` and mirrors its amount — since Taiko and Base both use USDC with 6 decimals, the mirrored price is correct regardless, but keeping Taiko first preserves bit-for-bit parity with pre-change behavior.
- **No placeholders**: every step has real code / real commands.
- **MPP untouched**: Tasks 2–5 don't modify MPP code. `createMppPaymentMiddleware` and `createMppChallengeEnhancer` consume only the shared pricing config, which is unchanged.
- **Scope**: single feature, one plan, one release.
