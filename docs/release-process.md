# Release Process

Tack releases are tag-driven.

The `release` workflow will deploy only when:
- the pushed tag matches `package.json` (`v${version}`)
- `CHANGELOG.md` contains a matching `## [vX.Y.Z] - YYYY-MM-DD` section
- lint, typecheck, tests, typos, and the Docker image build all pass

## Required GitHub Actions configuration

Repository variables:
- `RAILWAY_PROJECT_ID`
- `RAILWAY_ENVIRONMENT_ID`
- `RAILWAY_SERVICE_ID`
- `RAILWAY_API_BASE_URL`
- `X402_SMOKE_RPC_URL` (optional, defaults to Taiko mainnet RPC)
- `X402_SMOKE_CHAIN_ID` (optional, defaults to `167000`)
- `X402_SMOKE_CID` (optional)

Repository secrets:
- `RAILWAY_TOKEN`
- `X402_SMOKE_PAYER_PRIVATE_KEY` (optional, enables the paid post-deploy smoke test)

## Cut a release

1. Update `package.json` to the next version.
2. Add the matching release section to `CHANGELOG.md`.
3. Merge the release commit to `main`.
4. Push a semver tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## What the workflow does

1. Re-runs release gates: typos, lint, typecheck, tests, build, and Docker build.
2. Deploys the tagged revision to Railway.
3. Waits for `GET /health` to return `200`.
4. Runs the paid x402 smoke flow if `X402_SMOKE_PAYER_PRIVATE_KEY` is configured.
5. Creates or updates the GitHub Release from the matching `CHANGELOG.md` section.
