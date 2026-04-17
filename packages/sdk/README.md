# @solshield/sdk

pre-signature transaction firewall for solana. the open alternative to blowfish and blockaid.

[![npm version](https://img.shields.io/npm/v/@solshield/sdk.svg)](https://www.npmjs.com/package/@solshield/sdk)
[![license](https://img.shields.io/npm/l/@solshield/sdk.svg)](./LICENSE)
[![build](https://img.shields.io/github/actions/workflow/status/0xnullpavel/solshield/ci.yml?branch=main)](https://github.com/0xnullpavel/solshield/actions)

solshield sits between the dapp and the signature. it decodes the unsigned transaction, runs static rules and a forked simulation, asks claude (haiku 4.5 for triage, opus 4.7 for deep analysis), and hands the wallet a verdict it can render in-context. everything is open source, auditable, and vendor-neutral. nothing hidden in a remote config.

## install

```bash
pnpm add @solshield/sdk
# or
npm install @solshield/sdk
# or
yarn add @solshield/sdk
```

requires node 22+.

## quickstart

```typescript
import { SolShield } from '@solshield/sdk';

const solshield = new SolShield({ apiKey: process.env.SOLSHIELD_KEY });

// scan a transaction
const report = await solshield.scanTransaction(base64UnsignedTx);
if (report.verdict === 'danger') {
  console.error('DO NOT SIGN:', report.summary);
}

// check a domain
const dapp = await solshield.checkDomain('https://jup.ag');
if (dapp.verdict !== 'safe') {
  console.warn(dapp.reasons);
}

// scan a signed message
const msg = await solshield.scanMessage({
  message: 'Welcome to Jupiter!',
  origin: 'https://jup.ag',
});
```

> `scanMessage` and `checkDomain` are the intended api for `0.2`. in `0.1.0-alpha` only `scanTransaction` (via `SolShieldClient.inspect`) is wired up. see the [roadmap](#roadmap).

## why solshield vs blowfish / blockaid

| axis                 | solshield            | blowfish / blockaid     |
| -------------------- | -------------------- | ----------------------- |
| source               | open, apache 2.0     | closed, proprietary     |
| rules and prompts    | in-tree, auditable   | black box, remote       |
| ai layer             | claude haiku + opus  | internal, undisclosed   |
| self-hostable        | yes (docker compose) | no                      |
| vendor lock-in       | none                 | full                    |
| fork and customize   | yes                  | no                      |
| pricing              | free + self-host     | metered saas            |
| solana-native        | yes                  | multi-chain, solana bolt-on |

if your wallet or dapp depends on a third party for "is this tx safe?", you are shipping a security primitive you cannot inspect. solshield makes that primitive reviewable.

## api reference

### `new SolShield(options)`

constructs a client.

```typescript
interface SolShieldClientOptions {
  endpoint: string;        // base url of your solshield backend (self-hosted or solshield.dev)
  apiKey?: string;         // optional bearer token
  fetchImpl?: typeof fetch; // custom fetch (useful for ssr / edge)
  timeoutMs?: number;      // default 10_000
}
```

### `client.scanTransaction(base64Tx)`

submits a base64-encoded **unsigned** transaction and returns a `ThreatReport`:

```typescript
interface ThreatReport {
  verdict: 'safe' | 'suspicious' | 'danger';
  score: number;               // 0..100
  findings: Finding[];         // rule hits with severity + message
  summary: string;             // one-liner for wallet ui
  elapsedMs?: number;
}
```

render the summary in your signing modal, gate on `verdict === 'danger'`, log the findings.

### `client.checkDomain(url)` _(0.2)_

phishing, squatting, and reputation check for a dapp origin.

### `client.scanMessage({ message, origin })` _(0.2)_

scans an off-chain signature payload (login, permit, siws-style) for drainer traps embedded in human-readable text.

### exported types

everything from `@solshield/core` is re-exported: `ThreatReport`, `Finding`, `Verdict`, `DecodedTransaction`, `Rule`, etc.

## roadmap

- **0.1** — transaction scanner, self-hosted backend, 15 static rules, ai verdict
- **0.2** — `scanMessage`, `checkDomain`, published to npm, browser bundle
- **0.3** — wallet adapters (phantom, backpack, solflare), reputation feed, sdk codemods
- **1.0** — third-party audit, stable api, semver guarantees

## links

- website — <https://solshield.dev>
- repo — <https://github.com/0xnullpavel/solshield>
- manifesto — see the root [`README`](https://github.com/0xnullpavel/solshield/blob/main/README.md)
- security disclosure — `security@solshield.dev` / [`SECURITY.md`](https://github.com/0xnullpavel/solshield/blob/main/SECURITY.md)

## license

apache 2.0. see [`LICENSE`](./LICENSE).

nothing here replaces reviewing a transaction yourself. solshield reduces risk. it does not eliminate it.
