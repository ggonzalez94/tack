# Add Base x402 support

## Goal

Accept x402 payments on Base mainnet (`eip155:8453`) on the same endpoints that already accept x402 on Taiko Alethia (`eip155:167000`). Additive — Taiko stays. Client pays with USDC on whichever chain it prefers.

## Motivation

Base is where most existing x402 client traffic lives (Coinbase ecosystem). Offering Base payment alongside Taiko widens the set of x402-capable clients that can pin to Tack without forcing them onto a new chain.

## Scope

**In scope**: `POST /pins`, `POST /upload`, `GET /ipfs/:cid` (retrieval paywall) accept either Taiko USDC or Base USDC x402 payments. Agent card advertises both. Pricing, MPP, rate limiting, owner auth, wallet isolation unchanged.

**Out of scope**: Replacing Taiko's facilitator; generic N-chain config shape; UI copy changes; any MPP/Tempo changes; non-USDC payment assets; price differentiation across chains.

## Facilitator choice: PayAI

Base facilitator: `https://facilitator.payai.network`.

- **Permissionless** — no API keys, no auth handshake, nothing to rotate.
- Referenced in Coinbase's own `x402/docs/getting-started/quickstart-for-sellers.mdx` as the mainnet drop-in when not using CDP.
- Supports Base mainnet (`eip155:8453`) with `exact` scheme over ERC-20 USDC.
- Coinbase CDP (`api.cdp.coinbase.com/platform/v2/x402`) is rejected because it requires `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` on mainnet, which violates "permissionless".

**Risk**: PayAI is an independent operator. If it degrades or turns hostile, Base settlement stalls. Mitigation is a code-level facilitator swap (see "If PayAI degrades"). Taiko is unaffected either way.

## Config

Zero new env vars. All Base-specific values are constants in a new file. This matches the existing convention — Taiko x402 has no disable flag either, and Tempo MPP is enable-by-presence-of-secret. Base has no required secret, so it's always on. Disabling Base means a code change.

New file `src/services/payment/chains/base.ts`:

```ts
export const BASE_CHAIN = {
  network: 'eip155:8453' as const,
  facilitatorUrl: 'https://facilitator.payai.network',
  usdcAssetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  usdcDomainName: 'USD Coin',
  usdcDomainVersion: '2',
  usdcAssetDecimals: 6,
} as const;
```

`payTo` reuses the existing `X402_PAY_TO` env var — same wallet receives USDC on both chains (EVM, same private key).

Pricing (`X402_RATE_PER_GB_MONTH_USD`, `X402_MIN_PRICE_USD`, `X402_MAX_PRICE_USD`, `X402_DEFAULT_DURATION_MONTHS`, `X402_MAX_DURATION_MONTHS`) is shared — identical economics on both chains.

## Architecture

### x402 SDK supports this natively

From `@x402/core`:
- `RouteConfig.accepts: PaymentOption | PaymentOption[]` — one route can advertise multiple accepted (network, scheme, payTo, asset) tuples.
- `new x402ResourceServer(facilitatorClients?: FacilitatorClient | FacilitatorClient[])` — the resource server takes multiple facilitator clients; it routes verify/settle to the one that supports the chain of the payment payload.
- `register(network, scheme)` — called per network.

So the work is wiring, not protocol extension.

### Middleware changes (`src/services/x402.ts`)

Introduce `ChainConfig`:

```ts
export interface X402ChainConfig {
  network: `${string}:${string}`;
  facilitatorUrl: string;
  payTo: string;
  usdcAssetAddress: string;
  usdcAssetDecimals: number;
  usdcDomainName: string;
  usdcDomainVersion: string;
}
```

Refactor `X402PaymentConfig` so chain-specific fields move under `chains: X402ChainConfig[]` (non-empty). Shared fields (pricing, duration) stay at the top level:

```ts
export interface X402PaymentConfig {
  chains: X402ChainConfig[];          // non-empty; [Taiko, Base] in prod
  ratePerGbMonthUsd: number;
  minPriceUsd: number;
  maxPriceUsd: number;
  defaultDurationMonths: number;
  maxDurationMonths: number;
}
```

`createX402PaymentMiddleware`:
- Builds one `HTTPFacilitatorClient` per chain (skip if a pre-built facilitator is passed for tests).
- Passes the client array to `new x402ResourceServer(clients)`.
- Calls `resourceServer.register(chain.network, new ExactEvmScheme())` per chain.
- Each route's `accepts` becomes an array built by mapping over chains:
  ```ts
  accepts: config.chains.map((chain) => ({
    scheme: 'exact',
    network: chain.network,
    payTo: chain.payTo,
    extra: { name: chain.usdcDomainName, version: chain.usdcDomainVersion },
    price: async (ctx) => usdToAssetAmount(usdPrice, chain.usdcAssetAddress, chain.usdcAssetDecimals),
  }))
  ```
  Price is computed once (USD), then converted per-chain using that chain's asset address and decimals.

Chain order matters for the MPP challenge-enhancer (see below). Taiko goes first.

