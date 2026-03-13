# Taiko x402 Smoke Validation Runbook

This runbook verifies real x402 settlement on Taiko Alethia against a live Tack deployment.

## Scope

The smoke flow validates the production-critical `POST /pins` payment path:

1. Unpaid request returns `402 Payment Required` with `payment-required` header.
2. Client settles payment via x402 facilitator.
3. Retried request with `payment-signature` returns `202`, includes `payment-response`, and issues an owner auth token.
4. Settlement response is validated (`success=true`, expected network, transaction hash).

## Prerequisites

- Live Tack deployment reachable via HTTPS.
- Deployment configured with real Taiko x402 settings:
  - `X402_NETWORK=eip155:167000`
  - `X402_PAY_TO=<treasury wallet>`
  - `X402_USDC_ASSET_ADDRESS=<Taiko USDC contract>`
  - `WALLET_AUTH_TOKEN_SECRET=<strong random secret>`
- Smoke payer wallet private key with spendable Taiko USDC.
- RPC endpoint for Taiko Alethia.

## Local/Manual Execution

Run from repository root:

```bash
SMOKE_API_BASE_URL="https://<your-api-domain>" \
SMOKE_RPC_URL="https://rpc.mainnet.taiko.xyz" \
SMOKE_CHAIN_ID="167000" \
SMOKE_PAYER_PRIVATE_KEY="0x<funded-wallet-private-key>" \
pnpm smoke:x402
```

Optional:

- `SMOKE_CID` overrides the CID used in the pin request.
- `SMOKE_REQUEST_TIMEOUT_MS` sets per-request timeout (default `45000`).

## CI Execution (GitHub Actions)

Use workflow `.github/workflows/x402-taiko-smoke.yml` via `workflow_dispatch`.

Required:

- Repo secret: `X402_SMOKE_PAYER_PRIVATE_KEY`
- Input: `api_base_url` (deployment URL)

Optional inputs:

- `rpc_url` (default `https://rpc.mainnet.taiko.xyz`)
- `chain_id` (default `167000`)
- `cid` (default smoke CID)

## Success Criteria

A run is successful only if all checks pass:

- First `POST /pins` response is exactly `402`.
- Second `POST /pins` response is exactly `202`.
- Response includes a non-empty `requestid`.
- Settlement header decodes to:
  - `success: true`
  - `network: eip155:167000` (or configured `SMOKE_CHAIN_ID`)
  - `transaction` present and hex-prefixed.

The smoke runner prints a JSON summary including `requestId`, accepted payment requirement, and settlement transaction hash.
