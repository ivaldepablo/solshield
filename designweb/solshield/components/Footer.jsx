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
