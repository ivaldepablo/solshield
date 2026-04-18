const WALLETS = [
  { name: 'Phantom',   bg: '#ab9ff2', ch: 'P', state: 'supported' },
  { name: 'Solflare',  bg: '#fc7227', ch: 'S', state: 'supported' },
  { name: 'Backpack',  bg: '#e33e3f', ch: 'B', state: 'supported' },
  { name: 'Glow',      bg: '#ffb800', ch: 'G', state: 'supported' },
  { name: 'Trust',     bg: '#3375bb', ch: 'T', state: 'supported' },
  { name: 'Coin98',    bg: '#d4b04a', ch: 'C', state: 'supported' },
  { name: 'wallet-standard', bg: '#00ff66', ch: '§', state: 'supported' },
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
          spec. No RPC hijack, no permission escalation.
        </p>
      </div>

      <div className="wallets">
        {WALLETS.map(w => (
          <div className="wallet" key={w.name} title={`${w.name} · ${w.state}`}>
            <div className="glyph" style={{background: w.bg, color: w.bg === '#ffb800' || w.bg === '#00ff66' ? '#000' : '#fff'}}>{w.ch}</div>
            <span className="name">{w.name}</span>
            <span className={`state ${w.state !== 'supported' ? w.state : ''}`}>
              {w.state === 'supported' ? '●' : w.state === 'beta' ? 'β' : '…'}
            </span>
          </div>
        ))}
      </div>
    </div>
  </section>
);

window.Wallets = Wallets;
