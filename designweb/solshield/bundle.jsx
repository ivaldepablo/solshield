/* ==== MatrixBg.jsx ==== */
/* Matrix-style falling glyph background — subtle, performant */
const MatrixBg = ({ enabled = true }) => {
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf, cols, drops, w, h;
    const chars = '0123456789ABCDEF$SOLABCDEFabcdef{}[]()<>:;.+-*/\\|';
    const fontSize = 13;

    const resize = () => {
      w = canvas.width = window.innerWidth * devicePixelRatio;
      h = canvas.height = window.innerHeight * devicePixelRatio;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      cols = Math.floor(w / (fontSize * devicePixelRatio));
      drops = new Array(cols).fill(0).map(() => Math.random() * -100);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      ctx.fillStyle = 'rgba(7,9,10,0.08)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${fontSize * devicePixelRatio}px "JetBrains Mono", monospace`;
      for (let i = 0; i < cols; i++) {
        const ch = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize * devicePixelRatio;
        const y = drops[i] * fontSize * devicePixelRatio;

        // leading char bright, trail dim
        if (Math.random() > 0.98) {
          ctx.fillStyle = 'rgba(0,255,102,0.9)';
        } else {
          ctx.fillStyle = 'rgba(0,180,70,0.35)';
        }
        ctx.fillText(ch, x, y);

        if (y > h && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [enabled]);

  if (!enabled) return null;
  return <canvas ref={canvasRef} className="matrix-bg" />;
};

window.MatrixBg = MatrixBg;

/* ==== Nav.jsx ==== */
const Nav = () => {
  return (
    <nav className="nav">
      <div className="container nav-inner">
        <a href="#" className="brand" aria-label="SolShield home">
          <span className="brand-mark">§</span>
          <span>solshield<span className="brand-version">/v0.4.10</span></span>
        </a>

        <div className="nav-links" style={{marginLeft: '8px'}}>
          <a href="#features">features</a>
          <a href="#demo">demo</a>
          <a href="#compare">compare</a>
          <a href="#wallets">wallets</a>
          <a href="#install">install</a>
          <a href="#" style={{color: 'var(--fg-2)'}}>/lab</a>
          <a href="#" style={{color: 'var(--fg-2)'}}>/docs</a>
        </div>

        <div className="nav-right">
          <a className="gh-stars" href="https://github.com/0xnullpavel/solshield" target="_blank" rel="noopener noreferrer" title="GitHub">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
            <span>github</span>
          </a>
          <a href="#install" className="btn btn-primary">
            install
            <span className="kbd">⌘K</span>
          </a>
        </div>
      </div>
    </nav>
  );
};

window.Nav = Nav;

/* ==== Hero.jsx ==== */
/* Hero with live typing terminal that simulates scanning a malicious tx */

const HERO_SCRIPT = [
  { t: 'prompt', v: '$ solshield scan --tx 5Kd7Yq...rN4mP2' },
  { t: 'out',    v: 'connecting to mainnet-beta... ok' },
  { t: 'out',    v: 'parsing instructions (4) ... ok' },
  { t: 'out',    v: 'resolving program ids ............ ok' },
  { t: 'spacer' },
  { t: 'kv',     k: 'program  ', v: 'unknown · Drainer77xQ...8aK' },
  { t: 'kv',     k: 'signer   ', v: '7xQdh...m2NpL (your wallet)' },
  { t: 'kv',     k: 'ask      ', v: 'setAuthority + transfer (ALL)' },
  { t: 'spacer' },
  { t: 'out',    v: '▶ running heuristics [████████████] 14/14' },
  { t: 'spacer' },
  { t: 'box-bad', lines: [
    { t: 'bad', v: '  ✗  VERDICT: BLOCK  (confidence 0.97)' },
    { t: 'warn', v: '  ✗  signs ALL token accounts to unknown program' },
    { t: 'warn', v: '  ✗  program flagged by 3 community reporters' },
    { t: 'warn', v: '  ✗  simulation shows net change −$4,218.44' },
  ]},
  { t: 'spacer' },
  { t: 'out',    v: 'transaction blocked before signing. ✓' },
  { t: 'prompt', v: '$ _', noType: true },
];

const Hero = ({ accent = 'triad' }) => {
  const [lineIdx, setLineIdx] = React.useState(0);
  const [charIdx, setCharIdx] = React.useState(0);
  const [done, setDone]       = React.useState(false);
  const [liveTx, setLiveTx]   = React.useState(1420847);

  // Typing animation
  React.useEffect(() => {
    if (done) return;
    const line = HERO_SCRIPT[lineIdx];
    if (!line) { setDone(true); return; }

    // Composite lines (box) render instantly after a pause
    if (line.t === 'spacer' || line.t === 'box-bad' || line.noType) {
      const pause = line.t === 'box-bad' ? 280 : 120;
      const id = setTimeout(() => { setLineIdx(lineIdx + 1); setCharIdx(0); }, pause);
      return () => clearTimeout(id);
    }

    const text = line.v ?? ((line.k || '') + (line.v || ''));
    const full = line.t === 'kv' ? (line.k + line.v) : text;

    if (charIdx < full.length) {
      const speed = line.t === 'prompt' ? 18 : (line.t === 'out' ? 8 : 6);
      const id = setTimeout(() => setCharIdx(charIdx + 1), speed + Math.random() * 10);
      return () => clearTimeout(id);
    } else {
      const id = setTimeout(() => { setLineIdx(lineIdx + 1); setCharIdx(0); }, 60);
      return () => clearTimeout(id);
    }
  }, [lineIdx, charIdx, done]);

  // Live tx ticker
  React.useEffect(() => {
    const id = setInterval(() => setLiveTx(n => n + Math.floor(1 + Math.random() * 4)), 900);
    return () => clearInterval(id);
  }, []);

  const restart = () => { setLineIdx(0); setCharIdx(0); setDone(false); };

  // Build visible lines
  const visible = [];
  for (let i = 0; i < lineIdx; i++) visible.push({ line: HERO_SCRIPT[i], full: true });
  if (!done && HERO_SCRIPT[lineIdx]) visible.push({ line: HERO_SCRIPT[lineIdx], full: false });

  return (
    <section className="hero">
      <div className="container hero-grid">
        <div>
          <div className="hero-eyebrow">
            <span className="pill"><span className="dot" /> live on mainnet-beta</span>
            <span className="tiny" style={{color: 'var(--fg-2)'}}>v0.4.10 · public beta · apr 2026</span>
          </div>

          <h1 className="hero-title">
            The <span className="strike">last mistake</span> <span className="hi">verdict</span> your<br/>
            Solana wallet will ever need.
          </h1>

          <p className="hero-sub">
            SolShield sits between your wallet and the signing prompt. It runs 23 deterministic
            rules + Anthropic <b>Claude Opus 4.7</b> + <b>Haiku 4.5</b> (<b>included by default —
            no API key needed</b>), then shows you a plain-English verdict <em>before</em>
            anything leaves your keys. Open source, self-hostable, every rule and prompt in-tree.
          </p>

          <div className="hero-cta">
            <a href="#install" className="btn btn-primary">
              <span>▸</span> install extension
            </a>
            <a href="#demo" className="btn btn-ghost">see it block a drainer →</a>
          </div>

          <div className="hero-meta">
            <span><span className="dot-ok">●</span> 23 deterministic rules</span>
            <span><span className="dot-ok">●</span> claude opus 4.7 + haiku 4.5</span>
            <span><span className="dot-warn">●</span> auditable prompts in-tree</span>
            <span className="dim">mit licensed</span>
          </div>
        </div>

        <div>
          <div className="term">
            <div className="term-head">
              <div className="term-dots"><i/><i/><i/></div>
              <div className="term-title">~/solshield — scanning tx 5Kd7Yq…rN4mP2</div>
              <div className="term-badge">LIVE</div>
            </div>
            <div className="term-body">
              {visible.map((item, i) => {
                const { line, full } = item;
                if (line.t === 'spacer') return <div key={i} style={{height: 6}} />;
                if (line.t === 'box-bad') {
                  return (
                    <div className="term-box" key={i}>
                      {line.lines.map((l, j) => (
                        <div key={j} className={`term-line term-row-${l.t}`}>
                          <span>{l.v}</span>
                        </div>
                      ))}
                    </div>
                  );
                }
                if (line.t === 'prompt') {
                  const shown = full ? line.v : line.v.slice(0, charIdx);
                  return (
                    <div className="term-line" key={i}>
                      <span className="prompt">›</span>
                      <span>{shown.replace(/^\$ /, '')}{!full && <span className="caret" />}</span>
                    </div>
                  );
                }
                if (line.t === 'kv') {
                  const total = line.k + line.v;
                  const shown = full ? total : total.slice(0, charIdx);
                  const kLen = line.k.length;
                  return (
                    <div className="term-line term-kv" key={i}>
                      <span>{shown.slice(0, kLen)}</span>
                      <b>{shown.slice(kLen)}</b>{!full && <span className="caret" />}
                    </div>
                  );
                }
                // out
                const shown = full ? line.v : line.v.slice(0, charIdx);
                return (
                  <div className="term-line" key={i}>
                    <span className="out">{shown}</span>{!full && <span className="caret" />}
                  </div>
                );
              })}
              {done && (
                <button
                  onClick={restart}
                  style={{
                    marginTop: 12, fontSize: 11, color: 'var(--fg-2)',
                    border: '1px solid var(--br-2)', padding: '4px 10px',
                    borderRadius: 3, letterSpacing: '0.08em', textTransform: 'uppercase'
                  }}
                >↻ replay</button>
              )}
            </div>
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-between',
            marginTop: 12, padding: '0 4px',
            fontSize: 11, color: 'var(--fg-2)', letterSpacing: '0.04em'
          }}>
            <span>tx analyzed since launch</span>
            <span style={{color: 'var(--fg-0)', fontVariantNumeric: 'tabular-nums'}}>
              {liveTx.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};

window.Hero = Hero;

/* ==== StatsStrip.jsx ==== */
const StatsStrip = () => {
  return (
    <section className="stats">
      <div className="container stats-grid">
        <div className="stat">
          <div className="v">23</div>
          <div className="l">deterministic rules</div>
          <div className="d"><span className="up">▲ live</span> · 17 tx + 6 message</div>
        </div>
        <div className="stat">
          <div className="v">2<span className="u"> models</span></div>
          <div className="l">claude opus 4.7 + haiku 4.5</div>
          <div className="d"><span className="up">▲</span> auditable prompts in-tree</div>
        </div>
        <div className="stat">
          <div className="v">~1<span className="u">s</span></div>
          <div className="l">verdict time (p50)</div>
          <div className="d">live on magiceden, jupiter, tensor</div>
        </div>
        <div className="stat">
          <div className="v">v0.4.10</div>
          <div className="l">public beta · apr 2026</div>
          <div className="d"><span className="up">▲</span> 1 maintainer · PRs welcome</div>
        </div>
      </div>
    </section>
  );
};

window.StatsStrip = StatsStrip;

/* ==== Features.jsx ==== */
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
  <section className="section" id="features">
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

/* ==== PoweredByClaude.jsx ==== */
/* PoweredByClaude — dedicated section between Features and Comparison.
 * Differentiator vs Blockaid/Blowfish: we name the model, they don't. */

const PoweredByClaude = () => (
  <section className="section" id="claude">
    <div className="container">
      <div className="section-head">
        <div>
          <div className="kicker">powered by</div>
          <h2>Anthropic Claude.<br/>The same model that wrote this sentence.</h2>
        </div>
        <p>
          Blockaid and Blowfish use proprietary ML models you can't audit. We use{' '}
          <b>Claude Opus 4.7</b> + <b>Haiku 4.5</b> — the same flagship Anthropic models
          anyone can reach via the public API. Every prompt we send lives in the repo.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          marginTop: 24,
        }}
      >
        <article className="feat" style={{borderColor: 'rgba(0, 255, 102, 0.3)'}}>
          <div className="tag" style={{background: 'rgba(0, 255, 102, 0.12)', color: 'var(--ok, #00ff66)'}}>
            triage tier
          </div>
          <div className="feat-icon" style={{color: 'var(--ok, #00ff66)'}}>haiku 4.5</div>
          <h3>Fast, cheap, every non-safe verdict.</h3>
          <p>
            Claude Haiku 4.5 fires only when static rules already flagged the payload.
            ~$0.001/call. Returns a 1-2 sentence plain-English explanation of what's wrong
            with the message you're about to sign.
          </p>
          <div style={{marginTop: 12, fontSize: 11, color: 'var(--fg-2)', fontFamily: 'monospace'}}>
            ≈ 600-1000ms · ≈ $0.001/call
          </div>
        </article>

        <article className="feat" style={{borderColor: 'rgba(255, 171, 0, 0.3)'}}>
          <div className="tag" style={{background: 'rgba(255, 171, 0, 0.12)', color: '#ffab00'}}>
            deep tier
          </div>
          <div className="feat-icon" style={{color: '#ffab00'}}>opus 4.7</div>
          <h3>Heavy lift, transactions only.</h3>
          <p>
            Claude Opus 4.7 escalation for ambiguous transactions: deep instruction-by-instruction
            analysis, authority deltas, CPI ordering, drainer template matching. Triggered only
            when Haiku says "needs deep review".
          </p>
          <div style={{marginTop: 12, fontSize: 11, color: 'var(--fg-2)', fontFamily: 'monospace'}}>
            ≈ 1500-3000ms · ≈ $0.04/call
          </div>
        </article>

        <article className="feat" style={{borderColor: 'rgba(255, 0, 60, 0.25)'}}>
          <div className="tag" style={{background: 'rgba(255, 0, 60, 0.12)', color: '#ff003c'}}>
            zero black box
          </div>
          <div className="feat-icon" style={{color: '#ff003c'}}>{'</prompt>'}</div>
          <h3>Every prompt in the repo.</h3>
          <p>
            <code style={{color: 'var(--fg-0)'}}>packages/ai/src/prompts.ts</code> is 40 lines.
            Read it on GitHub before you trust it. Includes adversarial-input policy so the
            model treats the tx bytes as untrusted data, not as instructions.
          </p>
          <div style={{marginTop: 12, fontSize: 11}}>
            <a
              href="https://github.com/0xnullpavel/solshield/blob/main/packages/ai/src/prompts.ts"
              target="_blank"
              rel="noopener noreferrer"
              className="anchor"
            >
              view prompts on github →
            </a>
          </div>
        </article>
      </div>

      <div
        style={{
          marginTop: 24,
          padding: 18,
          background: 'rgba(0, 255, 102, 0.04)',
          border: '1px solid rgba(0, 255, 102, 0.18)',
          borderRadius: 4,
          fontSize: 13,
          color: 'var(--fg-1)',
          lineHeight: 1.55,
        }}
      >
        <span style={{color: 'var(--ok, #00ff66)', fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 11}}>
          claude included by default · no api key needed
        </span>
        <div style={{marginTop: 6}}>
          Install the extension and the Claude analysis is on. Our hosted backend
          covers every call — Haiku 4.5 + Opus 4.7 — at no cost to you. Want to run
          it on your own infra? Self-host with <code>docker compose up</code> and
          plug in your own <code>ANTHROPIC_API_KEY</code>. Both paths supported.
        </div>
      </div>
    </div>
  </section>
);

