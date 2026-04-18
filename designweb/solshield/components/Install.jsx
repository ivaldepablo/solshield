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
