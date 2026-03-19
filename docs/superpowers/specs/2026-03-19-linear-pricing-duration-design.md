# Linear Pricing by Size and Duration

**Issue**: #9
**Date**: 2026-03-19
**Status**: Approved

## Problem

Current pricing is unsustainable: `$0.001 base + $0.001/MB` capped at `$0.01`. A 1GB pin costs the same as a 10MB pin ($0.01), and pins live forever. Storage costs grow unbounded while revenue is capped.

## Design

### Pricing Formula

```
price = max(minPrice, fileSizeGB * ratePerGbMonth * durationMonths)
```

- `fileSizeGB = sizeBytes / 1,073,741,824`
- Default rate: $0.05/GB/month
- Min price: $0.001 (floor for tiny files)
- Max price: $50.00 (sanity guard — must exceed max realistic pin: 10GB × 24mo = $12)
- Default duration: 1 month

Examples at $0.05/GB/month:

| File size | 1 month (default) | 6 months | 12 months |
|-----------|-------------------|----------|-----------|
| 1 MB      | $0.001 (floor)    | $0.001   | $0.001    |
| 100 MB    | $0.005            | $0.03    | $0.06     |
| 1 GB      | $0.05             | $0.30    | $0.60     |

### Config Env Vars

Replaces the old `X402_BASE_PRICE_USD`, `X402_PRICE_PER_MB_USD`, `X402_MAX_PRICE_USD` (at $0.01).

| Env var | Default | Purpose |
|---------|---------|---------|
| `X402_RATE_PER_GB_MONTH_USD` | 0.05 | Linear rate |
| `X402_MIN_PRICE_USD` | 0.001 | Price floor |
| `X402_MAX_PRICE_USD` | 50.0 | Sanity cap (must exceed max realistic pin) |
| `X402_DEFAULT_DURATION_MONTHS` | 1 | Default if header absent |
| `X402_MAX_DURATION_MONTHS` | 24 | Maximum allowed duration |

Breaking change: old env vars are removed. Single Railway deployment, so no backward-compat shim.

### Duration Input

Header: `X-Pin-Duration-Months: <integer>`

- Parsed in the x402 price resolver (same pattern as `X-Content-Size-Bytes`)
- Range: 1 to `X402_MAX_DURATION_MONTHS`, default `X402_DEFAULT_DURATION_MONTHS`
- 0, negative, non-integer, and out-of-range values are all invalid and fall back to default (note: existing `parsePositiveInteger` accepts 0, so a dedicated `>= 1` check is needed)
- Applies to `POST /pins` only (see note on uploads below)

### Schema Change

```sql
ALTER TABLE pins ADD COLUMN expires_at TEXT;
CREATE INDEX IF NOT EXISTS idx_pins_expires_at ON pins(expires_at);
```

- Computed at pin creation: `now + durationMonths`
- Stored as ISO 8601 string (consistent with `created`/`updated`)
- Nullable: existing pins get `NULL` (treated as "no expiry" / legacy)

`StoredPinRecord` gets: `expires_at: string | null`

### Where `expires_at` Is Set

- `POST /pins` -- computed from header duration
- `POST /pins/:requestid` (replace) -- inherits the original pin's `expires_at` (replace is free / wallet-auth only, no new payment)
- `POST /upload` -- does **not** set `expires_at`. The upload route creates no pin record (it calls `ipfs add` and returns a CID). Agents are expected to follow up with `POST /pins` to create a tracked pin with expiry. The upload x402 price uses `calculatePriceUsd(sizeBytes, 1, config)` -- always 1 month duration, covering the upload holding cost until the agent pins it.

### Expiry Sweep

In-process `setInterval` timer in `index.ts`:

- Runs every 60 minutes
- Also runs once on startup after 30-second delay (let Kubo connect)

Sweep logic (new method on `PinningService`):

1. Query `findExpired(limit: 50)`: `WHERE expires_at IS NOT NULL AND expires_at <= ? AND status IN ('pinned', 'failed')` with `new Date().toISOString()` as the comparator. `ORDER BY expires_at ASC` (oldest-expired first). Excludes `queued`/`pinning` pins to avoid racing with in-flight `pinAdd` operations.
2. For each expired pin:
   - **CID safety check**: only call `ipfsClient.pinRm(cid)` if no other non-expired pin records reference the same CID. Query: count of pins with same CID where `expires_at IS NULL OR expires_at > now`. If count > 0, skip Kubo unpin but still delete this record.
   - If Kubo unpin needed: `ipfsClient.pinRm(cid)` + replica unpin -- best-effort
   - Delete pin record from DB
   - Clean up orphaned `cid_owners` entry if no other pin records reference this CID
   - Evict from content cache (only if Kubo unpin was performed)
