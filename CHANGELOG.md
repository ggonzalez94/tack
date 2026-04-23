# Changelog

All notable user-facing changes to `tack` are documented in this file.

Format:
- Keep entries concise and focused on user impact.
- Group notes in this order: `Added`, `Changed`, `Fixed`, `Docs`, `Security`.
- Add a tagged section before pushing a release tag. The release workflow uses the matching section for GitHub Release notes.

## [Unreleased]

### Added
- Tack now accepts x402 payments on Base mainnet (`eip155:8453`) alongside Taiko Alethia. The same endpoints (`POST /pins`, `POST /upload`, paywalled `GET /ipfs/:cid`) serve both chains — unpaid requests receive a single `402` whose `payment-required` header advertises Taiko USDC and Base USDC at the same USD price. Clients pick whichever chain they already hold USDC on. Base settlement goes through the permissionless PayAI facilitator; no operator-side credentials required.
- The agent card at `/.well-known/agent.json` now publishes one x402 protocol entry per supported chain (`chain: 'taiko'` and `chain: 'base'`).

### Changed
- **Breaking (ops):** Settlement wallet is now configured per chain. `X402_PAY_TO` is replaced by three required env vars: `X402_TAIKO_PAY_TO`, `X402_BASE_PAY_TO`, and `MPP_PAY_TO` (the last required only when MPP is enabled). Reusing a single address across chains is unsafe when that address is a Safe or other contract wallet — CREATE2 addresses are deterministic but the contract must actually be deployed on each chain before funds sent to that address can be controlled. Operators must set each variable to an address they control on the target chain.

## [v0.2.0] - 2026-04-14

### Added
- Tack now accepts dual-protocol payments on `POST /pins`, `POST /upload`, and paywalled `GET /ipfs/:cid`: existing x402 clients on Taiko keep working unchanged, and MPP (Machine Payment Protocol) clients can pay on Tempo using USDC.e. Unpaid requests receive a single `402` response advertising both protocols — x402 via the `payment-required` header and MPP via a standards-compliant `WWW-Authenticate: Payment` challenge — so either client can pay without a second round-trip.
- The agent card at `/.well-known/agent.json` now publishes a `payments.protocols` array so agents can discover both protocols at once, including the Tempo chain ID, asset address, and asset symbol for the active network.
- New opt-in env vars: `MPP_SECRET_KEY` (enables MPP, 32+ byte HMAC secret), `MPP_TESTNET` (switches to Tempo Moderato), and `MPP_TEMPO_RPC_URL` (overrides the default Tempo RPC used for on-chain payer verification).

### Changed
- Wallet-auth JWTs issued after an MPP-paid request work transparently on owner endpoints (`GET /pins`, `DELETE /pins/:id`), so clients using MPP get the same ownership flow as x402.
- When MPP is not configured, the service is behavior-compatible with prior releases: the MPP middleware is never constructed, no Tempo RPC traffic is generated, and the agent card omits the MPP protocol block.

### Security
- **Ownership is derived from verified on-chain evidence, never from client-supplied credential metadata.** The MPP credential's optional `source` DID is client-controlled (spread unverified through `Credential.deserialize` and never checked by the Tempo `verify()` implementation), so trusting it would let a paying attacker forge `did:pkh:eip155:4217:<victim>` and mint owner-scoped JWTs for the victim. Tack now re-reads the settled Tempo transaction from RPC, locates the matching TIP-20 `Transfer`/`TransferWithMemo` event, and uses its `from` field as the canonical payer. Regression coverage lives in `tests/integration/app.test.ts > dual-protocol > ignores a forged credential.source`.

## [v0.1.6] - 2026-03-26

### Added
- Added Docker image publishing for both the Tack API and the companion Kubo image to Google Artifact Registry.

### Changed
- Pinning prices now scale linearly with file size and requested retention duration, and expired pins are automatically cleaned up after their paid term ends.
- Deployment artifacts are now oriented around containerized Kubernetes rollouts, including hardened non-root runtime defaults and semver-tagged image publishing.

### Fixed
- Kubo can now advertise its configured public swarm address so pinned content is reachable through public IPFS gateway discovery flows.

## [v0.1.4] - 2026-03-16

### Added
- Agent-native landing page now highlights paid pinning, the public gateway, and the `@x402/fetch` client flow for wallet-based integrations.
- The agent card now includes x402 spec links, the recommended client SDK, the payment header name, and wallet auth token usage details.

### Changed
- Paid pinning and upload endpoints now return structured x402 guidance in 402 responses so agents can discover the protocol, SDK, and next-step hints without reverse-engineering headers.
- 402 responses now consistently include request IDs, making production debugging easier across logs and client reports.

### Fixed
- Invalid but decodable payment proofs now return helpful JSON bodies instead of silent `{}` responses.

### Security
- Settlement-failure responses no longer leak wallet auth tokens, cache headers, or other protected-resource headers when payment does not complete.

## [v0.1.3] - 2026-03-15

### Fixed
- Release paid smoke now uses the bearer token issued by `POST /pins` when polling pin status, so CI validates the authenticated owner flow that production enforces.

## [v0.1.2] - 2026-03-15

### Fixed
- Canonical CID ownership now records the actual successful pin time so `replacePin` no longer backdates ownership to the original request creation timestamp.
- Retrieval paywall resolution no longer guesses a payout wallet from ambiguous legacy pin history when `cid_owners` is missing, preventing misrouted Taiko USDC settlements after database upgrades.

## [v0.1.1] - 2026-03-13

### Changed
- Tack now normalizes public request URLs at the app boundary so AgentCard metadata and x402 payment metadata use the correct public HTTPS origin behind Railway and other trusted proxies.

### Fixed
- Release smoke validation now covers the paid pinning flow more accurately before deployment promotion.

### Docs
- Added `PUBLIC_BASE_URL` guidance for deterministic public URL metadata in Railway deployments.

## [v0.1.0] - 2026-03-10

### Added
- IPFS Pinning Service API support for pin creation, listing, replacement, deletion, and upload-based pinning.
- Public IPFS gateway retrieval with `ETag` and `Range` handling plus an A2A agent card at `/.well-known/agent.json`.
- x402 payment authentication on Taiko Alethia for paid pinning flows, with bearer-token owner auth for follow-up pin management.
- SQLite-backed pin metadata, in-memory rate limiting, and optional best-effort replica pinning across additional Kubo nodes.

### Fixed
- Production startup validation now fails fast when x402 is disabled or configured with placeholder payout or asset addresses.
- Docker and Railway deployment paths are hardened around persistent `data/` storage and health checks.

### Docs
- Added Railway deployment and Taiko x402 smoke runbooks covering volumes, backups, rollback, and go-live validation.

[Unreleased]: https://github.com/taikoxyz/tack/compare/v0.1.6...HEAD
[v0.1.6]: https://github.com/taikoxyz/tack/releases/tag/v0.1.6
[v0.1.4]: https://github.com/taikoxyz/tack/releases/tag/v0.1.4
[v0.1.3]: https://github.com/taikoxyz/tack/releases/tag/v0.1.3
[v0.1.2]: https://github.com/taikoxyz/tack/releases/tag/v0.1.2
[v0.1.1]: https://github.com/taikoxyz/tack/releases/tag/v0.1.1
[v0.1.0]: https://github.com/taikoxyz/tack/releases/tag/v0.1.0
