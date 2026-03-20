# MPP + Tempo Integration Design

**Date:** 2026-03-18
**Status:** Approved
**Goal:** Add first-class MPP (Machine Payment Protocol) support on Tempo blockchain alongside existing x402 on Taiko, using the same endpoints.

## Context

Tack is an IPFS pinning & retrieval service that currently accepts payments via x402 protocol with USDC on Taiko (chain ID 167000). MPP is a new IETF Internet-Draft (co-authored by Tempo Labs and Stripe) that formalizes HTTP 402 with a proper authentication scheme. Tempo mainnet ("Presto", chain ID 4217) launched with sub-second finality and sub-$0.001 fees.

Adding MPP on Tempo gives Tack a second payment rail with better economics and positions it in the emerging MPP ecosystem (54+ services at launch).

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Endpoint strategy | Same endpoints, both protocols | x402 uses `payment-required` header, MPP uses `WWW-Authenticate: Payment` header — no collision |
| Config model | Chain config in code, secrets in env vars | Chain determines protocol; structural config doesn't vary by environment |
| Wallet identity | Same address = same owner across chains | Both are EVM — same key produces same address. Agents can switch rails without losing pin access |
| MPP intent | Charge only | Session requires escrow contracts and complex state; zero production deployments exist. Good for v2 |
| Service discovery | 402 response headers only | The MPP spec marks OpenAPI discovery as MAY; zero of 54+ services implement it. 402 challenge is authoritative |
| Receiving wallet | Same EOA on both chains | One key, funds land on whichever chain the agent chose |

## Architecture: Protocol Detection + Dispatch

Rather than forcing both protocols into a common `PaymentHandler` interface, we use each SDK's native API and compose them with a protocol-detection middleware. This avoids fighting the mppx SDK's handler-function pattern and preserves x402's post-response settlement flow.

```
Request → ProtocolDetectionMiddleware
  ├─ Authorization: Payment header? → mppx.charge()(request) → extract wallet → Route → withReceipt
  ├─ payment-signature header?      → x402 middleware (existing flow) → extract wallet → Route → settle
  └─ Neither?                       → combine 402 challenges from both protocols → return 402
```

### Chain Configuration

```typescript
// src/services/payment/chains.ts

import type { PaymentChain } from './types.js'

export const paymentChains: PaymentChain[] = [
  {
    name: 'taiko',
    chainId: 167000,
    protocol: 'x402',
    rpcUrl: process.env.TAIKO_RPC_URL ?? 'https://rpc.mainnet.taiko.xyz',
    asset: {
      address: process.env.X402_USDC_ASSET_ADDRESS!,
      decimals: 6,
      symbol: 'USDC',
    },
    x402: {
      network: 'eip155:167000',
      facilitatorUrl: 'https://facilitator.taiko.xyz',
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
]
```

Secrets remain as env vars: `X402_PAY_TO` (shared wallet address for both chains), `WALLET_AUTH_TOKEN_SECRET`, `MPP_SECRET_KEY` (required by mppx for HMAC-bound challenge IDs).

### Types

```typescript
// src/services/payment/types.ts

export type PaymentProtocol = 'x402' | 'mpp'

export interface PaymentChain {
  name: string
  chainId: number
  protocol: PaymentProtocol
  rpcUrl: string
  asset: { address: string; decimals: number; symbol: string }
  x402?: {
    network: string
    facilitatorUrl: string
    domainName: string
    domainVersion: string
  }
  mpp?: {
    method: string
    intent: 'charge'
  }
}

export interface PaymentResult {
  wallet: string           // Payer's 0x address (normalized lowercase)
  protocol: PaymentProtocol
  chainName: string        // 'taiko' | 'tempo'
  receipt?: string         // Tx hash or settlement proof
}
```

### mppx Setup

Uses the mppx SDK's actual API. `Mppx.create()` returns handler functions accessed via `mppx.charge(options)(request)`.