window.PoweredByClaude = PoweredByClaude;

/* ==== OverlayDemo.jsx ==== */
/* Interactive overlay demo: toggle between safe, suspicious, and danger transactions.
   Shows SolShield's overlay modal injected into a fake dApp. */

const SCENARIOS = {
  safe: {
    label: 'routine swap',
    host: 'jup.ag',
    https: true,
    title: 'Swap on Jupiter',
    tileA: ['pay', '1.5 SOL'],
    tileB: ['receive', '≈ 228 USDC'],
    verdict: 'ok',
    badge: 'verdict: safe',
    heading: 'Looks routine.',
    rows: [
      ['program', <span>jupiter-aggregator-v6 <span className="ok">✓ verified</span></span>],
      ['action', 'swap 1.5 SOL → 228.14 USDC'],
      ['fees', '~0.000012 SOL'],
      ['net change', <span className="ok">−1.5 SOL, +228.14 USDC</span>],
    ],
    reasons: [
      'program signature matches Jupiter v6 on mainnet',
      'slippage within 0.5% of quoted price',
      'no authority changes, no unknown delegates',
    ],
    cta: 'approve',
  },
  warn: {
    label: 'new contract',
    host: 'new-airdrop-claim.fi',
    https: true,
    title: 'Claim your $FOMO airdrop',
    tileA: ['eligible', '420 $FOMO'],
    tileB: ['fee', '0.02 SOL'],
    verdict: 'warn',
    badge: 'verdict: caution',
    heading: 'Proceed carefully.',
    rows: [
      ['program', <span>unknown · deployed 6h ago</span>],
      ['domain', <span>registered <b>2 days ago</b></span>],
      ['action', 'claim token + approve for spending'],
      ['net change', <span className="warn">−0.02 SOL, +420 unknown token</span>],
    ],
    reasons: [
      'program has no community reports (yet)',
      'requests spending approval for all $FOMO',
      'domain age under 7 days — common rug pattern',
    ],
    cta: 'approve anyway',
  },
  danger: {
    label: 'wallet drainer',
    host: 'solana-airdrop-claim.xyz',
    https: false,
    title: 'Claim 50 SOL airdrop',
    tileA: ['reward', '50 SOL'],
    tileB: ['fee', 'FREE'],
    verdict: 'bad',
    badge: 'verdict: block',
    heading: "Don't sign this.",
    rows: [
      ['program', <span>Drainer77xQ…8aK <span className="bad">✗ flagged</span></span>],
      ['action', 'setAuthority + transfer (ALL)'],
      ['simulation', <span className="bad">−$4,218.44 from your wallet</span>],
      ['reports', <span className="bad">3 community reports · 48 victims</span>],
    ],
    reasons: [
      'transfers EVERY token + NFT to unknown wallet',
      'program matches known drainer fingerprint',
      'domain phishing similarity to solana.com: 94%',
    ],
    cta: 'block transaction',
  },
};

