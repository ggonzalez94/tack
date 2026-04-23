# Private agent storage

## Goal

Add wallet-owned private object storage to Tack. Agents can pay with the same x402 or MPP mechanisms Tack already supports, store bytes that are not pinned to IPFS, and retrieve those bytes only after authenticating as the owning wallet.

This is private from the public, not end-to-end private from the Tack operator. Tack stores the object bytes on server-controlled storage and gates access by wallet identity.

## Motivation

Tack currently solves public, content-addressed storage: pin a CID, upload to IPFS, retrieve by `/ipfs/:cid`. Agents also need private working storage for memories, intermediate artifacts, credentials-adjacent state, logs, and generated files that should not be public or content-addressed.

The product should stay simple:

- no accounts
- no API keys
- wallet pays
- wallet owns
- wallet authenticates later

## Scope

In scope:

- Private object create, list, metadata read, content read, metadata update, delete, and renew.
- x402 and MPP payments for private object creation and renewal.
- Wallet-signature login for returning access without a new payment.
- Existing `x-wallet-auth-token` bearer tokens as the session credential.
- Owner isolation in the service/repository layer.
- Local or mounted-volume storage behind an interface, with S3/R2-compatible storage left as a later adapter.

Out of scope:

- Client-side encryption or end-to-end encryption.
- Sharing objects across wallets.
- Public signed URLs.
- Folder hierarchy.
- Search over object contents.
- Version history.
- Generic non-EVM wallet auth.

## Product model

Tack has two storage products:

1. IPFS pinning: public, content-addressed, CID-based, available through `/pins`, `/upload`, and `/ipfs/:cid`.
2. Private objects: wallet-owned server storage, opaque object IDs, available through `/private/objects`.

Do not add a `private` flag to `/upload` and do not make this a "private IPFS pin" mode. Developers should understand immediately that `/ipfs/:cid` is public-addressed content and `/private/objects/:objectId/content` is wallet-authenticated private content.

## Endpoint design

### Authentication

```http
POST /auth/challenge
POST /auth/token
```

`POST /auth/challenge` creates a short-lived wallet login challenge.

Request:

```json
{
  "address": "0x1111111111111111111111111111111111111111",
  "chainId": 8453
}
```

Response:

```json
{
  "message": "example.com wants you to sign in with your Ethereum account:\n0x1111111111111111111111111111111111111111\n\nSign in to Tack to access wallet-owned storage.\n\nURI: https://example.com\nVersion: 1\nChain ID: 8453\nNonce: 6c4b0c1c2a7e4e2c\nIssued At: 2026-04-23T12:00:00.000Z\nExpiration Time: 2026-04-23T12:10:00.000Z",
  "nonce": "6c4b0c1c2a7e4e2c",
  "expiresAt": "2026-04-23T12:10:00.000Z"
}
```

`POST /auth/token` verifies the signed challenge and returns the same wallet auth token format Tack already issues after paid requests.

Request:

```json
{
  "message": "example.com wants you to sign in with your Ethereum account:\n...",
  "signature": "0x..."
}
```

Response:

```json
{
  "wallet": "0x1111111111111111111111111111111111111111",
  "token": "<jwt>",
  "expiresAt": "2026-04-23T12:15:00.000Z"
}
```

The response also sets:

```http
x-wallet-auth-token: <jwt>
x-wallet-auth-token-expires-at: 2026-04-23T12:15:00.000Z
Cache-Control: no-store
```

### Private objects

```http
POST   /private/objects
GET    /private/objects
GET    /private/objects/:objectId
GET    /private/objects/:objectId/content
HEAD   /private/objects/:objectId/content
PATCH  /private/objects/:objectId
DELETE /private/objects/:objectId
POST   /private/objects/:objectId/renew
```

`POST /private/objects` is paid with x402 or MPP. The paying wallet owns the object. Successful responses issue `x-wallet-auth-token` headers.

Request options:

- `multipart/form-data` with `file`, optional `name`, optional `meta`.
- Raw body with `Content-Type`, optional `X-Object-Name`, optional `X-Object-Meta` containing a JSON object string.

Required headers:

```http
X-Content-Size-Bytes: 12345
X-Storage-Duration-Months: 6
```

Response:

```json
{
  "id": "obj_01HY8B9ZK6J4Z6NQ2S8K7R8M5P",
  "name": "agent-memory.json",
  "contentType": "application/json",
  "size": 12345,
  "sha256": "abc123...",
  "created": "2026-04-23T12:00:00.000Z",
  "updated": "2026-04-23T12:00:00.000Z",
  "expiresAt": "2026-10-23T12:00:00.000Z",
  "private": true,
  "meta": {}
}
```