```typescript
// src/services/payment/mpp.ts

import { Mppx, tempo } from 'mppx/server'
import type { PaymentResult } from './types.js'
import { extractWalletFromDid } from './wallet.js'

export function createMppInstance(payTo: string, secretKey: string) {
  return Mppx.create({
    secretKey,
    methods: [
      tempo.charge({
        currency: '0x20C000000000000000000000b9537d11c60E8b50',
        recipient: payTo,
      }),
    ],
  })
}

// The mppx charge handler returns:
//   { status: 402, challenge: Response }  — no credential present
//   { status: 200, withReceipt: (res) => res } — verified + settled
//
// mppx uses stateless HMAC verification: no database needed for challenge state.
// Settlement happens during verification (Tempo's ~500ms finality).
```

### Protocol Detection Middleware

The core middleware detects which protocol the client used and dispatches accordingly.

```typescript
// src/services/payment/middleware.ts

import type { Context, Next } from 'hono'
import { Credential } from 'mppx'
import type { PaymentResult } from './types.js'
import { extractWalletFromDid, extractWalletFromX402Header } from './wallet.js'

export function createPaymentMiddleware(
  mppx: ReturnType<typeof Mppx.create>,
  x402Config: X402PaymentConfig,
  payTo: string,
  priceFn: (c: Context) => string | null,  // Route-specific price; null = free (no payment required)
) {
  return async (c: Context, next: Next) => {
    const priceUsd = priceFn(c)

    // --- No payment required (e.g., free retrieval) ---
    if (priceUsd === null) return next()

    const authHeader = c.req.header('Authorization')
    const paymentSigHeader = c.req.header('payment-signature')

    // --- MPP credential present ---
    if (authHeader?.startsWith('Payment ')) {
      const result = await mppx.charge({ amount: priceUsd })(c.req.raw)

      if (result.status === 402) {
        // Credential was present but invalid — return MPP-specific 402
        return result.challenge
      }

      // Payment verified + settled. Extract wallet from credential.
      const wallet = extractMppWallet(authHeader)
      c.set('paymentResult', {
        wallet,
        protocol: 'mpp',
        chainName: 'tempo',
      } satisfies PaymentResult)

      await next()
      c.res = result.withReceipt(c.res)  // Attach Payment-Receipt header
      return
    }

    // --- x402 credential present ---
    if (paymentSigHeader) {
      // Delegate to existing x402 flow (facilitator verification + post-response settlement)
      // This preserves x402's verify-then-settle-after-response pattern
      return await handleX402Payment(c, next, paymentSigHeader, x402Config, payTo)
    }

    // --- No credential — return 402 with BOTH challenges ---
    const mppResult = await mppx.charge({ amount: priceUsd })(c.req.raw)
    // mppResult.status === 402 since no MPP credential
    const mppChallengeResponse = mppResult.challenge

    // Build x402 challenge
    const x402Challenge = buildX402ChallengeHeader(priceUsd, x402Config, payTo)

    // Compose: copy MPP's WWW-Authenticate + x402's payment-required into one 402
    const body = mppChallengeResponse.body
    const response = new Response(body, {
      status: 402,
      headers: new Headers(mppChallengeResponse.headers),
    })
    response.headers.set('payment-required', x402Challenge)
    return response
  }
}

function extractMppWallet(authHeader: string): string {
  // Parse "Payment <base64url>" credential to get source DID
  const base64url = authHeader.slice('Payment '.length)
  const credential = Credential.deserialize(base64url)

  if (credential.source) {
    return extractWalletFromDid(credential.source)
  }

  // Fallback: if source is absent, extract from transaction payload
  // For tempo/charge, the signed transaction always has a from address
  throw new Error('MPP credential missing source field — cannot determine payer wallet')
}
```

**Key design points:**

