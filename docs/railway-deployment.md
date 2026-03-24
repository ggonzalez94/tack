# Railway Deployment Baseline (API + Kubo + Persistent Storage)

This baseline is the first production path for Tack on Railway with Taiko Alethia x402 payments.

## Target Topology

Deploy two Railway services in one project:

1. `tack-api` (this repo, Dockerfile build)
2. `tack-ipfs` (`ipfs/kubo:latest` image)

Persistent volumes:

- `tack-api` volume mounted at `/app/data` for SQLite.
- `tack-ipfs` volume mounted at `/data/ipfs` for Kubo datastore.

## 1) Create Railway Services

### `tack-api`

- Source: this repository root.
- Build: Dockerfile (`railway.json` included in repo).
- Start command: `node dist/index.js`.
- Health check path: `/health`.
- Replicas: `1` (required while using SQLite file storage).

### `tack-ipfs`

- Source: this repository, `kubo/Dockerfile` (wraps `ipfs/kubo:latest` with announce config).
- Internal port for RPC: `5001`.
- **Public TCP port for swarm: `4001`** (required for IPFS P2P / DHT discoverability — see § Swarm Networking below).
- Optional public port for gateway: `8080` (only if you want direct gateway access).
- Mount persistent volume at `/data/ipfs`.

## 2) Required Environment Variables (`tack-api`)

Set these in Railway Variables.

| Variable | Value / Example | Notes |
| --- | --- | --- |
| `PORT` | `3000` | Railway routes traffic to this port. |
| `IPFS_API_URL` | `http://tack-ipfs.railway.internal:5001` | Use your internal service hostname from Railway networking. |
| `DATABASE_PATH` | `/app/data/tack.db` | Must be on the mounted persistent volume. |
| `DELEGATE_URL` | `https://<ipfs-gateway-domain>/ipfs` | Returned in pin delegates metadata. |
| `PUBLIC_BASE_URL` | `https://<your-api-domain>` | Recommended. Used for AgentCard and x402 absolute resource URLs. |
| `TRUST_PROXY` | `true` | Enables forwarded header parsing when the socket remote address matches `TRUSTED_PROXY_CIDRS`. |
| `TRUSTED_PROXY_CIDRS` | Railway proxy CIDRs | Required if you want to trust forwarded client IP/host/proto headers. |
| `WALLET_AUTH_TOKEN_SECRET` | long random secret | Required. Used to mint and verify short-lived owner bearer tokens. |
| `WALLET_AUTH_TOKEN_ISSUER` | `tack` | Optional. JWT issuer for owner bearer tokens. |
| `WALLET_AUTH_TOKEN_AUDIENCE` | `tack-owner-api` | Optional. JWT audience for owner bearer tokens. |
| `WALLET_AUTH_TOKEN_TTL_SECONDS` | `900` | Optional. Maximum owner token lifetime in seconds. |
| `X402_FACILITATOR_URL` | `https://facilitator.taiko.xyz` | Taiko x402 facilitator endpoint. |
| `X402_NETWORK` | `eip155:167000` | Taiko Alethia. |
| `X402_PAY_TO` | `0x...` treasury wallet | Must be a real address (no placeholders). |
| `X402_USDC_ASSET_ADDRESS` | `0x...` Taiko USDC | Must be a real token address (no placeholders). |
| `X402_USDC_ASSET_DECIMALS` | `6` | USDC decimals. |
| `X402_BASE_PRICE_USD` | `0.001` | Base operation price. |
| `X402_PRICE_PER_MB_USD` | `0.001` | Variable price by payload size. |
| `X402_MAX_PRICE_USD` | `0.01` | Price ceiling per request. |

## 3) Swarm Networking (IPFS P2P Discoverability)

Without a publicly-reachable swarm port, pinned content is only accessible through the Tack API (`/ipfs/:cid`). Public IPFS gateways (ipfs.io, dweb.link) will find the provider record in the DHT but fail to connect — returning 504 timeouts.

### Setup on Railway

1. **Expose port 4001 as a public TCP service** on the `tack-ipfs` Railway service.
   - Railway will assign a public address like `monorail.proxy.rlwy.net:12345`.
2. **Set the `IPFS_ANNOUNCE_ADDRESS` environment variable** on `tack-ipfs` to the multiaddr form of that public address:
   ```
   IPFS_ANNOUNCE_ADDRESS=/dns4/monorail.proxy.rlwy.net/tcp/12345
   ```
   Replace the hostname and port with the actual values Railway assigns.
3. **Redeploy** the `tack-ipfs` service. The `kubo/configure-announce.sh` init script will configure Kubo to advertise this address in the DHT.

### Verification

After deploying, SSH into the Kubo container and check:

