import Link from 'next/link';

const CLAUDE_AMBER = '#ffab00';

// Real phishing URLs from our blocklist. Curated set — these are the names of
// known typosquats / fake claim sites. Domains may or may not still resolve;
// SolShield blocks them regardless via the embedded blocklist + heuristics.
const PHISHING_URLS: Array<{ url: string; spoofs: string; reason: string }> = [
  {
    url: 'http://jupitor-claim.io',
    spoofs: 'jup.ag (Jupiter)',
    reason: 'typo + scam keyword "claim"',
  },
  {
    url: 'http://phantom-login.com',
    spoofs: 'phantom.app',
    reason: 'fake login page for Phantom wallet',
  },
  {
    url: 'http://phantorn.app',
    spoofs: 'phantom.app',
    reason: '1-letter typo (m → rn)',
  },
  {
    url: 'http://solana-airdrop.net',
    spoofs: 'solana.com',
    reason: 'brand + "airdrop" scam keyword',
  },
  {
    url: 'http://magiceden-mint.com',
    spoofs: 'magiceden.io',
    reason: 'fake NFT mint page',
  },
  {
    url: 'http://wormhole-bridge.net',
    spoofs: 'wormhole.com',
    reason: 'fake bridge to drain wallets',
  },
  {
    url: 'http://free-sol.io',
    spoofs: 'solana.com',
    reason: '"free SOL" — classic giveaway scam',
  },
];

const REAL_DAPPS: Array<{ name: string; url: string; what: string }> = [
  {
    name: 'Jupiter',
    url: 'https://jup.ag',
    what: 'real DEX — try a token swap, see SAFE verdict before signing',
  },
  {
    name: 'Magic Eden',
    url: 'https://magiceden.io',
    what: 'NFT marketplace — sign-in messages get analyzed live',
  },
  {
    name: 'Tensor',
    url: 'https://tensor.trade',
    what: 'NFT trading — bid/list signing flows tested',
  },
  {
    name: 'Drift',
    url: 'https://drift.trade',
    what: 'perpetuals — order placement signing',
  },
];

