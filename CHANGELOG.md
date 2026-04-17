# Changelog

All notable changes to SolShield are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Five static detection rules:
  - `token-freeze-abuse` (high)
  - `stake-authority-hijack` (critical for withdrawer, high for staker)
  - `memo-exfiltration` (low)
  - `compute-budget-anomaly` (low)
  - `multisig-cosigner-manipulation` (critical)

### Changed

- `mint-authority-transfer` now flags only the mint-tokens authority reassignment; freeze-authority changes moved to the new `token-freeze-abuse` rule.

## [0.1.0-alpha.0] — 2026-04-17

### Added

- pnpm monorepo scaffold (`apps/web`, `packages/core`, `packages/ai`, `packages/sdk`) targeting Node 22.
- Wire-format Solana transaction decoder in `@solshield/core`.
- Seven static detection rules:
  - `unlimited-spl-approval`
  - `mint-authority-transfer`
  - `mass-token-drain`
  - `upgrade-authority-set`
  - `hidden-sol-transfer`
  - `spl-account-owner-change`
  - `close-token-account-to-attacker`
- Vitest suite in `@solshield/core` covering positive and negative cases for each rule.
- AI analyzer in `@solshield/ai` using Claude Haiku and Opus with prompt caching on the system prompt and rule catalog.
- Environment-variable model selection (Haiku default for dev, Opus opt-in).
- `/api/inspect` endpoint in `apps/web` for submitting a base64 transaction and receiving rule hits plus AI verdict.
- Inspector UI at `/` for pasting a transaction and viewing the combined analysis.
- Dockerfile for `apps/web` and `docker-compose.yml` for local self-hosting.
- Caddy reverse proxy configuration with automatic Let's Encrypt TLS.

### Changed

- Default AI model wired through `ANTHROPIC_MODEL` so dev runs stay on Haiku.

### Security

- Apache 2.0 license applied at repo root.
- `SECURITY.md` disclosure policy published, with a private reporting channel.

[Unreleased]: https://github.com/0xnullpavel/solshield/compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: https://github.com/0xnullpavel/solshield/releases/tag/v0.1.0-alpha.0
