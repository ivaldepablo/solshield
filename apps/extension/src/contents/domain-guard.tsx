/**
 * Content script in ISOLATED world (runs at document_start).
 * Checks current page hostname against embedded scam-domains blocklist.
 * If match found: shows full-page warning with option to go back or continue.
 * Plain DOM, no React (keeps it ultra-fast at document_start).
 */

import type { PlasmoCSConfig } from 'plasmo';
import scamDomains from '~data/scam-domains.json';

export const config: PlasmoCSConfig = {
  matches: ['<all_urls>'],
  world: 'ISOLATED',
  run_at: 'document_start',
  all_frames: false,
};

/**
 * Normalize hostname for comparison (lowercase, strip www prefix).
 */
function normalizeHostname(hostname: string): string {
  let normalized = hostname.toLowerCase();
  if (normalized.startsWith('www.')) {
    normalized = normalized.slice(4);
  }
  return normalized;
}

/**
 * Create and show a full-page warning overlay.
 */
function showBlockedWarning(): void {
  const overlay = document.createElement('div');
  overlay.id = 'solshield-domain-warning';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    z-index: 999999;
    background-color: rgba(0, 0, 0, 0.95);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, -apple-system, sans-serif;
    color: #fff;
  `;

  const container = document.createElement('div');
  container.style.cssText = `
    background-color: #8B0000;
    border: 3px solid #ff0000;
    border-radius: 12px;
    padding: 32px;
    max-width: 500px;
    text-align: center;
  `;

  const title = document.createElement('h1');
  title.textContent = '🚨 SolShield Blocked This Site';
  title.style.cssText = `
    margin: 0 0 16px 0;
    font-size: 28px;
    font-weight: bold;
    color: #ff4444;
  `;

  const message = document.createElement('p');
  message.textContent =
    'This domain is on our scam blocklist. It may attempt to drain your wallet or steal your funds.';
  message.style.cssText = `
    margin: 0 0 24px 0;
    font-size: 16px;
    line-height: 1.6;
    color: #fff;
  `;

  const hostname = document.createElement('div');
  hostname.textContent = `Domain: ${window.location.hostname}`;
  hostname.style.cssText = `
    margin: 0 0 24px 0;
    font-size: 13px;
    color: #bbb;
    font-family: monospace;
  `;

  const buttons = document.createElement('div');
  buttons.style.cssText = `
    display: flex;
    gap: 12px;
    justify-content: center;
  `;

  const backBtn = document.createElement('button');
  backBtn.textContent = 'Go Back';
  backBtn.style.cssText = `
    padding: 12px 24px;
    background-color: #4CAF50;
    color: white;
    border: 1px solid #45a049;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    transition: background-color 0.2s;
  `;
  backBtn.onmouseover = (): void => {
    backBtn.style.backgroundColor = '#45a049';
  };
  backBtn.onmouseout = (): void => {
    backBtn.style.backgroundColor = '#4CAF50';
  };
  backBtn.onclick = (): void => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.close();
    }
  };

  const continueBtn = document.createElement('button');
  continueBtn.textContent = 'Continue Anyway';
  continueBtn.style.cssText = `
    padding: 12px 24px;
    background-color: #444;
    color: #fff;
    border: 1px solid #666;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    transition: background-color 0.2s;
  `;
  continueBtn.onmouseover = (): void => {
    continueBtn.style.backgroundColor = '#555';
  };
  continueBtn.onmouseout = (): void => {
    continueBtn.style.backgroundColor = '#444';
  };
  continueBtn.onclick = (): void => {
    overlay.remove();
  };

  buttons.appendChild(backBtn);
  buttons.appendChild(continueBtn);

  container.appendChild(title);
  container.appendChild(message);
  container.appendChild(hostname);
  container.appendChild(buttons);

  overlay.appendChild(container);
  document.body.appendChild(overlay);
}

/**
 * Check if current hostname is on the scam blocklist.
 */
function checkAndBlock(): void {
  const currentHostname = normalizeHostname(window.location.hostname);
  const scamSet = new Set(scamDomains.map((d) => d.toLowerCase()));

  if (scamSet.has(currentHostname)) {
    showBlockedWarning();
  }
}

// Run check immediately when document starts loading
// Use a small delay to ensure document.body exists
if (document.body) {
  checkAndBlock();
} else {
  document.addEventListener('DOMContentLoaded', checkAndBlock, { once: true });
}

export {};
