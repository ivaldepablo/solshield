export default function PrivacyPolicy() {
  return (
    <main className="min-h-screen bg-bg text-fg font-mono">
      <div className="max-w-2xl mx-auto px-4 py-10 sm:py-16">
        <h1 className="text-2xl sm:text-3xl font-bold text-neon-green mb-2">PRIVACY POLICY</h1>
        <p className="text-xs text-dim mb-8">Last updated: 2026-04-17</p>

        <section className="space-y-8">
          <div>
            <h2 className="text-lg font-bold text-neon-cyan mb-3">What SolShield is</h2>
            <p className="text-sm leading-relaxed text-fg">
              SolShield is an open-source firewall for Solana wallets. It helps you detect phishing links, malicious transactions, and scam sign-in messages before you interact with them. You can use it via solshield.dev, or install the browser extension to get automatic warnings when a dapp is about to ask you to sign something suspicious.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-bold text-neon-cyan mb-3">What we collect</h2>
            <p className="text-sm leading-relaxed text-fg mb-3">
              When you paste something at solshield.dev, or when the extension intercepts a transaction you're about to sign, we process:
            </p>
            <ul className="text-sm space-y-2 text-fg ml-4">
              <li className="flex gap-2">
                <span className="text-neon-green shrink-0">•</span>
                <span>The URL/domain text</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neon-green shrink-0">•</span>
                <span>The transaction bytes (base64)</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neon-green shrink-0">•</span>
                <span>The message text (for sign-in messages)</span>
              </li>
            </ul>
            <p className="text-sm mt-4 leading-relaxed text-fg">
              This data is sent to:
            </p>
            <ul className="text-sm space-y-2 text-fg ml-4 mt-2">
              <li className="flex gap-2">
                <span className="text-neon-amber shrink-0">•</span>
                <span>solshield.dev/api (our API on Hetzner, Ashburn VA)</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neon-amber shrink-0">•</span>
                <span>Anthropic (Claude AI) for analysis</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neon-amber shrink-0">•</span>
                <span>Helius RPC (for simulating transactions to see what they'd do)</span>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-bold text-neon-cyan mb-3">What we do NOT collect</h2>
            <ul className="text-sm space-y-2 text-fg ml-4">
              <li className="flex gap-2">
                <span className="text-neon-red shrink-0">✗</span>
                <span>Private keys — never, not ever</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neon-red shrink-0">✗</span>
                <span>Wallet addresses linked to your identity</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neon-red shrink-0">✗</span>
                <span>Browsing history</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neon-red shrink-0">✗</span>
                <span>Analytics/tracking cookies</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neon-red shrink-0">✗</span>
                <span>Third-party fingerprinting</span>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-bold text-neon-cyan mb-3">Data retention</h2>
            <ul className="text-sm space-y-2 text-fg ml-4">
              <li className="flex gap-2">
                <span className="text-neon-green shrink-0">•</span>
                <span>Analysis requests: processed in memory, not persisted</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neon-green shrink-0">•</span>
                <span>Rate-limit counters: ~60 seconds in Redis</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neon-green shrink-0">•</span>
                <span>Anonymous metrics: nothing per-user; only aggregate counts</span>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-bold text-neon-cyan mb-3">Third parties</h2>
            <ul className="text-sm space-y-2 text-fg ml-4">
              <li className="flex gap-2">
                <span className="text-dim shrink-0">•</span>
                <span>Anthropic (api.anthropic.com) — AI analysis</span>
              </li>
              <li className="flex gap-2">
                <span className="text-dim shrink-0">•</span>
                <span>Helius (rpc.helius.xyz) — transaction simulation</span>
              </li>
              <li className="flex gap-2">
                <span className="text-dim shrink-0">•</span>
                <span>Cloudflare — CDN/DDoS</span>
              </li>
              <li className="flex gap-2">
                <span className="text-dim shrink-0">•</span>
                <span>No ad networks, no behavioural tracking</span>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-bold text-neon-cyan mb-3">Open source</h2>
            <p className="text-sm leading-relaxed text-fg">
              Everything we do is public at{' '}
              <a
                href="https://github.com/0xnullpavel/solshield"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neon-cyan hover:text-neon-cyan/80 underline"
              >
                github.com/0xnullpavel/solshield
              </a>{' '}
              — you can audit exactly what we send and how we process it. All Claude prompts are in the repo.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-bold text-neon-cyan mb-3">Contact</h2>
            <p className="text-sm leading-relaxed text-fg">
              <span className="text-neon-amber">security@solshield.dev</span>
            </p>
            <p className="text-sm leading-relaxed text-fg mt-2">
              Responsible disclosure: coordinated via the above email, 90-day window.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-bold text-neon-cyan mb-3">Changes</h2>
            <p className="text-sm leading-relaxed text-fg">
              We'll update this page in-place and bump the "last updated" date. No email notifications — check back periodically.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
