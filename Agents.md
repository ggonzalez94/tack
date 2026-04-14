# Tack — Agent Context

IPFS pinning & retrieval service with x402 payments. TypeScript, Hono, Kubo IPFS, SQLite.

## Project Structure

```
src/
  index.ts                    # Entry point: wiring, config, process lifecycle
  app.ts                      # Hono routes, middleware, request validation, A2A agent card
  config.ts                   # Env-driven config with production validation
  db.ts                       # SQLite setup (better-sqlite3)
  types.ts                    # Shared types (Pin, PinStatus, etc.)
  lib/errors.ts               # Typed error classes (ValidationError, NotFoundError, etc.)
  services/
    pinning-service.ts        # Core business logic: pin CRUD + upload + replication
    ipfs-rpc-client.ts        # Kubo RPC client (pin/add/cat/unpin)
    x402.ts                   # x402 (Taiko) payment middleware + retrieval gating
    wallet-auth.ts            # JWT token create/verify for owner endpoints
    payment/
      types.ts                # PaymentChain, PaymentResult, PaymentProtocol
      chains.ts               # Taiko + Tempo chain config
      pricing.ts              # Price calc + USD asset/decimal formatting
      http.ts                 # Shared HTTP helpers (Authorization + /ipfs path)
      mpp.ts                  # mppx instance factory (Tempo/USDC.e)
      middleware.ts           # MPP credential → charge + paymentResult
      challenge-enhancer.ts   # Adds MPP WWW-Authenticate to x402 402s
      mpp-payer.ts            # Verifies MPP payer from on-chain Transfer event
    rate-limiter.ts           # Per-wallet/IP rate limiting
    content-cache.ts          # In-memory LRU cache for gateway responses
    content-type.ts           # MIME type detection
    logger.ts                 # Pino structured logging
  repositories/
    pin-repository.ts         # SQLite persistence, query filtering, owner isolation
tests/
  unit/                       # Unit tests
  integration/                # Integration tests
scripts/
  backup-db.sh                # SQLite backup script
```

## Tech Stack

- **Runtime**: Node.js 20+, TypeScript, pnpm
- **Framework**: Hono (`@hono/node-server`)
- **IPFS**: Kubo via HTTP RPC
- **Database**: SQLite via `better-sqlite3`
- **Payments**: x402 protocol (`@x402/core`, `@x402/evm`, `@x402/hono`), USDC on Taiko Alethia
- **MPP**: mppx SDK, USDC.e on Tempo
- **Testing**: Vitest
- **Logging**: Pino

## Standards & Protocols

- [IPFS Pinning Service API spec](https://ipfs.github.io/pinning-services-api-spec/) — all pin endpoints conform to this
- [x402 protocol](https://www.x402.org/) — HTTP 402 machine-readable payment flow
- [A2A (Agent-to-Agent)](https://google.github.io/A2A/) — agent card at `/.well-known/agent.json`
- EIP-3009 (`transferWithAuthorization`) — used for x402 USDC settlement on Taiko
- [MPP (Machine Payment Protocol)](https://mpp.dev/) — HTTP 402 payment scheme on Tempo blockchain

## Deployment

- **Production**: Railway (API + Kubo as separate services, persistent volumes)
- **Config**: Entirely env-driven. See `.env.example`
- **Docker**: `docker compose up --build` for local full stack
- **Build**: `pnpm build` compiles to `dist/`, `node dist/index.js` to run

## Non-Obvious Things

- **Wallet = identity**: There are no user accounts. The wallet that pays via x402 owns the pin. Owner endpoints enforce wallet isolation at the repository level.
- **Production startup validation**: `config.ts` rejects placeholder EVM addresses and requires `X402_ENABLED=true` when `NODE_ENV=production`. The app will crash on boot if misconfigured.
- **Price is dynamic**: `x402.ts` calculates price as `base + (size_mb * per_mb)`, capped at `max`. The 402 response includes the exact amount.
- **Replication is best-effort**: Primary pin must succeed. Replica failures are recorded in `PinStatus.info.replication` but don't fail the request.
- **Gateway is optional paywall**: Content retrieval is free by default; owners can set `meta.retrievalPrice` to gate content behind x402.
- **SQLite single-writer**: Only 1 API replica in production. No WAL mode tricks — just one process.
- **Rate limiter is in-memory**: Resets on restart. Keyed by wallet address (authenticated) or IP (unauthenticated).
- **Dual-protocol payments**: Tack accepts both x402 (Taiko/USDC) and MPP (Tempo/USDC.e). Same endpoints serve both. Protocol detection is header-based: `payment-signature` → x402, `Authorization: Payment` → MPP. MPP is opt-in via `MPP_SECRET_KEY` env var.
- **Dual-challenge 402s**: An unpaid request gets BOTH `payment-required` (x402) and `WWW-Authenticate: Payment` (MPP) in the same 402. `challenge-enhancer.ts` wraps x402 middleware so MPP's `WWW-Authenticate` is grafted onto x402's 402 response post-hoc. Tests live in `tests/integration/app.test.ts > dual-protocol`.
- **MPP settles before the handler, x402 settles after**: mppx verifies + broadcasts the Tempo transaction during `charge()`, while x402 settles via the facilitator post-response.
- **MPP ownership comes from on-chain evidence, never `credential.source`**: The MPP credential has an optional `source` DID that is *client-controlled metadata* — `Credential.deserialize` spreads it through unverified, and the Tempo `verify()` never checks it. Trusting `source` would let a paying attacker mint owner-scoped JWTs for any victim wallet (forged `did:pkh:eip155:4217:<victim>`). Instead, `mpp-payer.ts` pulls the settled tx hash out of the mppx `Payment-Receipt` header, re-reads the Tempo receipt via a viem public client, and returns the `from` field of the matching TIP-20 `Transfer`/`TransferWithMemo` event. That EOA is the token holder who authorized the spend and is the canonical payer regardless of fee-payer relaying. Regression test: `tests/integration/app.test.ts > dual-protocol > ignores a forged credential.source`.