const OverlayDemo = () => {
  const [kind, setKind] = React.useState('danger');
  const s = SCENARIOS[kind];

  return (
    <section className="section" id="demo">
      <div className="container">
        <div className="section-head">
          <div>
            <div className="kicker">the overlay</div>
            <h2>A second pair of eyes<br/>between you and the sign button.</h2>
          </div>
          <p>
            The extension injects a pre-signature review pane into every wallet prompt.
            Toggle below to see how it handles different transactions.
          </p>
        </div>

        <div className="demo-controls">
          {['safe', 'warn', 'danger'].map(k => (
            <button
              key={k}
              className={`${kind === k ? 'active ' + (k === 'safe' ? 'safe' : k === 'warn' ? 'warn' : 'danger') : ''}`}
              onClick={() => setKind(k)}
            >
              {k === 'safe' ? '● safe tx' : k === 'warn' ? '● suspicious' : '● drainer'}
            </button>
          ))}
        </div>

        <div className="demo-wrap">
          <div className="demo-col">
            <header>
              <span className="label">the dApp · {s.label}</span>
              <span className="tiny">wallet: phantom</span>
            </header>

            <div className="browser">
              <div className="browser-bar">
                <div className="dots"><i/><i/><i/></div>
                <div className="url">
                  <span className={s.https ? 'https' : 'bad'}>{s.https ? 'https://' : 'http://'}</span>
                  <span style={{color: s.https ? 'var(--fg-0)' : 'var(--bad)'}}>{s.host}</span>
                  <span style={{color: 'var(--fg-2)'}}>/claim?ref=tg_giveaway</span>
                </div>
              </div>
              <div className="browser-body dim">
                <div className="fake-dapp" style={{filter: 'blur(0.5px)', opacity: 0.9}}>
                  <h3>{s.title}</h3>
                  <div className="host">{s.host}</div>
                  <div className="tile"><span>{s.tileA[0]}</span><b style={{color: 'var(--fg-0)'}}>{s.tileA[1]}</b></div>
                  <div className="tile"><span>{s.tileB[0]}</span><b style={{color: 'var(--fg-0)'}}>{s.tileB[1]}</b></div>
                  <div className="tile" style={{opacity: 0.4}}>…</div>
                </div>

                {/* Overlay modal */}
                <div className={`overlay-modal ${s.verdict}`}>
                  <div className="overlay-head">
                    <span className="brand-mark" style={{
                      background: s.verdict === 'ok' ? 'var(--ok)' : s.verdict === 'warn' ? 'var(--warn)' : 'var(--bad)',
                      color: '#000', width: 18, height: 18, fontSize: 11
                    }}>§</span>
                    <span className="t">{s.heading}</span>
                    <span className="badge" style={{marginLeft: 'auto'}}>{s.badge}</span>
                  </div>
                  <div className="overlay-body">
                    {s.rows.map((r, i) => (
                      <div className="row" key={i}>
                        <span>{r[0]}</span><b>{r[1]}</b>
                      </div>
                    ))}
                    <ul className="reasons" style={{listStyle: 'none', padding: 0, margin: 0}}>
                      {s.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                  <div className="overlay-actions">
                    <button>cancel</button>
                    <button className="block">{s.cta}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="demo-col">
            <header>
              <span className="label">what solshield saw</span>
              <span className="tiny">scan: {kind === 'danger' ? '14/14 fail' : kind === 'warn' ? '11/14 pass' : '14/14 pass'}</span>
            </header>

            <div style={{
              background: 'var(--bg-0)', border: '1px solid var(--br-1)', borderRadius: 6,
              padding: '16px 18px', fontSize: 12.5, lineHeight: 1.7, flex: 1, overflow: 'auto'
            }}>
              <div style={{color: 'var(--fg-2)', marginBottom: 10}}>// program analysis</div>
              <HeuristicRow ok={s.verdict !== 'bad'} label="program id" value={s.verdict === 'bad' ? 'unknown, flagged' : s.verdict === 'warn' ? 'unknown, no reports' : 'verified (jupiter v6)'} />
              <HeuristicRow ok={s.verdict !== 'bad' && s.verdict !== 'warn'} label="domain trust" value={s.verdict === 'bad' ? 'phishing pattern' : s.verdict === 'warn' ? 'age < 7 days' : 'long-standing'} />
              <HeuristicRow ok={s.verdict !== 'bad'} label="authority delta" value={s.verdict === 'bad' ? 'setAuthority on ALL' : 'none'} />
              <HeuristicRow ok={s.verdict === 'ok'} label="token approvals" value={s.verdict === 'bad' ? 'transfer ALL tokens' : s.verdict === 'warn' ? 'unlimited spend on new token' : 'scoped, exact amount'} />
              <HeuristicRow ok={s.verdict !== 'bad'} label="simulation net"  value={s.verdict === 'bad' ? '−$4,218.44' : s.verdict === 'warn' ? '−0.02 SOL + unknown token' : '+228.14 USDC'} />
              <HeuristicRow ok={s.verdict === 'ok'} label="community reports" value={s.verdict === 'bad' ? '3 drainer reports' : s.verdict === 'warn' ? 'none yet' : 'trusted'} />

              <div style={{color: 'var(--fg-2)', margin: '16px 0 6px'}}>// final verdict</div>
              <div style={{
                padding: '10px 12px', borderRadius: 4,
                background: s.verdict === 'bad' ? 'rgba(255,59,83,0.08)' : s.verdict === 'warn' ? 'rgba(255,171,0,0.08)' : 'rgba(0,255,102,0.08)',
                border: `1px solid ${s.verdict === 'bad' ? 'var(--bad)' : s.verdict === 'warn' ? 'var(--warn)' : 'var(--ok)'}`,
                color: s.verdict === 'bad' ? 'var(--bad)' : s.verdict === 'warn' ? 'var(--warn)' : 'var(--ok)',
                fontWeight: 600, letterSpacing: '0.02em'
              }}>
                {s.verdict === 'bad' ? 'BLOCK — 0.97 confidence' :
                 s.verdict === 'warn' ? 'CAUTION — 0.72 confidence' :
                 'ALLOW — 0.99 confidence'}
              </div>

              <div style={{marginTop: 16, color: 'var(--fg-2)', fontSize: 11, lineHeight: 1.5}}>
                verdicts run locally. your tx, seed, and address never leave your machine.
                drainer fingerprints pulled from the community db (offline-cached, updated hourly).
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const HeuristicRow = ({ ok, label, value }) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', gap: 16,
    padding: '4px 0', borderBottom: '1px dashed var(--br-1)'
  }}>
    <span style={{color: 'var(--fg-1)'}}>
      <span style={{color: ok ? 'var(--ok)' : 'var(--bad)', marginRight: 8}}>
        {ok ? '✓' : '✗'}
      </span>
      {label}
    </span>
    <span style={{color: 'var(--fg-0)', textAlign: 'right', fontWeight: 500}}>{value}</span>
  </div>
);