### Bootstrap (`src/index.ts`)

Build two `X402ChainConfig` values:
1. Taiko — from existing `config.x402*` fields
2. Base — from `BASE_CHAIN` constants + `config.x402PayTo`

Pass `{ chains: [taiko, base], …pricing }` to `createX402PaymentMiddleware`.

### MPP challenge-enhancer (`src/services/payment/challenge-enhancer.ts`)

`resolveChallengeRequirement` reads `paymentRequired.accepts[0]` to mirror the price into MPP's `WWW-Authenticate`. With multi-chain, `accepts[0]` must still yield the correct USD price. Since both chains use USDC with 6 decimals and the price is computed once in USD, `accepts[0]`'s amount (Taiko's) matches `accepts[1]`'s (Base's). Keeping Taiko at index 0 preserves the existing behavior — no enhancer changes needed.

Will add a regression test that confirms `accepts[0].amount` equals `accepts[1].amount` for the same request.

### Agent card (`src/app.ts`)

`AgentCardConfig.x402Network` + `x402UsdcAssetAddress` become arrays:

```ts
x402Chains: Array<{
  network: string;
  usdcAssetAddress: string;
  chainName?: string;   // optional human-readable label
}>;
```

The `.well-known/agent.json` handler emits one `{ protocol: 'x402', … }` entry per chain. The existing chainId→name special-case (`167000 → 'taiko'`) gains `8453 → 'base'`.

Backwards compat on the wire format: additive only. The existing `protocols` array gains a second x402 entry; no field shapes change. Clients iterating `protocols` see both; clients reading `protocols[0]` still see Taiko. `AgentCardConfig` (internal TS) does reshape.

### Data flow (per request)

```
Client → POST /pins
        ├─ with Authorization: Payment … → MPP middleware settles on Tempo, sets paymentResult → handler
        ├─ with payment-signature header → x402 middleware picks Taiko or Base based on payload.network
        │   └─ verify + settle via the matching facilitator (Taiko's or PayAI)
        └─ no payment → 402 with both x402 challenges (Taiko + Base in accepts) and MPP WWW-Authenticate
```

Wallet isolation unaffected — `extractPaidWalletFromHeader` reads `from` out of the x402 payload regardless of chain.

## Testing

**Unit — `tests/unit/x402.test.ts`**
- Route's `accepts` is an array length 2 with networks `eip155:167000` and `eip155:8453`.
- Price on both chains resolves to the same asset amount for the same size/duration.
- `payTo` on both chains reads from `config.x402PayTo`.
- Mock facilitator receives correct chain-routed calls.

**Unit — new `tests/unit/chains-base.test.ts`**
- `BASE_CHAIN` constants are exported and pinned (asset address, decimals, domain name/version).

**Integration — `tests/integration/app.test.ts`**
- 402 response on `POST /pins` with no payment: `accepts` array includes both chains, MPP `WWW-Authenticate` still present, price on `accepts[0]` equals price on `accepts[1]`.
- Agent card `payments.protocols` has two x402 entries with `chain: 'taiko'` and `chain: 'base'`.
- Existing dual-protocol Tempo/Taiko tests still pass unchanged.

**Config — `tests/unit/config.test.ts`**
- No new env vars asserted; existing prod-validation tests still pass (nothing changed at the config layer).

**No live facilitator hits** — facilitator is mocked. PayAI is not contacted in tests.

## Rollout

1. Merge + release as a minor version bump (v0.3.0 — adds a payment chain).
2. Deploy to GKE via existing `deploy-gke.yml` workflow.
3. Smoke test with `pnpm smoke:x402` pointed at production (test a Taiko payment and a Base payment; Base smoke client needs USDC-on-Base funding — bring up in a follow-up if the smoke script is Taiko-hard-coded).
4. Announce on A2A registry — Tack now accepts Base x402.

## If PayAI degrades

Code-level swap: edit `BASE_CHAIN.facilitatorUrl` to `https://x402.org/facilitator` (also permissionless; its live `/supported` endpoint returns `eip155:8453` in `kinds`, though some docs label it testnet-only) or to another ecosystem facilitator. Redeploy. No data migration.

Longer term: if Base x402 becomes load-bearing, move `facilitatorUrl` to an env var for zero-downtime swap.

## Non-obvious things to remember

- **One x402 price, two chains**: the price callback runs per-chain, but the USD number is computed once. Both chains ultimately charge the same asset amount because USDC has 6 decimals on both.
- **`accepts[0]` is Taiko by convention**: the MPP challenge-enhancer reads `accepts[0]` to mirror price. Don't reorder the chains array without updating the enhancer or adding an explicit Taiko lookup.
- **`x402ResourceServer` routes by network**: it looks at the incoming `paymentPayload.network` and picks the matching registered facilitator. Misconfiguration (e.g., payTo set to a wallet that doesn't exist on Base) shows up as a settlement failure, not a routing error.
- **Same wallet on both chains**: `X402_PAY_TO` is a plain EVM address, works on both Taiko and Base with the same private key held offline. No per-chain wallet infra.
