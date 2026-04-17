# Changelog

All notable changes to `@solshield/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha.0] - 2026-04-17

### Added

- Initial alpha release.
- `SolShieldClient` HTTP client that submits unsigned base64 transactions to a self-hosted SolShield backend and returns a `ThreatReport`.
- Transaction scanner backed by the `@solshield/core` engine with 15 static detection rules (drainer patterns, unlimited approvals, authority swaps, hidden transfers, freeze abuse, stake hijack, multisig cosigner manipulation, memo exfiltration, compute-budget anomalies, etc.).
- AI verdict layer wired through `@solshield/ai` using Claude Haiku 4.5 for triage and Claude Opus 4.7 for deep analysis.
- Full TypeScript types re-exported from `@solshield/core`.

### Known issues

- Not yet published to npm. Do not run `npm install @solshield/sdk` until `0.1.0` lands.
- Message/signature scanning is stubbed and ships in `0.2`.
- Domain phishing detection is stubbed and ships in `0.2`.
- SDK surface is minimal. Most detection logic currently lives in `@solshield/core`; the SDK wraps the HTTP endpoint.

## [Unreleased]

- Message and off-chain signature scanning (`scanMessage`).
- Domain phishing and reputation checks (`checkDomain`).
- Wallet adapter integrations (Phantom, Backpack, Solflare).
- Browser-friendly build target.

[0.1.0-alpha.0]: https://github.com/0xnullpavel/solshield/releases/tag/sdk-v0.1.0-alpha.0