window.OverlayDemo = OverlayDemo;

/* ==== Comparison.jsx ==== */
const CMP_ROWS = [
  { k: 'Pre-signature analysis',     us: '23 deterministic rules + AI', a: 'Proprietary ML', b: 'Proprietary ML', c: 'Heuristics only' },
  { k: 'AI model used',              us: 'Claude Opus 4.7 + Haiku 4.5', a: 'Black box', b: 'Black box', c: '—' },
  { k: 'Auditable rules + prompts',  us: 'YES — every rule + prompt in-tree', a: '—', b: '—', c: 'Partial' },
  { k: 'Self-hostable',              us: 'YES — docker compose', a: '—', b: '—', c: '—' },
  { k: 'Bring your own AI key',      us: 'YES — Anthropic env var', a: '—', b: '—', c: '—' },
  { k: 'ATL (Address Lookup Table)', us: 'YES — resolved server-side', a: 'YES', b: 'YES', c: '—' },
  { k: 'Wallet-agnostic',            us: 'Phantom, Solflare, Backpack, Glow, Trust, Coin98', a: 'Phantom only', b: '2 wallets', c: '1 wallet' },
  { k: 'Open source',                us: 'MIT — github.com/0xnullpavel/solshield', a: '—', b: '—', c: 'Partial' },
  { k: 'Cost (individual)',          us: 'Free forever',         a: 'B2B only', b: 'B2B only', c: '$9/mo' },
];

