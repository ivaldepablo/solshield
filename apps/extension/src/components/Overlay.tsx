import { CSSProperties } from 'react';

interface VerdictView {
  kind: 'tx' | 'msg' | 'domain';
  verdict: 'safe' | 'suspicious' | 'danger';
  score: number;
  summary: string;
  findings: Array<{ severity: 'low' | 'medium' | 'high' | 'critical'; ruleId: string; message: string }>;
  elapsedMs?: number;
  models: string[];
  startedAt: number;
}

interface OverlayProps {
  verdict: VerdictView;
  onReject: () => void;
  onProceed: () => void;
}

const PLAIN_LANGUAGE: Record<string, string> = {
  'unlimited-spl-approval': "they want permission to take ALL your tokens — not just one transfer.",
  'mint-authority-transfer': "they're taking control of who can create new tokens.",
  'mass-token-drain': "multiple transfers funneling into one wallet — looks like a drain.",
  'upgrade-authority-set': "they're taking control of the program — they could replace it later.",
  'hidden-sol-transfer': "moving SOL to someone else's wallet — not shown clearly in the UI.",
  'spl-account-owner-change': "rewriting who owns your token account — they become the owner.",
  'close-token-account-to-attacker': "closing your account and sending the rent SOL to them.",
  'token-freeze-abuse': "freezing your tokens so you can't move them.",
  'stake-authority-hijack': "stealing control of your staked SOL.",
  'memo-exfiltration': "memo contains data matching known scam signatures.",
  'compute-budget-anomaly': "compute config looks unusual — could mean hidden activity.",
  'multisig-cosigner-manipulation': "changing your multisig setup — full takeover possible.",
  'simulated-signer-drain': "simulation shows YOUR balance dropping over 90%.",
  'simulated-token-wipe': "simulation shows multiple tokens going to zero.",
  'simulation-failure': "tx fails simulation — could be anti-detection.",
  'empty-message-sign': "blank message — your signature could be replayed elsewhere.",
  'opaque-binary-sign': "signing binary data with no explanation — risky.",
  'url-in-message': "message contains a link — verify before clicking.",
  'rtl-override-attack': "message hides text using unicode tricks.",
  'spoofed-siws-domain': "message claims a different site than the one asking.",
  'permit-style-approval': "message looks like an off-chain token approval.",
  blocklisted: "this domain is on our scam blocklist.",
  typosquat: "name looks like a 1–2 letter typo of a real dapp.",
  'suspicious-tld': "uses a free TLD popular with scammers.",
  'punycode-idn': "punycode hostname — could impersonate a real brand.",
  'phishing-keyword': "name combines a real brand with a scam keyword.",
  'suspicious-structure': "hostname shape is unusual for legit dapps.",
  'invalid-url': "couldn't parse this as a valid URL.",
};

const colors = {
  bg: '#0a0a0f',
  panel: '#12121a',
  fg: '#e0e0e0',
  mute: '#8892b0',
  dim: '#4a5568',
  'neon-green': '#00ff41',
  'neon-cyan': '#00e5ff',
  'neon-red': '#ff003c',
  'neon-amber': '#ffab00',
};

