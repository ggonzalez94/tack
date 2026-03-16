# Changelog

All notable user-facing changes to `tack` are documented in this file.

Format:
- Keep entries concise and focused on user impact.
- Group notes in this order: `Added`, `Changed`, `Fixed`, `Docs`, `Security`.
- Add a tagged section before pushing a release tag. The release workflow uses the matching section for GitHub Release notes.

## [Unreleased]

- None yet.

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

[Unreleased]: https://github.com/taikoxyz/tack/compare/v0.1.4...HEAD
[v0.1.4]: https://github.com/taikoxyz/tack/releases/tag/v0.1.4
[v0.1.3]: https://github.com/taikoxyz/tack/releases/tag/v0.1.3
[v0.1.2]: https://github.com/taikoxyz/tack/releases/tag/v0.1.2
[v0.1.1]: https://github.com/taikoxyz/tack/releases/tag/v0.1.1
[v0.1.0]: https://github.com/taikoxyz/tack/releases/tag/v0.1.0
