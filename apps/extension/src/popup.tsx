'use client';

import { useState, useEffect } from 'react';
import { CSSProperties } from 'react';

const colors = {
  bg: '#0a0a0f',
  panel: '#12121a',
  fg: '#e0e0e0',
  mute: '#8892b0',
  dim: '#4a5568',
  'neon-green': '#00ff41',
  'neon-cyan': '#00e5ff',
  'neon-amber': '#ffab00',
  'neon-red': '#ff003c',
};

interface RecentActivity {
  time: number;
  kind: 'tx' | 'msg' | 'domain';
  verdict: 'safe' | 'suspicious' | 'danger';
  url?: string;
  summary?: string;
}

export default function Popup() {
  const [isEnabled, setIsEnabled] = useState(true);
  const [totalScans, setTotalScans] = useState(0);
  const [threatsBlocked, setThreatsBlocked] = useState(0);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  // Read live from manifest so the popup can never lie about which build is loaded.
  const [version, setVersion] = useState('?');
  useEffect(() => {
    try {
      setVersion(chrome.runtime.getManifest().version);
    } catch {
      setVersion('unknown');
    }
  }, []);

  useEffect(() => {
    // Load from chrome.storage.local
    chrome.storage.local.get(['solshield-enabled', 'totalScans', 'threatsBlocked', 'recentActivity'], (data) => {
      if (data['solshield-enabled'] !== undefined) {
        setIsEnabled(data['solshield-enabled']);
      }
      if (data.totalScans !== undefined) {
        setTotalScans(data.totalScans);
      }
      if (data.threatsBlocked !== undefined) {
        setThreatsBlocked(data.threatsBlocked);
      }
      if (data.recentActivity !== undefined) {
        setRecentActivity(data.recentActivity);
      }
    });
  }, []);

  const handleToggle = (newState: boolean) => {
    setIsEnabled(newState);
    chrome.storage.local.set({ 'solshield-enabled': newState });
  };

  const openLink = (url: string) => {
    chrome.tabs.create({ url, active: true });
  };

  const containerStyle: CSSProperties = {
    width: 320,
    minHeight: 200,
    backgroundColor: colors.bg,
    color: colors.fg,
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
    padding: 0,
    margin: 0,
    fontSize: 13,
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 16px',
    borderBottom: `1px solid ${colors.dim}`,
    marginBottom: 12,
  };

  const logoStyle: CSSProperties = {
    width: 20,
    height: 20,
    border: `1px solid ${colors['neon-green']}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 'bold',
    color: colors['neon-green'],
  };

  const titleStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: colors['neon-green'],
  };

  const versionStyle: CSSProperties = {
    fontSize: 10,
    color: colors.dim,
    marginLeft: 'auto',
  };

  const sectionPaddingStyle: CSSProperties = {
    padding: '0 16px 12px 16px',
  };

  const labelStyle: CSSProperties = {
    fontSize: 10,
    color: colors.dim,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 6,
    display: 'block',
  };

  const toggleContainerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  };

  const toggleStyle: CSSProperties = {
    width: 40,
    height: 20,
    backgroundColor: isEnabled ? colors['neon-green'] : colors.dim,
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    position: 'relative',
    transition: 'background-color 0.2s',
  };

  const toggleKnobStyle: CSSProperties = {
    position: 'absolute',
    top: 2,
    left: isEnabled ? 22 : 2,
    width: 16,
    height: 16,
    backgroundColor: colors.bg,
    borderRadius: 8,
    transition: 'left 0.2s',
  };

  const toggleLabelStyle: CSSProperties = {
    fontSize: 11,
    color: colors.fg,
  };

  const statsStyle: CSSProperties = {
    fontSize: 11,
    color: colors.fg,
    marginBottom: 6,
  };

  const recentHeaderStyle: CSSProperties = {
    fontSize: 10,
    color: colors['neon-cyan'],
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 6,
  };

  const activityListStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 12,
  };

  const activityItemStyle: CSSProperties = {
    fontSize: 10,
    color: colors.mute,
    padding: '4px 8px',
    backgroundColor: colors.panel,
    borderRadius: 2,
  };

  const footerStyle: CSSProperties = {
    display: 'flex',
    gap: 8,
    justifyContent: 'center',
    padding: '12px 16px',
    borderTop: `1px solid ${colors.dim}`,
  };

  const linkButtonStyle: CSSProperties = {
    fontSize: 10,
    color: colors['neon-green'],
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 8px',
    textTransform: 'uppercase',
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
    transition: 'color 0.2s',
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const getVerdictColor = (verdict: string) => {
    if (verdict === 'danger') return colors['neon-red'];
    if (verdict === 'suspicious') return colors['neon-amber'];
    return colors['neon-green'];
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={logoStyle}>∆</div>
        <span style={titleStyle}>SolShield</span>
        <span style={versionStyle}>v{version}</span>
      </div>

      {/* Toggle */}
      <div style={sectionPaddingStyle}>
        <label style={labelStyle} htmlFor="toggle">
          Status
        </label>
        <div style={toggleContainerStyle}>
          <button
            id="toggle"
            style={toggleStyle}
            onClick={() => handleToggle(!isEnabled)}
            aria-pressed={isEnabled}
          >
            <div style={toggleKnobStyle} />
          </button>
          <span style={toggleLabelStyle}>{isEnabled ? 'Enabled' : 'Disabled'}</span>
        </div>
      </div>

      {/* Stats */}
      <div style={sectionPaddingStyle}>
        <label style={labelStyle}>Today</label>
        <div style={statsStyle}>{totalScans} scans · {threatsBlocked} threats blocked</div>
      </div>

      {/* Recent Activity */}
      <div style={sectionPaddingStyle}>
        <div style={recentHeaderStyle}>Recent Activity</div>
        {recentActivity.length === 0 ? (
          <div style={{ ...activityItemStyle, color: colors.dim }}>no activity yet</div>
        ) : (
          <div style={activityListStyle}>
            {recentActivity.slice(0, 5).map((item, i) => (
              <div key={i} style={activityItemStyle}>
                <span style={{ color: getVerdictColor(item.verdict) }}>
                  {item.verdict === 'danger' ? '✗' : item.verdict === 'suspicious' ? '⚠' : '✓'}
                </span>
                {' '}{item.kind} · {formatTime(item.time)} · {item.summary || item.url || 'unknown'}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Links */}
      <div style={footerStyle}>
        <button
          style={linkButtonStyle}
          onClick={() => openLink('https://solshield.dev/lab')}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.color = colors['neon-cyan'];
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.color = colors['neon-green'];
          }}
        >
          [ /lab ]
        </button>
        <button
          style={linkButtonStyle}
          onClick={() => openLink('https://github.com/0xnullpavel/solshield')}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.color = colors['neon-cyan'];
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.color = colors['neon-green'];
          }}
        >
          [ github ]
        </button>
        <button
          style={linkButtonStyle}
          onClick={() => openLink('https://solshield.dev/privacy')}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.color = colors['neon-cyan'];
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.color = colors['neon-green'];
          }}
        >
          [ privacy ]
        </button>
      </div>
    </div>
  );
}
