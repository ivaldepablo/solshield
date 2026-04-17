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
