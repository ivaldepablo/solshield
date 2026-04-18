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
