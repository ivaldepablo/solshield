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
