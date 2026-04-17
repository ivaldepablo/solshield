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

type ThresholdValue = 'danger-only' | 'suspicious+' | 'all';

export default function Options() {
  const [isEnabled, setIsEnabled] = useState(true);
  const [threshold, setThreshold] = useState<ThresholdValue>('danger-only');
  const [allowlist, setAllowlist] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['solshield-enabled', 'threshold', 'allowlist'], (data) => {
      if (data['solshield-enabled'] !== undefined) {
        setIsEnabled(data['solshield-enabled']);
      }
      if (data.threshold !== undefined) {
        setThreshold(data.threshold);
      }
      if (data.allowlist !== undefined) {
        setAllowlist(Array.isArray(data.allowlist) ? data.allowlist.join('\n') : '');
      }
    });
  }, []);

  const handleSave = () => {
    const allowlistArray = allowlist
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    chrome.storage.local.set({
      'solshield-enabled': isEnabled,
      threshold,
      allowlist: allowlistArray,
    });

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    if (confirm('Reset all settings to defaults?')) {
      chrome.storage.local.set({
        'solshield-enabled': true,
        threshold: 'danger-only',
        allowlist: [],
      });
      setIsEnabled(true);
      setThreshold('danger-only');
      setAllowlist('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const containerStyle: CSSProperties = {
    minHeight: '100vh',
    backgroundColor: colors.bg,
    color: colors.fg,
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
    padding: '32px',
  };

  const contentStyle: CSSProperties = {
    maxWidth: 640,
    margin: '0 auto',
  };

  const titleStyle: CSSProperties = {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 24,
    letterSpacing: '0.05em',
  };

  const sectionStyle: CSSProperties = {
    marginBottom: 32,
    paddingBottom: 24,
    borderBottom: `1px solid ${colors.dim}`,
  };

  const sectionTitleStyle: CSSProperties = {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors['neon-cyan'],
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 12,
  };

  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: colors.fg,
    marginBottom: 8,
  };

  const toggleContainerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  };

  const toggleStyle: CSSProperties = {
    width: 44,
    height: 24,
    backgroundColor: isEnabled ? colors['neon-green'] : colors.dim,
    border: 'none',
    borderRadius: 12,
    cursor: 'pointer',
    position: 'relative',
    transition: 'background-color 0.2s',
  };

  const toggleKnobStyle: CSSProperties = {
    position: 'absolute',
    top: 2,
    left: isEnabled ? 24 : 2,
    width: 20,
    height: 20,
    backgroundColor: colors.bg,
    borderRadius: 10,
    transition: 'left 0.2s',
  };

  const toggleLabelStyle: CSSProperties = {
    fontSize: 12,
    color: colors.fg,
  };

  const radioGroupStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginTop: 8,
  };

  const radioItemStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  };

  const radioInputStyle: CSSProperties = {
    width: 16,
    height: 16,
    cursor: 'pointer',
    accentColor: colors['neon-green'],
  };

  const radioLabelStyle: CSSProperties = {
    fontSize: 12,
    color: colors.fg,
    cursor: 'pointer',
  };

  const radioDescStyle: CSSProperties = {
    fontSize: 11,
    color: colors.mute,
    marginLeft: 26,
    marginTop: -8,
  };

  const textareaStyle: CSSProperties = {
    width: '100%',
    minHeight: 120,
    padding: 12,
    backgroundColor: colors.panel,
    color: colors.fg,
    border: `1px solid ${colors.dim}`,
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
    fontSize: 12,
    borderRadius: 4,
    marginTop: 8,
    boxSizing: 'border-box',
  };

  const buttonsStyle: CSSProperties = {
    display: 'flex',
    gap: 12,
    marginTop: 16,
  };

  const saveButtonStyle: CSSProperties = {
    flex: 1,
    padding: '12px 16px',
    backgroundColor: colors['neon-green'],
    color: colors.bg,
    border: 'none',
    fontWeight: 'bold',
    fontSize: 12,
    cursor: 'pointer',
    borderRadius: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
    transition: 'opacity 0.2s',
  };

  const resetButtonStyle: CSSProperties = {
    flex: 1,
    padding: '12px 16px',
    backgroundColor: colors['neon-red'],
    color: '#fff',
    border: 'none',
    fontWeight: 'bold',
    fontSize: 12,
    cursor: 'pointer',
    borderRadius: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
    transition: 'opacity 0.2s',
  };

  const savedMessageStyle: CSSProperties = {
    marginTop: 8,
    fontSize: 11,
    color: colors['neon-green'],
    display: saved ? 'block' : 'none',
  };

  const footerLinksStyle: CSSProperties = {
    display: 'flex',
    gap: 16,
    marginTop: 32,
    paddingTop: 24,
    borderTop: `1px solid ${colors.dim}`,
    justifyContent: 'center',
  };

  const linkStyle: CSSProperties = {
    fontSize: 11,
    color: colors['neon-cyan'],
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'color 0.2s',
  };

  const openLink = (url: string) => {
    chrome.tabs.create({ url, active: true });
  };

  return (
    <div style={containerStyle}>
      <div style={contentStyle}>
        <h1 style={titleStyle}>SolShield · settings</h1>

        {/* Master toggle */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>// Protection Status</h2>
          <label style={labelStyle} htmlFor="master-toggle">
            Enable SolShield
          </label>
          <div style={toggleContainerStyle}>
            <button
              id="master-toggle"
              style={toggleStyle}
              onClick={() => setIsEnabled(!isEnabled)}
              aria-pressed={isEnabled}
            >
              <div style={toggleKnobStyle} />
            </button>
            <span style={toggleLabelStyle}>{isEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        </div>

        {/* Threshold selection */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>// Severity Threshold</h2>
          <p style={{ fontSize: 11, color: colors.mute, marginBottom: 12 }}>
            When to show the warning overlay:
          </p>
          <div style={radioGroupStyle}>
            <div style={radioItemStyle}>
              <input
                type="radio"
                id="danger-only"
                name="threshold"
                value="danger-only"
                checked={threshold === 'danger-only'}
                onChange={(e) => setThreshold(e.target.value as ThresholdValue)}
                style={radioInputStyle}
              />
              <label htmlFor="danger-only" style={radioLabelStyle}>
                Danger Only (default)
              </label>
            </div>
            <p style={radioDescStyle}>Only show overlay for very dangerous transactions</p>

            <div style={radioItemStyle}>
              <input
                type="radio"
                id="suspicious+"
                name="threshold"
                value="suspicious+"
                checked={threshold === 'suspicious+'}
                onChange={(e) => setThreshold(e.target.value as ThresholdValue)}
                style={radioInputStyle}
              />
              <label htmlFor="suspicious+" style={radioLabelStyle}>
                Suspicious + (danger + warnings)
              </label>
            </div>
            <p style={radioDescStyle}>Show overlay for dangerous and suspicious activity</p>

            <div style={radioItemStyle}>
              <input
                type="radio"
                id="all"
                name="threshold"
                value="all"
                checked={threshold === 'all'}
                onChange={(e) => setThreshold(e.target.value as ThresholdValue)}
                style={radioInputStyle}
              />
              <label htmlFor="all" style={radioLabelStyle}>
                All (always show feedback)
              </label>
            </div>
            <p style={radioDescStyle}>Show badge/message for every transaction analyzed</p>
          </div>
        </div>

        {/* Allowlist */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>// Allowlist</h2>
          <label style={labelStyle} htmlFor="allowlist-textarea">
            Domains to skip all scans (one per line):
          </label>
          <textarea
            id="allowlist-textarea"
            style={textareaStyle}
            value={allowlist}
            onChange={(e) => setAllowlist(e.target.value)}
            placeholder="example.com&#10;trusted-dapp.io"
          />
          <p style={{ fontSize: 10, color: colors.mute, marginTop: 8 }}>
            Exact hostname match only. Subdomains must be listed separately.
          </p>
        </div>

        {/* Save / Reset */}
        <div style={sectionStyle}>
          <div style={buttonsStyle}>
            <button
              style={saveButtonStyle}
              onClick={handleSave}
              onMouseEnter={(e) => {
                (e.target as HTMLButtonElement).style.opacity = '0.8';
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLButtonElement).style.opacity = '1';
              }}
            >
              Save Settings
            </button>
            <button
              style={resetButtonStyle}
              onClick={handleReset}
              onMouseEnter={(e) => {
                (e.target as HTMLButtonElement).style.opacity = '0.8';
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLButtonElement).style.opacity = '1';
              }}
            >
              Reset to Defaults
            </button>
          </div>
          <p style={savedMessageStyle}>✓ Settings saved</p>
        </div>

        {/* Footer links */}
        <div style={footerLinksStyle}>
          <button
            style={linkStyle}
            onClick={() => openLink('https://solshield.dev/privacy')}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.color = colors['neon-green'];
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.color = colors['neon-cyan'];
            }}
          >
            Privacy Policy
          </button>
          <button
            style={linkStyle}
            onClick={() => openLink('https://github.com/0xnullpavel/solshield')}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.color = colors['neon-green'];
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.color = colors['neon-cyan'];
            }}
          >
            GitHub
          </button>
        </div>
      </div>
    </div>
  );
}