1. **Protocol detection** is simple header inspection: `Authorization: Payment` vs `payment-signature`.
2. **mppx handles its own challenge/verify/settle cycle** via `mppx.charge(options)(request)` — we don't reimplement this.
3. **x402 retains its existing flow**: facilitator verification, post-response settlement, existing error handling. The x402 internals are preserved, not forced into a different shape.
4. **`priceFn` parameter**: Price calculation is route-specific (different for `/pins` vs `/upload` vs `/ipfs/:cid`). The middleware accepts a function to compute price from request context.
5. **Post-response receipt**: `result.withReceipt(c.res)` is called after `next()`, matching mppx's design where settlement happens during verification but the receipt header is attached after the route handler runs.

### Authorization Header Disambiguation

Both MPP and wallet auth use the `Authorization` header with different schemes. The existing `getWalletAuthToken()` in wallet-auth must be updated:

```typescript
// src/services/wallet-auth.ts — updated getWalletAuthToken()

export function getWalletAuthToken(req: Request): { token: string | null; malformed: boolean } {
  const authHeader = req.headers.get('Authorization')
    ?? req.headers.get('x-wallet-auth-token')

  if (!authHeader) return { token: null, malformed: false }

  // MPP credentials use "Payment " scheme — not a wallet auth token
  if (authHeader.startsWith('Payment ')) return { token: null, malformed: false }

  if (authHeader.startsWith('Bearer ')) {
    return { token: authHeader.slice(7), malformed: false }
  }

  // Unrecognized scheme
  return { token: null, malformed: true }
}
```

This ensures `Authorization: Payment <credential>` is treated as "no wallet auth token present" rather than "malformed token", allowing the payment middleware to handle it instead.

### Wallet Extraction Utilities

```typescript
// src/services/payment/wallet.ts

/**
 * Extract 0x address from DID PKH format.
 * Input: "did:pkh:eip155:4217:0xABC..."
 * Output: "0xabc..." (normalized lowercase)
 */
export function extractWalletFromDid(did: string): string {
  // did:pkh:eip155:<chainId>:<address>
  const parts = did.split(':')
  if (parts.length < 5 || parts[0] !== 'did' || parts[1] !== 'pkh') {
    throw new Error(`Invalid DID format: ${did}`)
  }
  return normalizeAddress(parts[4])
}

/**
 * Normalize EVM address to lowercase with 0x prefix.
 * Validates format: 0x-prefixed, 40 hex chars.
 */
export function normalizeAddress(address: string): string {
  const normalized = address.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`Invalid EVM address: ${address}`)
  }
  return normalized
}

/**
 * Extract wallet from x402 payment-signature header.
 * Re-exported from the existing x402 module.
 */
export { extractPaidWalletFromHeader as extractWalletFromX402Header } from '../x402.js'
```

### x402 Compatibility Layer

Rather than rewriting x402's 800-line middleware, we extract only what the unified middleware needs:

```typescript
// src/services/payment/x402-compat.ts

/**
 * Build the x402 `payment-required` header value for a 402 response.
 * Extracted from the existing x402 challenge-building logic.
 */
export function buildX402ChallengeHeader(
  priceUsd: string,
  config: X402PaymentConfig,
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
  })
}

/**
 * Handle x402 payment flow — wraps existing x402HTTPResourceServer.
 *
 * The current x402 middleware is deeply integrated with x402HTTPResourceServer
 * from @x402/core, which manages: facilitator client, payment verification,
 * post-response settlement, permit2 error handling, and settlement failure
 * body construction. Rather than extracting this into a standalone function,
 * we wrap the existing middleware and intercept the wallet to set paymentResult.
 *
 * Implementation approach:
 * 1. Create a stripped-down x402HTTPResourceServer configured for a single
 *    route (not the current RoutesConfig multi-route pattern).
 * 2. Call its processPayment() to verify the credential with the facilitator.
 * 3. Extract wallet via extractPaidWalletFromHeader() and set paymentResult.
 * 4. Call next() to run the route handler.
 * 5. Call processSettlement() to settle the payment post-response.
 * 6. Attach payment-response header to c.res.
 *
 * This preserves x402's verify → route → settle lifecycle while providing
 * the paymentResult interface that route handlers expect.
 */
export async function handleX402Payment(
  c: Context,
  next: Next,
  paymentSigHeader: string,
  x402Server: X402HTTPResourceServer,  // existing server instance
  payTo: string,
): Promise<Response | void> {
  // 1. Extract wallet from payment-signature header
  const wallet = extractPaidWalletFromHeader(paymentSigHeader)
  if (!wallet) {
    return c.json({ error: 'Invalid payment signature' }, 400)
  }

  // 2. Verify payment with facilitator (pre-route)
  const verification = await x402Server.processPayment(c.req.raw)
  if (!verification.success) {
    return c.json(verification.error, 402)
  }

  // 3. Set payment result for route handler
  c.set('paymentResult', {
    wallet,
    protocol: 'x402',
    chainName: 'taiko',
  } satisfies PaymentResult)

  // 4. Run route handler
  await next()

  // 5. Settle payment (post-route) via facilitator
  const settlement = await x402Server.processSettlement(c.req.raw, c.res)
  if (settlement.receiptHeader) {
    c.res.headers.set('payment-response', settlement.receiptHeader)
  }
}

// Re-export existing wallet extraction function
export { extractPaidWalletFromHeader } from '../x402.js'
```

