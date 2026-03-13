# Tack

**Pin to IPFS. Pay with your wallet. No account needed.**

Tack is an IPFS pinning and retrieval service where payment *is* the authentication. No API keys, no signup, no monthly plans. Send a request with a wallet, pay per-use via [x402](https://www.x402.org/), and your content is pinned.

Built for AI agents, developer tooling, and any machine that needs to store data on IPFS without a human creating an account first.

## Live Endpoints

| Endpoint | URL |
|---|---|
| API | `https://tack-api-production.up.railway.app` |
| Health | `GET /health` |
| Agent Card (A2A) | `GET /.well-known/agent.json` |
| IPFS Gateway | `GET /ipfs/<cid>` |

## Quickstart

```bash
# Pin content (first call returns 402 with payment requirements)
curl -X POST https://tack-api-production.up.railway.app/pins \
  -H 'content-type: application/json' \
  -d '{"cid":"bafybeigdyrzt...","name":"example.txt"}'

# After x402 payment, retry with signature
curl -X POST https://tack-api-production.up.railway.app/pins \
  -H 'content-type: application/json' \
  -H 'payment-signature: <x402-payment-signature>' \
  -d '{"cid":"bafybeigdyrzt...","name":"example.txt"}'

# Save the owner token returned in the response headers and use it on owner routes
curl https://tack-api-production.up.railway.app/pins/<requestid> \
  -H 'Authorization: Bearer <x-wallet-auth-token>'
```

## API

Implements the [IPFS Pinning Service API](https://ipfs.github.io/pinning-services-api-spec/) spec.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/pins` | x402 payment | Pin a CID |
| `POST` | `/upload` | x402 payment | Upload a file and pin it |
| `GET` | `/pins` | Wallet identity | List your pins |
| `GET` | `/pins/:requestid` | Wallet identity | Get pin status |
| `POST` | `/pins/:requestid` | Wallet identity | Replace a pin |
| `DELETE` | `/pins/:requestid` | Wallet identity | Delete a pin |
| `GET` | `/ipfs/:cid` | None | Retrieve content (supports ETag, Range) |
| `GET` | `/health` | None | Service health check |
| `GET` | `/.well-known/agent.json` | None | A2A agent discovery |

**Pricing**: $0.001 base + $0.001/MB per pin operation, settled in USDC on Taiko Alethia via x402.

**Auth model**: Paid endpoints use `payment-signature` (x402). Successful paid responses return a short-lived `x-wallet-auth-token` response header. Owner endpoints (list, get, replace, delete) require that bearer token. The wallet that pays owns the pin.

**Gateway safety**: Tack serves browser-active content types with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` so HTML/SVG/JS payloads are not executed inline from the API origin.

**Retrieval pricing**: `meta.retrievalPrice` is controlled by the first wallet that pins a CID through Tack. Later pins of the same CID cannot redirect premium retrieval payouts.

## For AI Agents

Tack exposes an [A2A](https://google.github.io/A2A/) agent card at `/.well-known/agent.json`. An agent with a wallet can discover Tack, pin content, and pay — no human in the loop.

## Limitations

Tack is on its early stages, so the infrastructure and replication guarantees are limited. Do not pin critical files you depend on yet.

| Limitation | Impact |
|---|---|
| **SQLite single-writer** | API limited to 1 replica; no horizontal scaling |
| **Single Kubo node** | Pinned content lives on one IPFS instance; no replication |
| **Railway single-AZ volumes** | No automatic recovery if volume is lost |
| **No automated backups** | Manual `scripts/backup-db.sh` before deploys |
| **Kubo ephemeral networking** | DHT presence resets on every deploy; slower P2P discovery |

## Development

```bash
git clone <repo-url> && cd tack
pnpm install
cp .env.example .env
pnpm dev          # API on http://localhost:3000
```

Full stack with Docker:

```bash
docker compose up --build
# API: http://localhost:3000 | Kubo RPC: http://localhost:5001 | Gateway: http://localhost:8080
```

Key commands:

```bash
pnpm test         # Run tests (vitest)
pnpm build        # Compile TypeScript
pnpm smoke:x402   # End-to-end x402 payment smoke test
```

See `.env.example` for all configuration options. Deployment docs live in `docs/`.

## License

MIT