const Cell = ({ v, col }) => {
  const cls = col === 'us' ? 'us-col' : '';
  let content = v;
  if (v === 'Yes') content = <span className="cmp-cross">✗ {v}</span>;
  else if (v === '—') content = <span className="cmp-dash">— not offered</span>;
  else if (col === 'us') content = <span className="cmp-check">✓ {v}</span>;
  else if (v === 'Basic' || v === 'Partial') content = <span className="cmp-partial">~ {v}</span>;
  else if (v === 'Cloud only' || v === 'Proprietary' || v === 'Phantom only' || v === '2 wallets' || v === '1 wallet' || v.includes('$') || v.includes('ads'))
    content = <span className="cmp-partial">~ {v}</span>;
  return <div className={cls}>{content}</div>;
};

const Comparison = () => (
  <section className="section" id="compare">
    <div className="container">
      <div className="section-head">
        <div>
          <div className="kicker">the honest table</div>
          <h2>Other tools promised safety.<br/>We actually show our work.</h2>
        </div>
        <p>
          Competitor names blurred for legal comfort; features are accurate as of Apr 2026.
          Open a PR if we got something wrong — we link to the receipts.
        </p>
      </div>

      <div className="cmp">
        <div className="cmp-head">
          <div>capability</div>
          <div className="us">solshield</div>
          <div>■■■■■ (A)</div>
          <div>■■■■■ (B)</div>
          <div>■■■■■ (C)</div>
        </div>
        {CMP_ROWS.map((r, i) => (
          <div className="cmp-row" key={i}>
            <div>{r.k}</div>
            <Cell v={r.us} col="us" />
            <Cell v={r.a} />
            <Cell v={r.b} />
            <Cell v={r.c} />
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 16, fontSize: 11, color: 'var(--fg-2)',
        display: 'flex', gap: 16, flexWrap: 'wrap'
      }}>
        <span><span className="ok">✓</span> we do this</span>
        <span><span className="warn">~</span> partially / with caveats</span>
        <span><span className="bad">✗</span> they do this (not good)</span>
        <span><span className="dim">—</span> not offered</span>
        <span style={{marginLeft: 'auto'}}>
          <a className="anchor" href="#">see full comparison on /security →</a>
        </span>
      </div>
    </div>
  </section>
);

window.Comparison = Comparison;

/* ==== Wallets.jsx ==== */
/* Real wallet logos — simplified inline SVGs that respect each wallet's brand
 * color. Replaces the previous letter-glyph placeholders. */

const PhantomLogo = () => (
  <svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-label="Phantom">
    <rect width="128" height="128" rx="22" fill="#AB9FF2" />
    <path d="M110.6 64C110.6 38.3 89.7 17.4 64 17.4S17.4 38.3 17.4 64c0 23.4 17.3 42.7 39.8 46v-23.2H47.7c-2.7 0-4.9-2.2-4.9-4.9V47.6c0-2.7 2.2-4.9 4.9-4.9h32.6c2.7 0 4.9 2.2 4.9 4.9v34.3c0 2.7-2.2 4.9-4.9 4.9H70.8V110c22.5-3.3 39.8-22.6 39.8-46z" fill="#FFF"/>
    <circle cx="55" cy="62" r="5.5" fill="#AB9FF2"/>
    <circle cx="78" cy="62" r="5.5" fill="#AB9FF2"/>
  </svg>
);

const SolflareLogo = () => (
  <svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-label="Solflare">
    <defs>
      <linearGradient id="sf-g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#FFC10B"/>
        <stop offset="100%" stopColor="#FB6116"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="22" fill="#0E0E0E"/>
    <circle cx="64" cy="64" r="34" fill="url(#sf-g)"/>
    <circle cx="64" cy="64" r="14" fill="#0E0E0E"/>
  </svg>
);

const BackpackLogo = () => (
  <svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-label="Backpack">
    <rect width="128" height="128" rx="22" fill="#E33E3F"/>
    <path d="M40 38h48v52H40z" fill="#FFF" opacity="0.95"/>
    <rect x="50" y="30" width="28" height="14" rx="6" fill="none" stroke="#FFF" strokeWidth="4"/>
    <rect x="48" y="60" width="32" height="6" rx="2" fill="#E33E3F"/>
  </svg>
);

const GlowLogo = () => (
  <svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-label="Glow">
    <defs>
      <radialGradient id="gl-g" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#FFE066"/>
        <stop offset="100%" stopColor="#FFB800"/>
      </radialGradient>
    </defs>
    <rect width="128" height="128" rx="22" fill="#1A1A1A"/>
    <circle cx="64" cy="64" r="42" fill="url(#gl-g)"/>
    <circle cx="64" cy="64" r="42" fill="none" stroke="#FFE066" strokeWidth="2" opacity="0.4"/>
  </svg>
);

const TrustLogo = () => (
  <svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-label="Trust Wallet">
    <rect width="128" height="128" rx="22" fill="#0500FF"/>
    <path d="M64 28L40 38v22c0 18 11 33 24 40 13-7 24-22 24-40V38L64 28z" fill="#FFF"/>
  </svg>
);

const Coin98Logo = () => (
  <svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-label="Coin98">
    <rect width="128" height="128" rx="22" fill="#D4B04A"/>
    <path d="M64 24c22 0 40 18 40 40s-18 40-40 40-40-18-40-40 18-40 40-40zm0 14c-14.4 0-26 11.6-26 26s11.6 26 26 26c8 0 15.2-3.6 20-9.4l-9.4-7.4c-2.6 3.2-6.6 5.2-10.6 5.2-7.6 0-13.4-5.8-13.4-14.4 0-8.6 5.8-14.4 13.4-14.4 4 0 8 2 10.6 5.2L84 47.4C79.2 41.6 72 38 64 38z" fill="#0E0E0E"/>
  </svg>
);

const StandardLogo = () => (
  <svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-label="Wallet Standard">
    <rect width="128" height="128" rx="22" fill="#0E0E0E"/>
    <text x="64" y="86" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="68" fontWeight="700" fill="#00FF66">§</text>
  </svg>
);

const WALLETS = [
  { name: 'Phantom',           Logo: PhantomLogo,  state: 'supported' },
  { name: 'Solflare',          Logo: SolflareLogo, state: 'supported' },
  { name: 'Backpack',          Logo: BackpackLogo, state: 'supported' },
  { name: 'Glow',              Logo: GlowLogo,     state: 'supported' },
  { name: 'Trust',             Logo: TrustLogo,    state: 'supported' },
  { name: 'Coin98',            Logo: Coin98Logo,   state: 'supported' },
  { name: 'wallet-standard',   Logo: StandardLogo, state: 'supported' },
];

const Wallets = () => (
  <section className="section" id="wallets">
    <div className="container">
      <div className="section-head">
        <div>
          <div className="kicker">wallet coverage</div>
          <h2>If it speaks wallet-standard,<br/>SolShield speaks back.</h2>
        </div>
        <p>
          Every major Solana wallet plus anything that implements the wallet-standard
          spec. No RPC hijack, no permission escalation. All 6 wallets below verified
          live against magiceden + jupiter + tensor.
        </p>
      </div>

      <div className="wallets">
        {WALLETS.map(w => {
          const Logo = w.Logo;
          return (
            <div className="wallet" key={w.name} title={`${w.name} · ${w.state}`}>
              <div className="glyph"><Logo /></div>
              <span className="name">{w.name}</span>
              <span className={`state ${w.state !== 'supported' ? w.state : ''}`}>
                {w.state === 'supported' ? '●' : w.state === 'beta' ? 'β' : '…'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  </section>
);

window.Wallets = Wallets;

/* ==== Install.jsx ==== */
const Install = () => {
  const [copied, setCopied] = React.useState(false);
  const [tab, setTab] = React.useState('chrome');

  const snippets = {
    chrome: `# chromium-based (chrome, brave, arc, edge)
git clone https://github.com/0xnullpavel/solshield
cd solshield && pnpm install
pnpm -F @solshield/extension build
# chrome > chrome://extensions > developer mode ON
# > load unpacked > apps/extension/build/chrome-mv3-prod`,
    api: `# call the SolShield API directly (POST)
curl -X POST https://solshield.dev/api/inspect-message \\
  -H 'content-type: application/json' \\
  -d '{"message":"phishing.com wants you to sign in...","origin":"https://magiceden.io"}'
# returns { verdict, score, findings[], summary }`,
    selfhost: `# fully self-host the API + dashboard
git clone https://github.com/0xnullpavel/solshield
cd solshield && cp .env.example .env
# add your ANTHROPIC_API_KEY + SOLANA_RPC_URL
docker compose up -d
# now point the extension at http://localhost:3000`,
  };

  const copy = () => {
    navigator.clipboard.writeText(snippets[tab]).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // Build React children directly; no string-tag intermediate.
  const tokenize = (s) => {
    const keywords = /\b(git clone|cd|pnpm install|pnpm build|curl|visit|sh|solshield)\b/;
    const url = /(https?:\/\/\S+)/;
    const param = /(--\w+|<[a-zA-Z-]+>)/;
    const mk = (text, cls) => ({ text, cls });

    const splitBy = (chunks, re, cls) => {
      const out = [];
      for (const ch of chunks) {
        if (ch.cls) { out.push(ch); continue; }
        const parts = ch.text.split(re);
        parts.forEach((p, i) => {
          if (!p) return;
          // Odd indices are captured groups (the match)
          out.push(mk(p, i % 2 === 1 ? cls : null));
        });
      }
      return out;
    };

    return s.split('\n').map((line, i) => {
      if (line.startsWith('#')) {
        return <div key={i}><span className="tok-c">{line}</span></div>;
      }
      let chunks = [{ text: line, cls: null }];
      chunks = splitBy(chunks, keywords, 'tok-k');
      chunks = splitBy(chunks, url, 'tok-s');
      chunks = splitBy(chunks, param, 'tok-p');
      return (
        <div key={i}>
          {chunks.map((c, j) =>
            c.cls
              ? <span key={j} className={c.cls}>{c.text}</span>
              : <span key={j}>{c.text}</span>
          )}
        </div>
      );
    });
  };

  return (
    <section className="section" id="install">
      <div className="container">
        <div className="install">
          <div>
            <div className="kicker" style={{marginBottom: 14}}>get it</div>
            <h3 style={{marginBottom: 18, lineHeight: 1.25}}>Install in under 60 seconds. Uninstall if it fails you once.</h3>
            <p>
              Free forever. No sign-up. No cloud account. Your wallet keeps its privacy
              and you get a second brain that reads ASM for breakfast.
            </p>

            <div style={{display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20}}>
              <a
                href="https://github.com/0xnullpavel/solshield#install"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >▸ chrome (load unpacked)</a>
              <a
                href="https://github.com/0xnullpavel/solshield"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost"
              >github source</a>
            </div>

            <div style={{fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.7}}>
              <div>v0.4.10 · public beta · MIT licensed</div>
              <div style={{color: 'var(--fg-1)'}}>
                Chrome Web Store listing pending · pnpm build + Load Unpacked works today.
              </div>
            </div>
          </div>

          <div>
            <div className="code-block">
              <div className="cb-head">
                <div style={{display: 'flex', gap: 4}}>
                  {['chrome', 'api', 'selfhost'].map(t => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      style={{
                        padding: '2px 8px',
                        background: tab === t ? 'var(--bg-2)' : 'transparent',
                        color: tab === t ? 'var(--ok)' : 'var(--fg-2)',
                        border: '1px solid',
                        borderColor: tab === t ? 'var(--br-2)' : 'transparent',
                        borderRadius: 3,
                        fontSize: 11,
                        letterSpacing: '0.04em',
                        cursor: 'pointer',
                      }}
                    >{t}</button>
                  ))}
                </div>
                <button className={`cb-copy ${copied ? 'copied' : ''}`} onClick={copy}>
                  {copied ? '✓ copied' : 'copy'}
                </button>
              </div>
              <pre>{tokenize(snippets[tab])}</pre>
            </div>

            <div style={{
              marginTop: 12, fontSize: 11, color: 'var(--fg-2)',
              display: 'flex', gap: 14, flexWrap: 'wrap'
            }}>
              <span>⎆ signed builds</span>
              <span>⎆ reproducible from source</span>
              <span>⎆ sha256 pinned</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

window.Install = Install;

/* ==== Footer.jsx ==== */
const Footer = () => (
  <footer className="site">
    <div className="container">
      <div className="foot-grid">
        <div className="foot-col">
          <div className="brand" style={{marginBottom: 14}}>
            <span className="brand-mark">§</span>
            <span>solshield</span>
          </div>
          <div style={{color: 'var(--fg-1)', fontSize: 13, maxWidth: '36ch', lineHeight: 1.6}}>
            Open source pre-signature firewall for Solana. Built by people who have lost SOL
            and don't plan to do it again.
          </div>
          <div style={{marginTop: 14, fontSize: 11, color: 'var(--fg-2)'}}>
            solshield.dev · mainnet-beta · v0.4.10
          </div>
          <div style={{marginTop: 10, fontSize: 11, color: 'var(--fg-2)'}}>
            <span style={{color: 'var(--ok, #00ff66)'}}>powered by claude</span> and{' '}
            <a
              href="https://github.com/0xnullpavel/solshield"
              target="_blank"
              rel="noopener noreferrer"
              style={{color: '#ffab00'}}
            >
              0xnullpavel
            </a>
          </div>
        </div>

        <div className="foot-col">
          <h4>product</h4>
          <ul>
            <li><a href="#features">features</a></li>
            <li><a href="#demo">demo</a></li>
            <li><a href="#install">install</a></li>
            <li><a href="#compare">compare</a></li>
            <li><a href="#wallets">wallets</a></li>
          </ul>
        </div>

        <div className="foot-col">
          <h4>project</h4>
          <ul>
            <li><a href="https://github.com/0xnullpavel/solshield" target="_blank" rel="noopener noreferrer">github</a></li>
            <li><a href="https://github.com/0xnullpavel/solshield/blob/main/packages/core/src/rules.ts" target="_blank" rel="noopener noreferrer">view 23 rules</a></li>
            <li><a href="https://github.com/0xnullpavel/solshield/blob/main/packages/ai/src/prompts.ts" target="_blank" rel="noopener noreferrer">view AI prompts</a></li>
            <li><a href="https://github.com/0xnullpavel/solshield/issues" target="_blank" rel="noopener noreferrer">issues</a></li>
            <li><a href="https://github.com/0xnullpavel/solshield/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">changelog</a></li>
          </ul>
        </div>

        <div className="foot-col">
          <h4>contact</h4>
          <ul>
            <li><a href="mailto:hi@solshield.dev">hi@solshield.dev</a></li>
            <li><a href="https://github.com/0xnullpavel" target="_blank" rel="noopener noreferrer">@0xnullpavel</a></li>
          </ul>
        </div>
      </div>

      <div className="foot-bottom">
        <div>© 2026 solshield · MIT licensed · not financial advice, not a wallet, not your keys</div>
        <div className="easter">/* if you can read this, you're probably safe */</div>
      </div>
    </div>
  </footer>
);

window.Footer = Footer;

/* ==== Tweaks.jsx ==== */
const Tweaks = ({ state, setState }) => {
  const [open, setOpen] = React.useState(false);

  // Listen for host toggle
  React.useEffect(() => {
    const onMsg = (e) => {
      if (e.data?.type === '__activate_edit_mode') setOpen(true);
      if (e.data?.type === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    // announce availability AFTER listener is wired
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const persist = (edits) => {
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*');
  };

  const update = (k, v) => {
    setState(s => ({ ...s, [k]: v }));
    persist({ [k]: v });
  };

  if (!open) return null;

  return (
    <aside className="tweaks">
      <div className="tweaks-head">
        <span>tweaks · solshield</span>
        <span className="close" onClick={() => setOpen(false)}>×</span>
      </div>
      <div className="tweaks-body">
        <div className="tweak-row">
          <label>accent palette</label>
          <div className="tweak-opts">
            {[
              ['triad', 'triad'],
              ['duo', 'duo'],
              ['cyan', 'cyan'],
              ['amber', 'amber'],
            ].map(([k, label]) => (
              <button key={k} className={state.accent === k ? 'on' : ''} onClick={() => update('accent', k)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="tweak-row">
          <label>hero style</label>
          <div className="tweak-opts">
            {[
              ['terminal', 'terminal'],
              ['minimal',  'minimal'],
              ['wide',     'wide copy'],
            ].map(([k, label]) => (
              <button key={k} className={state.heroStyle === k ? 'on' : ''} onClick={() => update('heroStyle', k)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="tweak-row">
          <label>density</label>
          <div className="tweak-opts">
            {['airy', 'medium', 'dense'].map(k => (
              <button key={k} className={state.density === k ? 'on' : ''} onClick={() => update('density', k)}>{k}</button>
            ))}
          </div>
        </div>

        <div className="tweak-row tweak-toggle">
          <label style={{margin: 0}}>matrix background</label>
          <div className={`sw ${state.matrixBg ? 'on' : ''}`} onClick={() => update('matrixBg', !state.matrixBg)} />
        </div>

        <div className="tweak-row tweak-toggle">
          <label style={{margin: 0}}>live ticker</label>
          <div className={`sw ${state.liveTicker ? 'on' : ''}`} onClick={() => update('liveTicker', !state.liveTicker)} />
        </div>
      </div>
    </aside>
  );
};

window.Tweaks = Tweaks;

/* ==== app.jsx ==== */
/* SolShield main app — wires together the landing page */

const _raw = document.getElementById('TWEAK_DEFAULTS').textContent
  .replace(/\/\*[\s\S]*?\*\//g, '').trim();
const DEFAULTS = JSON.parse(_raw);

const App = () => {
  const [state, setState] = React.useState(DEFAULTS);

  // Apply tweaks to <html>
  React.useEffect(() => {
    document.documentElement.dataset.accent = state.accent;
    document.documentElement.dataset.density = state.density;
    document.documentElement.dataset.hero = state.heroStyle;
  }, [state]);

  return (
    <>
      <window.MatrixBg enabled={state.matrixBg} />
      <div style={{position: 'relative', zIndex: 1}}>
        <window.Nav />
        <window.Hero accent={state.accent} heroStyle={state.heroStyle} />
        <window.StatsStrip ticker={state.liveTicker} />
        <window.Features />
        <window.PoweredByClaude />
        <window.OverlayDemo />
        <window.Comparison />
        <window.Wallets />
        <window.Install />
        <window.Footer />
      </div>
      <window.Tweaks state={state} setState={setState} />
    </>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