### Error Handling

MPP errors map to HTTP responses via mppx's built-in error handling:

| mppx Error | HTTP Status | Behavior |
|------------|-------------|----------|
| `MalformedCredentialError` | 402 | Fresh challenge + RFC 9457 problem details |
| `InvalidChallengeError` | 402 | Challenge HMAC mismatch — fresh challenge |
| `PaymentExpiredError` | 402 | Expired credential — fresh challenge |
| `VerificationFailedError` | 402 | Payment proof invalid — fresh challenge |
| `PaymentInsufficientError` | 402 | Amount too low — fresh challenge with correct amount |
| `BadRequestError` | 400 | Malformed request |

mppx's `charge()(request)` handles all these internally — on any verification failure, it returns `{ status: 402, challenge: Response }` with appropriate RFC 9457 problem details in the body. We don't need custom error handling; the 402 response is self-describing.

For the unified middleware, if mppx returns 402 when a credential IS present (indicating verification failure), we return it directly. The x402 path uses its existing error handling (facilitator errors, settlement failures).

## File Structure

```
src/services/
  payment/
    types.ts               # PaymentChain, PaymentResult, PaymentProtocol
    chains.ts              # Taiko + Tempo chain config array
    middleware.ts          # Protocol detection + dispatch middleware
    mpp.ts                 # mppx instance creation + config
    pricing.ts             # calculatePriceUsd (moved from x402.ts)
    wallet.ts              # Address normalization, DID parsing
    x402-compat.ts         # x402 challenge builder + payment flow wrapper
  wallet-auth.ts           # JWT create/verify (extracted from x402.ts, updated for Payment scheme)
  x402.ts                  # Kept but reduced — complex internals used by x402-compat.ts
  rate-limiter.ts          # Untouched
  content-cache.ts         # Untouched
  ...
```

### What moves where

| Concern | From | To |
|---------|------|----|
| 402 challenge building (x402) | `x402.ts` | `payment/x402-compat.ts` (extracted) |
| x402 verify + settle flow | `x402.ts` | `payment/x402-compat.ts` (wraps existing) |
| Wallet extraction from x402 proof | `x402.ts` | `payment/wallet.ts` (re-exported) |
| DID-based wallet extraction (new) | — | `payment/wallet.ts` |
| Address normalization | `x402.ts` | `payment/wallet.ts` |
| Price calculation | `x402.ts` | `payment/pricing.ts` |
| JWT token create/verify | `x402.ts` | `wallet-auth.ts` |
| Authorization header disambiguation | `x402.ts` | `wallet-auth.ts` (updated) |
| mppx instance + config | — | `payment/mpp.ts` (new) |
| Protocol detection + dispatch | — | `payment/middleware.ts` (new) |
| Rate limiting | `rate-limiter.ts` | Untouched |

