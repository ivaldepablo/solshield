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
