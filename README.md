# solshield

open-source transaction firewall for solana. before a wallet asks the user to sign, solshield looks at the tx and decides if something's off.

> early WIP. nothing is production ready. star to follow along.

## what it does

1. wallet sends us a serialized tx before prompting to sign
2. we simulate it, run it through a rules engine, and ask a model for a second opinion
3. we return a risk score + reason
4. wallet renders a warning if the score is high enough

the pitch: turn "approve?" into "approve — we see this is probably a drainer, proceed anyway?"

## stack

typescript monorepo, pnpm workspaces.

- `packages/core` — rule engine, tx parser, policy types
- `packages/ai` — anthropic wrapper for threat analysis
- `packages/sdk` — public client library (for wallets/dapps)
- `apps/web` — next.js dashboard + live demo

postgres + redis for runtime state, helius for solana data, anthropic (haiku/sonnet) for the ai layer. docker compose for local dev.

## running it

requires node 22+, pnpm 10+, docker.

```bash
pnpm install
cp .env.example .env   # fill in HELIUS_API_KEY, ANTHROPIC_API_KEY
docker compose up -d   # postgres + redis
pnpm -F web dev        # http://localhost:3000
```

## why

blockaid and blowfish already do this but they're closed. solshield is the open alternative. no token, no VC, just code.

## roadmap

- [x] monorepo scaffold
- [ ] tx parser + instruction decoder (`@solana/kit`)
- [ ] static rules: drainer patterns, unlimited approvals, suspicious mints
- [ ] ai layer with haiku 4.5 (fast classify) + sonnet 4.6 (deep analysis)
- [ ] `@solshield/sdk` published to npm
- [ ] live demo on mainnet
- [ ] wallet integrations (phantom, solflare, backpack)

## license

apache 2.0. see [`LICENSE`](./LICENSE).

## contact

open an issue, or dm [@0xnullpavel](https://github.com/0xnullpavel).