**Note:** `x402.ts` is NOT deleted. Its complex internals (facilitator client, route-level config, settlement flow, permit2 handling) are used by `x402-compat.ts`. Over time, as MPP adoption grows, x402 code can be sunset.

## Route Changes

### Migration from global to per-route middleware

The current app applies x402 payment middleware globally via `app.use(services.paymentMiddleware)` with route-matching logic inside the x402 middleware (`RoutesConfig`, `requiresPayment()`). This changes to **per-route middleware** where each payment-gated route explicitly applies the payment middleware.

**`AppServices` interface changes:**
- Remove `paymentMiddleware` from `AppServices` (the global x402 middleware)
- Add `mppx` instance and payment middleware factories instead
- The global `app.use(services.paymentMiddleware)` line is removed from `createApp()`

**`requirePaidWallet()` is replaced:**
The current `requirePaidWallet(headers)` function reads the `payment-signature` header directly. This does not work for MPP (where the credential is in `Authorization: Payment`). Instead, route handlers read from Hono context:

```typescript
// Before:
const wallet = requirePaidWallet(c.req.raw.headers) // reads payment-signature header

// After:
const { wallet, protocol, chainName } = c.get('paymentResult') // set by middleware
```

**`AppEnv` type must be extended:**

```typescript
// Hono app environment
type AppEnv = {
  Variables: {
    // existing:
    walletAddress?: string
    walletAuthError?: string
    // new:
    paymentResult?: PaymentResult  // set by payment middleware
  }
}
```

### Per-route middleware wiring

```typescript
// src/app.ts (changes)

import { createPaymentMiddleware } from './services/payment/middleware.js'
import { createMppInstance } from './services/payment/mpp.js'
import { calculatePinPrice, calculateUploadPrice } from './services/payment/pricing.js'

const mppx = createMppInstance(config.payTo, config.mppSecretKey)

const pinPayment = createPaymentMiddleware(mppx, x402Config, config.payTo, calculatePinPrice)
const uploadPayment = createPaymentMiddleware(mppx, x402Config, config.payTo, calculateUploadPrice)

app.post('/pins', pinPayment, async (c) => {
  const { wallet, protocol, chainName } = c.get('paymentResult')
  logger.info({ wallet, protocol, chainName }, 'pin payment received')

  // JWT token issuance — same as today, wallet is protocol-agnostic
  const token = createWalletAuthToken(wallet, authConfig)
  c.header('x-wallet-auth-token', token)
  // ... rest unchanged
})

app.post('/upload', uploadPayment, async (c) => {
  // Same pattern
})
```

### Retrieval paywall (conditional payment)

`GET /ipfs/:cid` is free by default but paywalled if `meta.retrievalPrice` is set. The `priceFn` handles this:

```typescript
// Price function returns null to skip payment
function calculateRetrievalPrice(c: Context): string | null {
  const pin = lookupPin(c.req.param('cid'))
  if (!pin?.meta?.retrievalPrice) return null  // Free — no payment required
  return pin.meta.retrievalPrice
}

// Middleware factory accepts nullable price
const retrievalPayment = createPaymentMiddleware(mppx, x402Config, config.payTo, calculateRetrievalPrice)

app.get('/ipfs/:cid', retrievalPayment, async (c) => {
  // If priceFn returned null, middleware called next() without payment
  // If priceFn returned a price, paymentResult is set
  // ...
})
```

The `createPaymentMiddleware` must handle the `null` return from `priceFn` by calling `next()` directly (no payment required for this request).

**What stays the same:**
- All owner endpoints (JWT-based, no payment middleware)
- Health check, landing page
- Request validation, pin creation logic, upload handling

**What changes:**
- Global `app.use(services.paymentMiddleware)` removed; per-route middleware applied
- `requirePaidWallet()` replaced by `c.get('paymentResult')`
- `AppEnv` Variables extended with `paymentResult`
- `AppServices` removes `paymentMiddleware`, adds mppx/payment factory
- Payment middleware is now protocol-aware
- `PaymentResult` includes `protocol` and `chainName` for logging/analytics
- 402 responses include both x402 and MPP challenges

