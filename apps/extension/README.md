# SolShield Browser Extension

Scan Solana transactions before you sign them. Real-time protection against drainers, phishing, and rugpulls.

## What it does

- Intercepts transactions your wallet is about to sign and runs them through Claude AI analysis
- Detects phishing domains, domain homograph attacks, and spoofed dapp names
- Simulates transactions to show you exactly what they'd do to your account
- Analyzes sign-in messages for credential harvesting attempts
- Works with Phantom, Solflare, and other Solana wallets via the Wallet Standard
- Instant verdict: **safe**, **suspicious**, or **don't sign** — with reasons you can understand

## Install

**Chrome Web Store:** coming soon.

**From source (development):**

```bash
git clone https://github.com/0xnullpavel/solshield
cd solshield
pnpm install
pnpm -F @solshield/extension dev
```

This launches a Chrome window with the extension already loaded.

## Dev quickstart

```bash
pnpm -F @solshield/extension dev
```

Opens Chrome with the extension enabled. Changes auto-reload.

## How to test it without a wallet

Visit **https://solshield.dev/test-extension** with the extension loaded.

The page mounts a fake `window.solana` provider so the SolShield content
script has something to wrap. Four buttons:

- **Sign in (spoofed jup.ag)** — sends a SIWS message claiming `jup.ag`
  while the page origin is `solshield.dev`. Should show a critical red
  overlay (`spoofed-siws-domain`).
- **Authorize 1M USDC (permit)** — off-chain permit-shaped message,
  high-severity overlay.
- **Sign in (legit jup.ag)** — same domain in claim and origin, should
  pass through (or show a small green badge).
- **Sign a transaction** — exercises the tx hook with demo bytes
  (extension fails open on undecodable bytes; useful to confirm the
  proxy is in place).

Click REJECT in the overlay → the wallet method throws a wallet-style
4001 rejection error and the page logs it. Click PROCEED → the original
mock function runs and returns a signature.

To test the **domain-guard**, just open `https://jupitor-claim.io/` in
a new tab — the extension's `document_start` script injects a full-page
red warning before any content loads (the domain is in the embedded
blocklist).

## Build

```bash
pnpm -F @solshield/extension build
```

Outputs to `build/chrome-mv3-prod/`. Upload to Chrome Web Store or load as an unpacked extension.

## Architecture

```
Dapp Page
    ↓ (injected provider)
Content Script (reads wallet calls)
    ↓ (isolated world)
Background Service Worker
    ↓ (intercepts, sends to)
solshield.dev API
    ↓ (analysis via)
Claude AI + Helius RPC
    ↓ (verdict back to)
Content Script → Dapp Page (user sees warning/approval)
```

The extension never connects directly to your wallet. It only reads what your wallet is about to sign, sends it to our API, and returns a verdict. You stay in control.

## Wallet support

| Wallet | Status | Note |
|--------|--------|------|
| Phantom | ✅ v0.1 | full support |
| Solflare | ✅ v0.1 | full support |
| Backpack | ⏳ v0.2 | queued |
| Glow | ⏳ v0.2 | queued |
| Nightly | ⏳ v0.2 | queued |
| Wallet Standard | ⏳ v1.0 | generic adapter |

## Privacy

See https://solshield.dev/privacy. TL;DR: we never see your keys. The extension never connects to your wallet directly — it only reads what you're about to sign. Your private keys never leave your device.

## License

Apache 2.0