export function Overlay({ verdict, onReject, onProceed }: OverlayProps) {
  const isDanger = verdict.verdict === 'danger';
  const isWarning = verdict.verdict === 'suspicious';

  const borderColor = isDanger ? colors['neon-red'] : colors['neon-amber'];
  const accentColor = isDanger ? colors['neon-red'] : colors['neon-amber'];
  const icon = isDanger ? '☠' : '⚠';
  const headline = isDanger
    ? "this tx will drain your wallet. don't sign it."
    : "something's off. verify before signing.";

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 999999,
  };

  const boxStyle: CSSProperties = {
    maxWidth: 420,
    width: '100%',
    border: `2px solid ${borderColor}`,
    backgroundColor: colors.panel,
    padding: 20,
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
    boxShadow: `0 0 40px -5px ${isDanger ? 'rgba(255,0,60,0.6)' : 'rgba(255,171,0,0.5)'}`,
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  };

  const headerBrand: CSSProperties = {
    color: colors['neon-amber'],
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: '0.25em',
    textTransform: 'uppercase',
  };

  const timeStyle: CSSProperties = {
    color: colors.dim,
    fontSize: 10,
    marginLeft: 'auto',
  };

  const headlineBoxStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
    color: accentColor,
    marginBottom: 16,
  };

  const iconStyle: CSSProperties = {
    fontSize: 48,
    lineHeight: 1,
  };

  const labelStyle: CSSProperties = {
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    marginBottom: 4,
  };

  const scoreStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: '0.05em',
  };

  const headlineTextStyle: CSSProperties = {
    color: colors.fg,
    fontSize: 14,
    fontWeight: 600,
    marginTop: 12,
    marginBottom: 0,
  };

  const findingsStyle: CSSProperties = {
    marginTop: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  };

  const findingItemStyle: CSSProperties = {
    display: 'flex',
    gap: 8,
    fontSize: 13,
    lineHeight: 1.4,
  };

  const arrowStyle: CSSProperties = {
    color: accentColor,
    flexShrink: 0,
  };

  const findingTextStyle: CSSProperties = {
    color: colors.fg,
  };

  const estimatedLossStyle: CSSProperties = {
    marginTop: 12,
    paddingTop: 12,
    borderTop: `1px solid ${isDanger ? 'rgba(255,0,60,0.2)' : 'rgba(255,171,0,0.2)'}`,
    fontSize: 12,
  };

  const lossLabelStyle: CSSProperties = {
    color: colors.dim,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  const lossValueStyle: CSSProperties = {
    color: colors['neon-red'],
    fontWeight: 'bold',
    marginLeft: 4,
  };

  const buttonsStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginTop: 20,
  };

  const rejectButtonStyle: CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    backgroundColor: `rgba(0, 255, 65, 0.15)`,
    border: `1px solid ${colors['neon-green']}`,
    color: colors['neon-green'],
    fontWeight: 'bold',
    fontSize: 13,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  };

  const proceedButtonStyle: CSSProperties = {
    width: '100%',
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: `1px solid ${accentColor}33`,
    color: accentColor,
    fontSize: 11,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  };

  const footerStyle: CSSProperties = {
    marginTop: 16,
    paddingTop: 12,
    borderTop: `1px solid rgba(255,171,0,0.2)`,
    textAlign: 'center',
    color: colors.dim,
    fontSize: 10,
  };

  return (
    <div style={overlayStyle} role="alertdialog" aria-label="SolShield warning">
      <div style={boxStyle}>
        {/* header */}
        <div style={headerStyle}>
          <span style={{ color: colors['neon-amber'], fontSize: 12 }}>✦</span>
          <span style={headerBrand}>SolShield</span>
          <span style={timeStyle}>{verdict.elapsedMs ?? 200}ms analysis</span>
        </div>

        {/* headline */}
        <div style={headlineBoxStyle}>
          <span style={iconStyle}>{icon}</span>
          <div>
            <div style={labelStyle}>{isDanger ? 'DRAINER DETECTED' : 'SUSPICIOUS'}</div>
            <div style={scoreStyle}>{verdict.score}/100</div>
          </div>
        </div>
        <p style={headlineTextStyle}>{headline}</p>

        {/* findings */}
        <div style={findingsStyle}>
          {verdict.findings.map((f, i) => {
            const plainText = PLAIN_LANGUAGE[f.ruleId] || f.message;
            return (
              <div key={i} style={findingItemStyle}>
                <span style={arrowStyle}>→</span>
                <span style={findingTextStyle}>{plainText}</span>
              </div>
            );
          })}
        </div>

        {/* estimated loss (only for tx kind) */}
        {verdict.kind === 'tx' && verdict.findings.some((f) => f.severity === 'critical') && (
          <div style={estimatedLossStyle}>
            <span style={lossLabelStyle}>estimated loss:</span>
            <span style={lossValueStyle}>
              {verdict.findings.find((f) => f.severity === 'critical')?.message || 'unknown'}
            </span>
          </div>
        )}

        {/* buttons */}
        <div style={buttonsStyle}>
          <button
            type="button"
            onClick={onReject}
            style={rejectButtonStyle}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(0, 255, 65, 0.25)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(0, 255, 65, 0.15)';
            }}
          >
            ✓ REJECT &amp; CLOSE
          </button>
          <button
            type="button"
            onClick={onProceed}
            style={proceedButtonStyle}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(255,171,0,0.1)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
            }}
          >
            i understand · proceed anyway
          </button>
        </div>

        {/* wallet hint — after proceed the wallet's own popup opens */}
        <p
          style={{
            color: colors.dim,
            fontSize: 11,
            marginTop: 12,
            marginBottom: 0,
            textAlign: 'center',
            letterSpacing: '0.04em',
          }}
        >
          → after proceed your wallet popup will open · confirm there to sign
        </p>

        {/* footer */}
        <p style={footerStyle}>analyzed by claude haiku 4.5 → opus 4.7 · by 0xnullpavel</p>
      </div>
    </div>
  );
}