## Config Changes

New env vars required:

| Variable | Purpose | Required |
|----------|---------|----------|
| `MPP_SECRET_KEY` | HMAC secret for mppx stateless challenge binding | Yes (production) |

Production validation in `config.ts` should:
- Reject `MPP_SECRET_KEY` if less than 32 bytes or placeholder values
- Keep existing `X402_PAY_TO` validation (shared across both protocols)

Tempo chain config (RPC URL, asset address, chain ID) is hardcoded — these are protocol constants that don't change per environment.

## Agent Card Update

`/.well-known/agent.json` adds MPP payment info alongside existing x402 info. Existing fields are preserved for backward compatibility; new `payments.protocols` array added:

```json
{
  "capabilities": {
    "payments": {
      "protocols": [
        {
          "protocol": "x402",
          "chain": "taiko",
          "chainId": 167000,
          "asset": "USDC",
          "network": "eip155:167000"
        },
        {
          "protocol": "mpp",
          "method": "tempo",
          "chain": "tempo",
          "chainId": 4217,
          "asset": "USDC.e",
          "intent": "charge"
        }
      ],
      "pricing": {
        "base": "0.001",
        "perMb": "0.001",
        "max": "0.01",
        "currency": "USD"
      }
    }
  }
}
```

Existing `pricing` fields in the agent card are preserved alongside the new structure to avoid breaking current consumers.

## Dependencies

**New:** `mppx` (v0.4.x) — MPP server SDK. Handles challenge generation, credential verification, and Tempo settlement. Uses `viem` internally (already a dependency).

**Import paths** (subject to verification after `pnpm add mppx` — SDK is new and evolving):
- `mppx/server` — Core server: `Mppx.create()`, `tempo.charge()`, `Expires`, `Store`
- `mppx/hono` — Hono middleware adapter (alternative to manual middleware)
- `mppx` — Core types: `Credential.deserialize()` for parsing payment credentials

**Implementation note:** Before writing code, run `pnpm add mppx` and verify these exports match. If `mppx/hono` provides a suitable middleware, prefer it over manual `mppx/server` integration — it handles the `charge()(request)` → Hono `MiddlewareHandler` conversion automatically.

## Testing

| Test file | Coverage |
|-----------|----------|
| `unit/payment/pricing.test.ts` | Price calculation (same cases as current x402 tests) |
| `unit/payment/wallet.test.ts` | `normalizeAddress`, `extractWalletFromDid` (valid DIDs, invalid formats, missing parts) |
| `unit/payment/middleware.test.ts` | Protocol detection: MPP credential routes to mppx, x402 credential routes to x402, no credential returns 402 with both `WWW-Authenticate` and `payment-required` headers |
| `unit/payment/mpp.test.ts` | mppx instance creation with correct config |
| `unit/payment/x402-compat.test.ts` | Challenge header format matches current x402 spec |
| `unit/wallet-auth.test.ts` | JWT create/verify + `Authorization: Payment` treated as non-malformed (not a wallet auth token) |
| `integration/mpp-smoke.ts` | E2E: endpoint → 402 with both challenges → pay via mppx client on Tempo testnet → verify pin created with correct owner |

**Testnet:** Tempo Moderato (chain ID 42431, RPC `https://rpc.moderato.tempo.xyz`). Faucet: `cast rpc tempo_fundAddress <addr>`.

## Future Work (Out of Scope)

- **Session intent**: Streaming payment channels for per-byte retrieval billing
- **Stripe MPP method**: Accept fiat card payments via `method="stripe"` with Stripe Payment Tokens
- **OpenAPI discovery**: `x-payment-info` extension if ecosystem adoption grows
- **`/llms.txt` endpoint**: Agent-friendly service description via mppx proxy format
- **MPP directory listing**: Submit PR to `tempoxyz/mpp` to list Tack in the payments directory
- **x402 sunset**: Once MPP adoption is sufficient, remove x402 code path
