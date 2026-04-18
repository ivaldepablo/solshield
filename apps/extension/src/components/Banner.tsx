/**
 * Persistent banner that lives at the top of the dapp page after the user has
 * proceeded through the SolShield overlay. Layer 2 of the focus-steal defense:
 *
 *   Layer 1: chrome.notifications system notification (visible even when
 *            Phantom's notification.html tab steals focus).
 *   Layer 2: this banner — when the user comes back to the dapp tab after
 *            interacting with Phantom, the verdict is still on screen.
 *
 * Mounted in a separate Shadow DOM host element from the Overlay so its
 * lifecycle is independent (overlay unmounts on decision, banner persists
 * until dismissed).
 */
import { CSSProperties, useState } from 'react';

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

interface BannerProps {
  verdict: VerdictView;
  onDismiss: () => void;
}

const colors = {
  panel: '#12121a',
  fg: '#e0e0e0',
  mute: '#8892b0',
  dim: '#4a5568',
  'neon-red': '#ff003c',
  'neon-amber': '#ffab00',
};

export function Banner({ verdict, onDismiss }: BannerProps) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const isDanger = verdict.verdict === 'danger';
  const accent = isDanger ? colors['neon-red'] : colors['neon-amber'];
  const icon = isDanger ? '☠' : '⚠';
  const label = isDanger ? 'DANGER' : 'SUSPICIOUS';
  const tail =
    verdict.kind === 'msg'
      ? 'verify message in your wallet popup'
      : verdict.kind === 'tx'
        ? 'verify transaction in your wallet popup'
        : 'verify in your wallet popup';

  const wrapperStyle: CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2147483647, // max int32 — sit above anything reasonable
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
  };

  const barStyle: CSSProperties = {
    pointerEvents: 'auto',
    margin: '8px 12px',
    maxWidth: 720,
    width: '100%',
    backgroundColor: colors.panel,
    border: `1.5px solid ${accent}`,
    boxShadow: `0 6px 24px -6px ${isDanger ? 'rgba(255,0,60,0.55)' : 'rgba(255,171,0,0.45)'}`,
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    color: colors.fg,
    fontSize: 13,
    lineHeight: 1.3,
  };

  const iconStyle: CSSProperties = {
    color: accent,
    fontSize: 18,
    flexShrink: 0,
  };

  const labelStyle: CSSProperties = {
    color: accent,
    fontWeight: 'bold',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontSize: 11,
    flexShrink: 0,
  };

  const brandStyle: CSSProperties = {
    color: colors['neon-amber'],
    fontWeight: 'bold',
    letterSpacing: '0.18em',
    fontSize: 10,
    textTransform: 'uppercase',
    flexShrink: 0,
  };

  const textStyle: CSSProperties = {
    color: colors.fg,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const dividerStyle: CSSProperties = {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.08)',
  };

  const dismissStyle: CSSProperties = {
    background: 'transparent',
    border: `1px solid ${colors.dim}`,
    color: colors.mute,
    cursor: 'pointer',
    fontSize: 14,
    width: 26,
    height: 26,
    lineHeight: 1,
    padding: 0,
    flexShrink: 0,
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
  };

  return (
    <div style={wrapperStyle} role="status" aria-label="SolShield warning banner">
      <div style={barStyle}>
        <span style={iconStyle}>{icon}</span>
        <span style={brandStyle}>SolShield</span>
        <span style={dividerStyle} />
        <span style={labelStyle}>{label}</span>
        <span style={textStyle}>{tail}</span>
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            onDismiss();
          }}
          style={dismissStyle}
          aria-label="dismiss SolShield banner"
          title="dismiss"
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = colors.fg;
            (e.currentTarget as HTMLButtonElement).style.borderColor = colors.fg;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = colors.mute;
            (e.currentTarget as HTMLButtonElement).style.borderColor = colors.dim;
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