`GET /private/objects` lists only the authenticated wallet's objects. Support `limit`, `offset`, `name`, `before`, and `after`.

`GET /private/objects/:objectId` returns metadata only.

`GET /private/objects/:objectId/content` returns bytes. It supports `ETag`, `Range`, and safe content headers. Responses must not be publicly cacheable:

```http
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
```

`PATCH /private/objects/:objectId` updates metadata only:

```json
{
  "name": "new-name.json",
  "meta": {
    "purpose": "agent-memory"
  }
}
```

`DELETE /private/objects/:objectId` deletes metadata and stored bytes.

`POST /private/objects/:objectId/renew` extends retention. It requires owner authentication and payment. For x402, the owner token can use `Authorization: Bearer <token>` and payment uses `payment-signature`. For MPP, `Authorization` is occupied by `Authorization: Payment ...`, so clients should send the owner token through `x-wallet-auth-token`.

The paying wallet for renewal must match the authenticated owner wallet.

## Authentication design

### Keep the existing bearer token

The current wallet token implementation is good as a session credential:

- The token is signed server-side with HS256.
- `sub` is the normalized wallet address.
- `iss`, `aud`, `iat`, `nbf`, and `exp` are validated.
- The default TTL is short.
- `Authorization: Payment ...` is not confused with bearer auth.
- Paid requests already return `x-wallet-auth-token` and `x-wallet-auth-token-expires-at`.

Keep this mechanism and use it for private object reads, lists, metadata updates, deletes, and renewal owner checks.

### Add SIWE login

The missing piece is a way to authenticate later without creating or renewing an object. Add Sign-In with Ethereum (EIP-4361) challenge/token endpoints.

Validation rules:

- Normalize the requested EVM address to lowercase.
- Generate at least 128 bits of nonce entropy.
- Store the canonical SIWE message plus a hash of the nonce in SQLite. The nonce hash is the lookup/replay key; the full message is retained for exact comparison during verification.
- Expire challenges after 10 minutes.
- Bind the challenge to the request origin or configured public base URL.
- Require a fixed statement: `Sign in to Tack to access wallet-owned storage.`
- Require `Version: 1`.
- Require `Chain ID` to be in the configured allowed EVM chain set: the advertised x402 chains plus the Tempo/MPP chain when MPP is enabled.
- Require `Issued At` and `Expiration Time`.
- Consume the nonce exactly once after successful verification.
- Return the existing wallet auth token format.

Signature verification:

- Verify EOA signatures with EIP-191 `personal_sign` semantics.
- Support EIP-1271 smart-contract wallets when an RPC URL is configured for the requested chain.
- If EIP-1271 verification is not configured, fail contract-wallet login with a clear 400/422 error rather than pretending only EOAs exist.

This gives developers a standard wallet login flow while preserving Tack's stateless bearer token model for API calls.

### Tighten payment-derived identity

MPP already sets `paymentResult.wallet` after settlement and derives the payer from on-chain Transfer evidence. Keep that.

x402 currently verifies payment before the handler, but handlers re-parse the `payment-signature` header to derive the paid wallet. For private storage, promote x402 identity into the same `paymentResult` shape MPP uses:

```ts
{
  wallet: "0x...",
  protocol: "x402",
  chainName: "taiko" | "base"
}
```

Handlers should use `paymentResult.wallet` for both x402 and MPP. Keep `extractPaidWalletFromHeaders` as a compatibility helper for tests or fallback paths, but new private storage code should not independently trust arbitrary wallet headers.

## Payment lifecycle

MPP settles before the handler. x402 verifies before the handler and settles after the handler. Private object creation must not leave a usable free object if x402 settlement fails after the object has been written.

Add payment settlement callbacks to the x402 middleware before shipping private storage:

- Private object creation writes a row with `payment_status = 'pending'` for x402 requests.
- The read path only serves rows with `payment_status = 'paid'`.
- On settlement success, the callback marks the row `paid`.
- On settlement failure, the callback deletes staged bytes and marks the row `failed` or removes it.
- MPP-created objects can be written as `paid` immediately because MPP settlement completes before the handler.

Paid create and renew responses should only expose usable object metadata after payment verification. If post-response x402 settlement fails, the client receives the existing x402 settlement failure response and should not receive a wallet token.

## Data model

Add `private_objects`:

```sql
CREATE TABLE private_objects (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  meta TEXT NOT NULL,
  payment_status TEXT NOT NULL CHECK(payment_status IN ('paid', 'pending', 'failed')),
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  expires_at TEXT
);
```

Indexes:

