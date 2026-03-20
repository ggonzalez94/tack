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
    payment/
      types.ts              # PaymentChain, PaymentResult, PaymentProtocol
      chains.ts             # Taiko + Tempo chain config
      middleware.ts         # MPP payment middleware
      mpp.ts                # mppx instance factory
      pricing.ts            # Price calculation (shared)
      wallet.ts             # Address normalization, DID parsing
      x402-compat.ts        # x402 challenge builder
    wallet-auth.ts          # JWT token create/verify
    rate-limiter.ts           # Per-wallet/IP rate limiting
    content-cache.ts          # In-memory LRU cache for gateway responses
    content-type.ts           # MIME type detection
    logger.ts                 # Pino structured logging
  repositories/
    pin-repository.ts         # SQLite persistence, query filtering, owner isolation
tests/
  unit/                       # Unit tests
  integration/                # Integration tests
docs/
  railway-deployment.md       # Railway deployment runbook
  deployment-smoke.md         # x402 smoke test runbook
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
