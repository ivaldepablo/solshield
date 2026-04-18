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
