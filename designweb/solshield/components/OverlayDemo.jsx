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
