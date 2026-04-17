# SolShield

Pre-signature transaction analysis for Solana. Intercepts unsigned transactions, decides if they are safe to sign, and surfaces a verdict the wallet can render before the user approves.

Blockaid and Blowfish already occupy this space. Both are closed, pay-walled, and scoped to what their vendors choose to cover. SolShield is the open reference implementation the ecosystem should have shipped two years ago.

> Active development. Not production-ready. Public APIs and data schemas will break until 1.0.

## Threat model

The wallet layer on Solana is thin. When the user clicks *approve*, the signature authorizes the requested operation with almost no in-context explanation. SolShield sits between the dApp and the signature, takes the serialized transaction, and answers a single question: **is this safe to sign?**

Inspection runs in four passes, cheap to expensive:

1. **Static analysis.** Instruction decoding, known-bad program IDs, unlimited-approval anti-patterns, silent mint/freeze authority swaps, squatted token metadata, CPI guard violations.
2. **Dynamic simulation.** Execute against forked mainnet state. Diff balances, token ownership, and account authorities. Catch hidden transfers and delegated authority the static pass missed.
3. **Heuristic and ML classification.** Claude Haiku 4.5 for triage, Claude Opus 4.7 for deep reasoning on ambiguous cases. Prompts, few-shots, and the curated threat corpus all live in-tree — nothing is hidden in a remote config.
4. **Reputation.** Program, signer, and destination history via Helius and on-chain feeds.

The output is bounded: a numerical risk score, a categorical verdict (`safe | suspicious | danger`), and a human-readable reason ready to drop into a wallet modal.

## Attack surface it covers

- Drainer programs and their obfuscated variants
- Malicious token approvals and unlimited delegations
- Hidden SOL/SPL transfers camouflaged inside legitimate-looking instructions
- Authority swaps (mint, freeze, upgrade)
- Squatted token metadata impersonating reputable mints
- Compromised IDL payloads served through dApp frontends
- Suspicious program deployments masquerading as known protocols

What it deliberately does **not** do: trade execution guidance, price-impact warnings, MEV routing. Different tool, different problem.

## Repository layout

```
packages/core   Rule engine, instruction parser, policy types
packages/ai     Anthropic-backed analysis layer (Haiku + Opus)
packages/sdk    Client library for wallets and dApps
apps/web        Dashboard, live demo, public threat feed
```

Strict TypeScript, pnpm workspaces, `@solana/kit` (not the retired web3.js v1), Prisma + Postgres, Redis. Docker Compose for local development, the same containers in production.

## Running locally

Prereqs: Node 22+, pnpm 10+, Docker.

```bash
pnpm install
cp .env.example .env    # HELIUS_API_KEY, ANTHROPIC_API_KEY
docker compose up -d    # postgres + redis
pnpm -F web dev
```

## Roadmap

- [x] Monorepo scaffold
- [ ] Instruction decoder on top of `@solana/kit`
- [ ] Static rule set — the top 20 drainer patterns at minimum
- [ ] Forked-mainnet simulator with balance/ownership diffing
- [ ] AI layer — Haiku 4.5 triage + Opus 4.7 deep reasoning
- [ ] `@solshield/sdk` published to npm
- [ ] Wallet integrations — Phantom, Solflare, Backpack
- [ ] Public threat feed with signed, timestamped incidents
- [ ] Third-party security audit before 1.0

## Security

SolShield is security-critical software. If you think you have found a vulnerability, do **not** open a public issue. Read [`SECURITY.md`](./SECURITY.md) for the disclosure path.

Nothing here is a substitute for reviewing transactions yourself. SolShield reduces risk. It does not eliminate it.

## Contributing

[`CONTRIBUTING.md`](./CONTRIBUTING.md). Rule submissions are especially welcome — a new drainer pattern the same day it hits mainnet is worth more than any feature.

## License

Apache 2.0. See [`LICENSE`](./LICENSE).

---

Maintained by [@0xnullpavel](https://github.com/0xnullpavel). Reachable through GitHub issues or `security@solshield.dev` for sensitive reports.
