import { useEffect } from 'react';
import { CSSProperties } from 'react';

interface SafeBadgeProps {
  onDismiss?: () => void;
}

const colors = {
  bg: '#0a0a0f',
  fg: '#e0e0e0',
  'neon-green': '#00ff41',
  'neon-cyan': '#00e5ff',
};

export function SafeBadge({ onDismiss }: SafeBadgeProps) {
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (onDismiss) {
        onDismiss();
      }
    }, 2000);

    return () => clearTimeout(timeout);
  }, [onDismiss]);

  const containerStyle: CSSProperties = {
    position: 'fixed',
    top: 20,
    right: 20,
    zIndex: 999999,
  };

  const badgeStyle: CSSProperties = {
    padding: '8px 12px',
    backgroundColor: colors.bg,
    border: `1px solid ${colors['neon-green']}`,
    color: colors['neon-green'],
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
    borderRadius: 4,
    boxShadow: `0 0 20px -8px ${colors['neon-green']}`,
    letterSpacing: '0.05em',
  };

  return (
    <div style={containerStyle}>
      <div style={badgeStyle}>✦ SolShield: safe · checked by claude</div>
    </div>
  );
}
