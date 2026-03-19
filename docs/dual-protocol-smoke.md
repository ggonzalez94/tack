# Dual-Protocol Payment Smoke Test

Validates MPP (Tempo) and x402 (Taiko) payment flows against a local Tack instance with real on-chain settlement.

## Prerequisites

- **Tempo CLI** with wallet: `tempo wallet whoami` shows a funded USDC.e balance
- **Docker**: for running Kubo IPFS locally
- **pnpm**: project dependencies installed (`pnpm install`)
- For x402 regression: a Taiko wallet private key with USDC balance

## Start the Stack

```bash
# Terminal 1: Start IPFS
docker compose up ipfs

# Terminal 2: Start Tack with both protocols
WALLET_AUTH_TOKEN_SECRET="local-smoke-test-secret-32-bytes-min" \
MPP_SECRET_KEY="local-smoke-mpp-secret-32-bytes-min!!" \
X402_PAY_TO="<your-wallet-address>" \
X402_USDC_ASSET_ADDRESS="<taiko-usdc-address>" \
IPFS_API_URL="http://localhost:5001" \
DELEGATE_URL="http://localhost:8080/ipfs" \
pnpm dev
```

Wait for `tack listening` log and verify:

```bash
curl -s http://localhost:3000/health | jq .
# Expected: {"status":"ok","dependencies":{"ipfs":"ok"}}
```

## Test 1: Dual-Challenge 402 Response

An unpaid request must return 402 with both x402 and MPP challenge headers.

```bash
curl -si http://localhost:3000/pins \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"cid":"QmTest123"}'
```

**Pass criteria:**
- Status: `402 Payment Required`
- Header `payment-required` present (x402 challenge, base64-encoded JSON)
- Header `www-authenticate` present with `Payment id=..., method="tempo", intent="charge"`

**Note:** The first request after startup may return 500 while the x402 facilitator initializes. Retry after 5 seconds.

## Test 2: MPP Upload

Upload a file paying via MPP on Tempo.

```bash
echo "MPP smoke test - $(date -u +%Y-%m-%dT%H:%M:%SZ)" > /tmp/mpp-smoke.txt
tempo request http://localhost:3000/upload \
  -X POST \
  -F "file=@/tmp/mpp-smoke.txt;type=text/plain" \
  -v
```

**Pass criteria:**
- Output shows `Payment required: intent=charge network=tempo amount=0.001 USDC`
- Output shows `Paid 0.001 USDC` with a transaction hash
- Response body contains `{"cid":"Qm..."}`

Save the CID for subsequent tests:
```bash
export SMOKE_CID="<cid-from-response>"
```

## Test 3: MPP Pin

Pin the uploaded CID paying via MPP.

```bash
tempo request http://localhost:3000/pins \
  -X POST \
  --json "{\"cid\":\"$SMOKE_CID\",\"name\":\"mpp-smoke-pin\"}" \
  -D /tmp/mpp-pin-headers.txt \
  -v
```

**Pass criteria:**
- Output shows payment + settlement on Tempo
- Response body: `{"requestid":"...","status":"pinned",...}`
- Headers file contains `x-wallet-auth-token` (JWT for owner endpoints)
- Headers file contains `payment-receipt` (MPP settlement proof)

Save the JWT and request ID:
```bash
export SMOKE_JWT=$(grep -i 'x-wallet-auth-token:' /tmp/mpp-pin-headers.txt | head -1 | awk '{print $2}' | tr -d '\r')
export SMOKE_REQUEST_ID="<requestid-from-response>"
```

## Test 4: Owner Endpoints with MPP-Issued JWT

The JWT from an MPP-paid request must work on owner endpoints.

```bash
# List all pins owned by this wallet
curl -s http://localhost:3000/pins \
  -H "Authorization: Bearer $SMOKE_JWT" | jq '.count, (.results[] | {requestid, cid: .pin.cid, name: .pin.name})'

# Get specific pin
curl -s http://localhost:3000/pins/$SMOKE_REQUEST_ID \
  -H "Authorization: Bearer $SMOKE_JWT" | jq '{requestid, status, cid: .pin.cid}'
```

**Pass criteria:**
- GET /pins returns the MPP-created pins
- GET /pins/:requestid returns the specific pin with status `pinned`
- Wallet in JWT sub claim matches Tempo wallet address

## Test 5: Free Retrieval

Content retrieval should work without payment.

```bash
curl -si http://localhost:3000/ipfs/$SMOKE_CID | head -15
```

**Pass criteria:**
- Status: `200 OK`
- Body contains the uploaded file content
- No payment headers in the response

## Test 6: Agent Card

The agent card must advertise both payment protocols.

```bash
curl -s http://localhost:3000/.well-known/agent.json | jq '.payments'
```

**Pass criteria:**
- `protocols` array has two entries
- Entry 1: `protocol: "x402"`, `chain: "taiko"`, `chainId: 167000`
- Entry 2: `protocol: "mpp"`, `method: "tempo"`, `chain: "tempo"`, `chainId: 4217`, `asset: "0x20C0...8b50"`
- `pricing` section shows base/perMb/max in USD

## Test 7: x402 Regression (Optional)

Run the existing x402 smoke test to confirm no regression. Requires a funded Taiko wallet.

```bash
SMOKE_API_BASE_URL="http://localhost:3000" \
SMOKE_RPC_URL="https://rpc.mainnet.taiko.xyz" \
SMOKE_CHAIN_ID="167000" \
SMOKE_PAYER_PRIVATE_KEY="0x<funded-taiko-wallet-key>" \
pnpm smoke:x402
```

**Pass criteria:** Full flow passes — upload, pin, retrieve, settlement on Taiko.

## Cost Estimate

| Protocol | Operations | Estimated Cost |
|----------|-----------|---------------|
| MPP (Tempo) | 3 charges (upload + 2 pins) | ~$0.003 + negligible gas |
| x402 (Taiko) | 2 charges (upload + pin) | ~$0.002 + gas |

## Known Issues / Gotchas

1. **First request may fail with 500**: The x402 facilitator needs to initialize on the first payment-gated request. Retry after a few seconds.

2. **Hono `/path` vs `/path/*` double-match**: Hono matches both `/pins` and `/pins/*` for `POST /pins`. The MPP middleware must NOT be registered on `/pins/*` to avoid double-execution (which causes Tempo nonce replay errors).

3. **Challenge enhancer must run BEFORE x402 middleware**: The enhancer needs to wrap x402 so it can intercept x402's 402 response and add the MPP `WWW-Authenticate` header. Registering it AFTER x402 won't work because x402 returns the 402 directly without calling `next()`.

4. **MPP amount is USD string, x402 amount is asset-denominated**: The `priceFn` returns USD (e.g., `"0.001"`) which mppx expects. The x402 challenge header uses micro-USDC (e.g., `"1000"` for $0.001). These are different values for the same price.