```sql
CREATE INDEX idx_private_objects_owner ON private_objects(owner);
CREATE INDEX idx_private_objects_created ON private_objects(created);
CREATE INDEX idx_private_objects_expires_at ON private_objects(expires_at);
```

Add `wallet_auth_challenges`:

```sql
CREATE TABLE wallet_auth_challenges (
  nonce_hash TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  uri TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created TEXT NOT NULL
);
```

Expired auth challenges can be swept opportunistically on challenge creation or by a lightweight periodic cleanup.

## Storage abstraction

Introduce a `PrivateObjectStorage` interface:

```ts
interface PrivateObjectStorage {
  put(input: {
    key: string;
    content: Blob | ArrayBuffer | Uint8Array;
    contentType: string;
  }): Promise<{ sizeBytes: number; sha256: string }>;
  get(key: string): Promise<{ content: ArrayBuffer; sizeBytes: number }>;
  delete(key: string): Promise<void>;
}
```

The first adapter should write to a configured local directory or mounted Railway volume. Storage keys should be generated server-side and should not contain the original filename or wallet address.

Later adapters can target S3/R2 without changing route or service semantics.

## Pricing

Use the existing size-duration pricing model for v1:

- same rate, min, max, default duration, and max duration as pinning unless separate env vars are introduced later
- `X-Storage-Duration-Months` controls object retention
- `X-Content-Size-Bytes` is the source of truth for the payment challenge when present

This keeps discovery and client code simple: private object storage costs the same as pinning for the same byte-months, but with different visibility semantics.

## Error handling

- Anonymous private routes return 401.
- Authenticated wrong-owner access returns 404, not 403, to avoid object enumeration.
- Expired objects return 404.
- Oversized uploads return 413.
- Invalid metadata returns 400.
- Failed upstream storage writes return 502 or 500 depending on adapter failure.
- Unsupported EIP-1271 verification returns 422 with a clear message.
- Renewal where paid wallet does not match owner returns 403.

## Agent card and OpenAPI

Add a `privateStorage` capability:

```json
{
  "privateStorage": {
    "storage": "not-ipfs",
    "visibility": "owner-authenticated",
    "endpoints": [
      "/private/objects",
      "/private/objects/:objectId",
      "/private/objects/:objectId/content"
    ],
    "auth": {
      "session": "Authorization: Bearer <token>",
      "walletLogin": ["/auth/challenge", "/auth/token"]
    }
  }
}
```

OpenAPI should document:

- `walletAuthToken` bearer/session auth.
- x402 and MPP payment metadata on `POST /private/objects` and `POST /private/objects/:objectId/renew`.
- The `x-wallet-auth-token` header alternative for MPP renewal.

## Testing

Unit tests:

- SIWE challenge generation validates address, chain ID, domain, nonce entropy, and expiry.
- SIWE token exchange rejects expired, consumed, malformed, wrong-domain, wrong-address, and wrong-signature messages.
- Wallet token verification continues to accept existing paid-response JWTs.
- x402 middleware sets `paymentResult.wallet`.
- Private object repository enforces owner filters.
- Private object storage adapter writes, reads, deletes, hashes, and hides original names from storage keys.

Integration tests:

- Paid x402 private upload creates an object, returns owner token, and owner can read metadata/content.
- Paid MPP private upload creates an object and owner can read metadata/content.
- Anonymous and wrong-wallet object reads return 401/404.
- SIWE login after token expiry can list and read existing private objects.
- MPP renewal works with `Authorization: Payment ...` plus `x-wallet-auth-token`.
- Renewal with a different paying wallet is rejected.
- Failed x402 settlement cleans up or leaves an unreadable failed object.
- Content reads support `HEAD`, `Range`, `ETag`, `nosniff`, and `Cache-Control: private, no-store`.

## Rollout

1. Implement wallet-auth challenge/token endpoints.
2. Promote x402 payment identity into `paymentResult`.
3. Add private object repository, storage adapter, service, and routes.
4. Add x402/MPP pricing for create and renew.
5. Update OpenAPI, agent card, README, and `llms.txt`.
6. Add smoke coverage for wallet login and private upload/read/delete.

## Non-obvious decisions

- Private storage is not IPFS and does not return a CID.
- The object ID is not content-addressed and should not reveal content hash, owner, or filename.
- `GET /private/objects/:objectId` is metadata; `/content` is bytes.
- `x-wallet-auth-token` remains useful because MPP uses the `Authorization` header for payment credentials.
- SIWE signs login intent; it does not prove payment. Payment-derived ownership still comes from x402/MPP settlement.
- The current bearer token is enough as a session token, not enough as the only login mechanism.