```bash
# Confirm announce address is set
ipfs config Addresses.AppendAnnounce
# Should show: ["/dns4/<hostname>/tcp/<port>"]

# Verify the node sees itself as reachable
ipfs id
# "Addresses" should include the public /dns4/... address

# Quick connectivity test from another machine
ipfs swarm connect /dns4/<hostname>/tcp/<port>/p2p/<peer-id>
```

Content should become retrievable on public gateways within a few minutes of the node re-establishing DHT presence.

### Note on redeploys

Railway may reassign the public TCP address on service recreation (not on normal redeploys). If the public address changes, update `IPFS_ANNOUNCE_ADDRESS` accordingly.

## 4) Persistent Storage Strategy

- Keep SQLite at `/app/data/tack.db` on Railway volume.
- Run API with a single replica to avoid SQLite file locking/consistency issues.
- Keep Kubo data on a dedicated volume (`/data/ipfs`) so pins survive redeploys.
- Export Kubo repo snapshot from `/data/ipfs` before risky changes.

## 4) Backups

Back up SQLite before deploys:

```bash
./scripts/backup-db.sh /app/data/tack.db.bak
```

`DATABASE_PATH` can be overridden for local backups; otherwise it defaults to `./data/tack.db`.

## 5) Health Checks and Runtime Validation

- Railway health check uses `GET /health`.
- `200` means API is up and Kubo RPC is reachable.
- `503` means degraded state (`ipfs` dependency unreachable).

Post-deploy checks:

1. `GET /health` returns `200`.
2. `POST /pins` without payment returns `402`.
3. Paid retry with `payment-signature` returns `202` and includes `x-wallet-auth-token`.

Use the full smoke runbook: [deployment-smoke.md](./deployment-smoke.md).

## 6) Rollback Notes

When a release causes issues:

1. Roll back `tack-api` to the previous Railway deployment.
2. Keep volumes attached; do not delete `tack.db` or Kubo volume.
3. If breakage is env-related (x402 wallet/asset/network), revert variables and redeploy.
4. If a data migration or write-path bug corrupted SQLite, restore `tack.db` from backup snapshot.
5. If Kubo regresses, roll back `tack-ipfs` service separately.

## 7) Taiko + x402 Go-Live Checklist

1. API and Kubo services both healthy in Railway.
2. API and Kubo persistent volumes attached and non-empty after a redeploy.
3. `X402_NETWORK=eip155:167000`.
4. `X402_PAY_TO` and `X402_USDC_ASSET_ADDRESS` are real Taiko Alethia addresses.
5. `WALLET_AUTH_TOKEN_SECRET` is set to a strong random value.
6. `PUBLIC_BASE_URL` matches the public Railway HTTPS domain.
7. `TRUST_PROXY=true` with `TRUSTED_PROXY_CIDRS` configured.
8. `/health` stable at `200` over repeated checks.
9. End-to-end smoke passes (`pnpm smoke:x402`) against Railway URL.
10. Manual pin/list/get/delete flow works with the issued owner bearer token.
11. `IPFS_ANNOUNCE_ADDRESS` set on `tack-ipfs` with the Railway public TCP address for port 4001.
12. Pinned content reachable via `https://dweb.link/ipfs/<cid>` (may take a few minutes after deploy).
13. Rollback owner and backup location documented before launch.

## 8) Production Limitations & Upgrade Path

Current known limitations of this Railway deployment:

| Limitation | Impact | Trigger to upgrade |
| --- | --- | --- |
| **SQLite single-writer** | API cannot scale beyond 1 replica | Write contention under load (a good problem) |
| **Railway volumes are single-AZ** | No automatic recovery if the volume is lost | When uptime SLA is required |
| **Kubo on Railway has ephemeral networking** | Peer table resets on every deploy; DHT re-establishment takes a few minutes. Mitigated by `IPFS_ANNOUNCE_ADDRESS` (see § Swarm Networking) | Kubo health check failures post-deploy, or content retrieval latency degrades |
| **No automated backups** | Manual `scripts/backup-db.sh` before deploys; Kubo volume has no snapshot automation | When data loss risk becomes unacceptable |
| **Single IPFS node, no replication** | Pinned content lives on one Kubo instance | When data durability matters to users |

Planned upgrade path (build when needed, not before):

1. **SQLite -> Postgres**: Swap `PinRepository` to use `pg`. Unlocks horizontal API scaling.
2. **Kubo on Railway -> Kubo on VPS** (Hetzner/Vultr): Stable networking, cheaper storage, proper DHT participation. Connect via WireGuard or restrict Kubo RPC to Railway egress IPs.
3. **Single node -> Pinata/web3.storage replication**: Pin locally for speed, replicate to a commercial provider for durability. The `PIN_REPLICA_IPFS_API_URLS` mechanism covers additional self-hosted nodes; third-party pinning services need a Pinning Service API adapter.
4. **Single region -> multi-region**: Requires Postgres (or CockroachDB), multiple API replicas, and geo-distributed Kubo nodes or a CDN in front of the gateway.
