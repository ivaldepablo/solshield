/**
 * Warning popup window — Layer 4 of focus-steal defense.
 *
 * Plasmo convention `tabs/warning.tsx` → `tabs/warning.html` in the build,
 * accessible via chrome.runtime.getURL('tabs/warning.html'). Background SW
 * opens this in its own browser window via chrome.windows.create({type:
 * 'popup'}) when overlay-mount fires a non-safe verdict.
 *
 * Lives outside the dapp page DOM (immune to Magic Eden's modal hiding our
 * in-page overlay) and outside the tab compositor (immune to Phantom's
 * notification.html stealing tab focus). It's a real Chrome window the user
 * can't miss.
 *
 * Pure information — the actual REJECT/PROCEED decision still happens via
 * the in-page overlay so the wallet wrapper resolves correctly. The CTA
 * here focuses the originating dapp tab so the user gets back to the
 * decision UI fast.
 *
 * Verdict payload arrives as a JSON-encoded URL hash fragment.
 */

import { useEffect, useState, type CSSProperties } from 'react';

interface Payload {
  verdict: 'safe' | 'suspicious' | 'danger';
  score?: number;
  summary?: string;
  hostname?: string;
  tabId?: number;
  findings?: Array<{ ruleId?: string; severity?: string; message?: string }>;
}

function readPayload(): Payload {
  try {
    const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!raw) return { verdict: 'suspicious' };
    return JSON.parse(raw) as Payload;
  } catch {
    return { verdict: 'suspicious' };
  }
}

function getVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '?';
  }
}

function focusDappTab(tabId?: number): void {
  if (typeof tabId !== 'number' || tabId <= 0) {
    try { window.close(); } catch { /* ignore */ }
    return;
  }
  try {
    void chrome.tabs.update(tabId, { active: true });
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.windowId) void chrome.windows.update(tab.windowId, { focused: true });
    }).catch(() => { /* ignore */ });
  } catch { /* ignore */ }
  try { window.close(); } catch { /* ignore */ }
}

function Warning(): React.ReactElement {
  const [p, setP] = useState<Payload>(() => readPayload());

  // Re-read on hash change so the SW can update an existing popup with a new
  // verdict instead of opening a second window.
  useEffect(() => {
    const onHashChange = (): void => setP(readPayload());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const isDanger = p.verdict === 'danger';
  const accent = isDanger ? '#ff003c' : '#ffab00';
  const dim = '#707070';
  const fg = '#e8e8e8';
  const bg = '#0a0d0e';
  const accentSoft = isDanger ? 'rgba(255,0,60,0.2)' : 'rgba(255,171,0,0.2)';

  const wrap: CSSProperties = {
    background: bg,
    color: fg,
    fontFamily: "'JetBrains Mono', Menlo, Monaco, ui-monospace, monospace",
    fontSize: 14,
    padding: 18,
    minHeight: '100vh',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
  };
  const header: CSSProperties = {
    color: '#ffab00',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: '0.25em',
    textTransform: 'uppercase',
    marginBottom: 14,
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  };
  const sevStyle: CSSProperties = {
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: '0.08em',
    color: accent,
    marginBottom: 4,
  };
  const scoreStyle: CSSProperties = { color: dim, fontSize: 12, marginBottom: 14 };
  const summaryStyle: CSSProperties = { lineHeight: 1.45, marginBottom: 14 };
  const findingsBox: CSSProperties = {
    borderLeft: `2px solid ${accent}`,
    paddingLeft: 10,
    marginBottom: 18,
    flex: 1,
    overflowY: 'auto',
  };
  const findingItem: CSSProperties = { marginBottom: 8, fontSize: 13, lineHeight: 1.4 };
  const findingRule: CSSProperties = {
    color: dim,
    textTransform: 'uppercase',
    fontSize: 10,
    letterSpacing: '0.1em',
    marginBottom: 2,
  };
  const cta: CSSProperties = {
    background: 'rgba(0,255,65,0.15)',
    border: '1px solid #00ff41',
    color: '#00ff41',
    padding: 14,
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    width: '100%',
  };
  const footnote: CSSProperties = {
    color: dim,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 1.4,
  };
  const accentSpan: CSSProperties = { color: '#ffab00' };

  const findings = (p.findings ?? []).slice(0, 5);

  return (
    <div style={wrap}>
      <div style={header}>
        <span>+ SOLSHIELD WARNING</span>
        <span style={{ marginLeft: 'auto', color: dim }}>v{getVersion()}</span>
      </div>
      <div style={sevStyle}>{isDanger ? 'DANGER' : 'SUSPICIOUS'}</div>
      <div style={scoreStyle}>
        {typeof p.score === 'number' ? `${p.score}/100` : ''}
      </div>
      <div style={summaryStyle}>{p.summary || 'SolShield blocked a suspicious wallet signature request.'}</div>
      <div style={findingsBox}>
        {findings.length === 0 ? (
          <div style={{ color: dim, fontSize: 12, fontStyle: 'italic' }}>(no findings provided)</div>
        ) : (
          findings.map((f, i) => (
            <div key={i} style={findingItem}>
              <div style={findingRule}>
                [{(f.severity ?? 'unknown').toUpperCase()}] {f.ruleId ?? '?'}
              </div>
              <div>{f.message ?? ''}</div>
            </div>
          ))
        )}
      </div>
      <button
        type="button"
        style={cta}
        onClick={() => focusDappTab(p.tabId)}
        onMouseEnter={(e) => {
          (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(0,255,65,0.25)';
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(0,255,65,0.15)';
        }}
      >
        ✓ GO BACK TO DAPP TAB &amp; DECIDE
      </button>
      <p style={footnote}>
        The dapp at <span style={accentSpan}>{p.hostname || '(unknown site)'}</span> just asked your
        wallet to sign a non-safe payload.
        <br />
        Do NOT confirm in your wallet popup until you reviewed the in-page overlay.
      </p>
      <p style={{ ...footnote, color: accentSoft }}>by 0xnullpavel · solshield.dev</p>
    </div>
  );
}

export default Warning;