3. If unpin fails, skip that pin (retry next cycle). Only delete DB record if unpin succeeds or was skipped (shared CID).
4. Log summary: `{ expiredCount, failedCount, skippedUnpinCount, durationMs }`

Design decisions:
- Hard delete immediately (no soft-delete "expired" status, no 30-day retention)
- No intermediate "expired" status -- pin is alive or gone
- Batch size 50 to avoid monopolizing DB/Kubo
- Legacy pins with `NULL` `expires_at` are never swept
- Sweep timer is `.unref()`'d and `clearInterval`'d during shutdown to prevent conflicts with DB close

### API Surface

**402 response body** -- add pricing context:

```json
{
  "error": "Payment required",
  "description": "Pin a CID to IPFS.",
  "pricing": {
    "ratePerGbMonthUsd": 0.05,
    "durationMonths": 1,
    "minPriceUsd": 0.001
  },
  "protocol": { "..." },
  "client": { "..." }
}
```

**Pin status response** -- surface `expiresAt` in `info`:

```json
{
  "requestid": "...",
  "status": "pinned",
  "created": "2026-03-19T...",
  "pin": { "cid": "Qm..." },
  "info": {
    "expiresAt": "2026-04-19T..."
  }
}
```

In `info` to stay compatible with IPFS Pinning Service API spec (`info` is the extension point).

**Agent card** (`/.well-known/agent.json`) -- updated pricing section:

```json
{
  "pricing": {
    "pinning": {
      "protocol": "x402",
      "ratePerGbMonthUsd": 0.05,
      "defaultDurationMonths": 1,
      "maxDurationMonths": 24,
      "minPriceUsd": 0.001,
      "durationHeader": "X-Pin-Duration-Months"
    }
  }
}
```

Removes old `baseUsd`/`perMbUsd`/`maxUsd` fields.

### Files Changed

| File | Changes |
|------|---------|
| `src/config.ts` | Replace 3 pricing env vars with 5 new ones, update `AppConfig` |
| `src/services/x402.ts` | New `calculatePriceUsd()` (takes duration), parse `X-Pin-Duration-Months` for pins route only, update `X402PaymentConfig`, pricing info in 402 body, fix retrieval price fallback (`basePriceUsd` -> `minPriceUsd`) |
| `src/types.ts` | Add `expires_at: string \| null` to `StoredPinRecord` |
| `src/db.ts` | ALTER TABLE, add index |
| `src/repositories/pin-repository.ts` | Persist/query `expires_at`, add `findExpired(limit)` |
| `src/services/pinning-service.ts` | Compute `expires_at` on create, add `sweepExpiredPins()` |
| `src/app.ts` | Pass duration to service, surface `expiresAt` in info, update agent card |
| `src/index.ts` | Wire sweep timer |
| `tests/unit/x402.test.ts` | New pricing formula tests |
| `tests/unit/config.test.ts` | New env var tests |
| `tests/unit/pinning-service.test.ts` | Expiry sweep tests |
| `tests/integration/app.test.ts` | Duration header e2e |

No new files.

### Test Strategy

- Unit test `calculatePriceUsd` across size/duration combos
- Unit test sweep: mock Kubo + repo, verify unpin + delete + cache eviction
- Unit test sweep: shared CID -- verify Kubo unpin is skipped when another active pin exists
- Unit test sweep: orphaned `cid_owners` cleanup
- Unit test: `NULL` `expires_at` (legacy pins) survives sweep
- Unit test: duration header boundary values (0, -1, max+1, non-integer, missing)
- Integration test: full request cycle with duration header, verify `expiresAt` in response

## Out of Scope

- Subscription/recurring payments
- Free tier or trial pins
- Renewal endpoint (`POST /pins/:requestid/renew`) -- future work
- File size limits for `POST /pins` (pricing scales linearly, economics deters abuse)
