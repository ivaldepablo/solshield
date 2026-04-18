const FEATURES = [
  {
    n: '01',
    tag: 'core',
    title: 'Pre-signature simulation',
    desc: 'Every tx is simulated against mainnet state via Helius RPC + Address Lookup Table resolution. See exact balance deltas before you sign — not vague "this may drain your wallet" disclaimers.',
  },
  {
    n: '02',
    tag: 'core',
    title: '23 deterministic rules',
    desc: '17 transaction rules + 6 message rules in packages/core/src/rules.ts. Authority deltas, unlimited approvals, ATL gaps, drainer templates, SIWS spoof, permit-style approvals — all auditable, all in-tree, send a PR.',
  },
  {
    n: '03',
    tag: 'core',
    title: 'Claude AI explainer',
    desc: 'Every non-safe verdict gets a plain-English explanation from Anthropic Claude Haiku 4.5 (~$0.001/call). Transactions escalate to Opus 4.7 for deep analysis. Prompts in /packages/ai/src/prompts.ts — no black box.',
  },
  {
    n: '04',
    tag: 'trust',
    title: 'Anonymous payloads, self-hostable',
    desc: 'Tx bytes are sent to our API for AI analysis but never your IP, wallet address, or identity. Want zero outbound? Fork + docker compose up — the entire stack on your own box.',
  },
  {
    n: '05',
    tag: 'trust',
    title: 'Open source, auditable',
    desc: 'MIT licensed. 104 unit tests in packages/core. Every rule + every Claude prompt readable in tree. No proprietary blackbox to "trust us" on.',
  },
  {
    n: '06',
    tag: 'trust',
    title: 'Wallet-agnostic',
    desc: 'Works with Phantom, Solflare, Backpack, Glow, Trust, Coin98 — any wallet that implements wallet-standard. No RPC hijack, no permission escalation.',
  },
  {
    n: '07',
    tag: 'power',
    title: 'SolShield /lab',
    desc: 'Live ticker of analyzed transactions with verdicts, ASCII matrix rain, terminal-style debug. Watch the firewall scan in real time.',
  },
  {
    n: '08',
    tag: 'power',
    title: '4-layer focus-steal defense',
    desc: 'In-page overlay + chrome.notifications system toast + toolbar badge + standalone popup window. Wallet popups (like Phantom\'s notification.html) cannot steal focus from the warning.',
  },
  {
    n: '09',
    tag: 'power',
    title: 'Anti-spoof decision protocol',
    desc: 'CustomEvent + stopImmediatePropagation in capture-phase across MAIN+ISOLATED worlds. Malicious dapps cannot forge "proceed" decisions. Verified live: 60+ spoof attempts blocked.',
  },
];

const Features = () => (
  <section className="section" id="features" style={{paddingTop: 'clamp(72px, 10vw, 112px)'}}>
    <div className="container">
      <div className="section-head">
        <div>
          <div className="kicker">what's inside</div>
          <h2>Everything a paranoid dev would build<br/>for their own wallet. Shipped.</h2>
        </div>
        <p>
          We started SolShield because every "wallet security" product we tried was either a
          cloud upsell or a checkbox. This is the opposite of that.
        </p>
      </div>

      <div className="features-grid">
        {FEATURES.map(f => (
          <article className="feat" key={f.n}>
            <div className="tag">{f.tag}</div>
            <div className="feat-icon">{f.n}</div>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </article>
        ))}
      </div>
    </div>
  </section>
);

window.Features = Features;