export default function RealTestPage() {
  return (
    <div className="min-h-screen bg-bg text-fg font-mono">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        <h1 className="text-2xl sm:text-3xl font-bold text-neon-green mb-2">
          // test it for real
        </h1>
        <p className="text-mute text-sm mb-8 leading-relaxed">
          three real ways to confirm the SolShield extension is doing its job — no
          test pages, no fake mocks. just real scam URLs from our blocklist + real
          dapps + real wallets.
        </p>

        {/* TEST 1 — domain blocker */}
        <Section
          number={1}
          title="domain blocker — instant, no wallet"
          description="click any of these phishing URLs (they're in our embedded blocklist). the extension fires at document_start and shows a full-page red warning before the site loads."
        >
          <ul className="space-y-2">
            {PHISHING_URLS.map((p) => (
              <li key={p.url}>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block border border-neon-red/30 bg-neon-red/5 p-3 hover:bg-neon-red/10 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-neon-red font-bold text-sm break-all">
                        {p.url} ↗
                      </div>
                      <div className="text-mute text-[11px] mt-1">
                        spoofs <span className="text-fg">{p.spoofs}</span> · {p.reason}
                      </div>
                    </div>
                    <span className="text-neon-red text-xl shrink-0">⚠</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
          <Note>
            opens in a new tab. with SolShield active, you&apos;ll see the red warning
            instantly. some of these sites are dead now (sites get taken down) — the
            extension blocks them anyway because the hostname matches the embedded
            blocklist.
          </Note>
        </Section>

        {/* TEST 2 — real dapp on devnet */}
        <Section
          number={2}
          title="real wallet on devnet (zero risk)"
          description="use a Phantom wallet on Devnet — fake SOL, no real money — to test SolShield against actual dapps."
        >
          <ol className="space-y-2 text-sm">
            <Step n={1}>
              install Phantom (if you haven&apos;t):{' '}
              <External href="https://phantom.app">phantom.app</External>
            </Step>
            <Step n={2}>
              switch to Devnet: Phantom popup → settings ⚙ → Developer Settings →{' '}
              <Code>Testnet Mode</Code> → select <Code>Devnet</Code>
            </Step>
            <Step n={3}>
              get free devnet SOL:{' '}
              <External href="https://faucet.solana.com">faucet.solana.com</External>{' '}
              (paste your address, request 1 SOL)
            </Step>
            <Step n={4}>
              visit any of these real dapps with the SolShield extension loaded:
            </Step>
          </ol>
          <ul className="mt-3 space-y-2">
            {REAL_DAPPS.map((d) => (
              <li
                key={d.url}
                className="border border-neon-green/20 bg-bg/40 p-3 flex items-baseline justify-between gap-3"
              >
                <div>
                  <External href={d.url}>
                    <span className="text-neon-green font-bold">{d.name}</span>{' '}
                    <span className="text-dim text-xs">{d.url.replace('https://', '')}</span>
                  </External>
                  <p className="text-mute text-[11px] mt-1">{d.what}</p>
                </div>
              </li>
            ))}
          </ul>
          <Note>
            try to do a swap or sign a sign-in message. before Phantom opens its own
            confirmation popup, SolShield should show its overlay with the verdict
            (almost always SAFE for real dapps). reject in SolShield → Phantom popup
            never appears.
          </Note>
        </Section>

        {/* TEST 3 — known signing flows */}
        <Section
          number={3}
          title="sign-in flows that trigger message analysis"
          description="dapps that ask you to sign a SIWS message to log in. SolShield analyzes the message text against its message rules (siws-spoof, permit-style, url-in-message...)."
        >
          <ul className="space-y-2">
            <li className="border border-neon-cyan/20 bg-bg/40 p-3">
              <External href="https://magiceden.io">magiceden.io</External>{' '}
              <span className="text-mute text-xs">— click "Sign in" → SIWS message</span>
            </li>
            <li className="border border-neon-cyan/20 bg-bg/40 p-3">
              <External href="https://zora.co">zora.co</External>{' '}
              <span className="text-mute text-xs">— sign-in flow with Solana wallet</span>
            </li>
            <li className="border border-neon-cyan/20 bg-bg/40 p-3">
              <External href="https://tensor.trade">tensor.trade</External>{' '}
              <span className="text-mute text-xs">— wallet connection signs a verification message</span>
            </li>
          </ul>
          <Note>
            for these, even mainnet is safe — you&apos;re just signing a login message,
            not a transaction. nothing moves on chain. SolShield should return SAFE
            because the message domain matches the page origin.
          </Note>
        </Section>

        {/* Demo link */}
        <Section
          number={4}
          title="visual demo (for screenshots / showing people)"
          description="a polished fake scam — perfect for screen recording. shows the full overlay flow without you having to leave the site."
        >
          <Link
            href="/demo"
            className="inline-block px-5 py-3 border-2 border-neon-red text-neon-red bg-neon-red/10 hover:bg-neon-red/20 transition-colors font-bold tracking-[0.15em] uppercase text-sm"
          >
            ▶ open the visual demo
          </Link>
        </Section>

        <div className="mt-12 pt-6 border-t border-neon-green/15 text-center text-mute text-xs">
          <span style={{ color: CLAUDE_AMBER }}>✦</span> every signing analysis runs
          through Claude (haiku 4.5 → opus 4.7 if ambiguous).{' '}
          <Link href="/privacy" className="text-neon-cyan hover:text-neon-cyan/80">
            privacy
          </Link>{' '}
          ·{' '}
          <a
            href="https://github.com/0xnullpavel/solshield"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neon-cyan hover:text-neon-cyan/80"
          >
            github
          </a>
        </div>
      </main>
    </div>
  );
}

function Section({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 border border-neon-green/15 bg-panel/20 p-5">
      <header className="flex items-baseline gap-3 mb-2">
        <span className="text-neon-green font-bold text-2xl">{number}.</span>
        <h2 className="text-neon-cyan text-sm tracking-[0.15em] uppercase font-bold">
          {title}
        </h2>
      </header>
      <p className="text-mute text-sm mb-4 leading-relaxed">{description}</p>
      {children}
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="text-neon-green font-bold w-5 shrink-0">{n}.</span>
      <span className="text-fg leading-relaxed">{children}</span>
    </li>
  );
}

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-neon-cyan hover:text-neon-cyan/80 underline decoration-dotted"
    >
      {children} ↗
    </a>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-bg border border-neon-green/20 px-1.5 py-0.5 text-[12px] text-neon-cyan">
      {children}
    </code>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-dim text-[11px] mt-3 leading-relaxed border-l-2 border-neon-green/20 pl-3">
      {children}
    </p>
  );
}

function Header() {
  return (
    <nav className="flex items-center justify-between px-4 sm:px-8 py-2.5 border-b border-neon-green/20 bg-bg/85 backdrop-blur-md sticky top-0 z-20">
      <Link href="/" className="flex items-center gap-3">
        <div className="w-6 h-6 border border-neon-green flex items-center justify-center text-neon-green text-xs font-bold">
          ∆
        </div>
        <span className="text-sm tracking-[0.25em] text-neon-green font-bold">SOLSHIELD</span>
        <span className="text-dim text-[10px] tracking-[0.2em] hidden sm:inline">
          / REAL TEST
        </span>
      </Link>
      <Link
        href="/"
        className="text-mute hover:text-neon-cyan text-[11px] tracking-[0.2em] uppercase"
      >
        [ home ]
      </Link>
    </nav>
  );
}
