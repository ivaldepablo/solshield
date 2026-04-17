/**
 * Content script in ISOLATED world (runs at document_idle).
 * Listens for tx/message analysis requests from provider-hook (via window.postMessage),
 * relays to background service worker, and mounts React overlay for dangerous verdicts.
 */

import type { PlasmoCSConfig } from 'plasmo';
import React, { useEffect, useState } from 'react';
import { mountInShadow } from '~lib/shadow-dom';
import type { InpageRequest, ContentResponse, VerdictView } from '~lib/messaging';

export const config: PlasmoCSConfig = {
  matches: ['<all_urls>'],
  world: 'ISOLATED',
  run_at: 'document_idle',
};

/**
 * Simple overlay component for displaying verdicts.
 * Shows summary, findings, and buttons to accept or reject.
 */
function OverlayComponent({
  verdict,
  onProceed,
  onReject,
}: {
  verdict: VerdictView;
  onProceed: () => void;
  onReject: () => void;
}): React.ReactElement {
  const isSafe = verdict.verdict === 'safe';
  const isDanger = verdict.verdict === 'danger';

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999999,
        backgroundColor: isDanger ? 'rgba(139, 0, 0, 0.95)' : 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#fff',
      }}
    >
      <div
        style={{
          backgroundColor: isDanger ? '#8B0000' : '#1a1a1a',
          border: isDanger ? '2px solid #ff0000' : '1px solid #333',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '500px',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
      >
        <h2
          style={{
            margin: '0 0 12px 0',
            fontSize: '18px',
            fontWeight: 'bold',
            color: isDanger ? '#ff4444' : '#fff',
          }}
        >
          {isDanger
            ? '🚨 Dangerous Transaction'
            : isSafe
              ? '✓ Safe Transaction'
              : '⚠️ Suspicious Transaction'}
        </h2>

        <p style={{ margin: '0 0 16px 0', fontSize: '14px', lineHeight: '1.5' }}>
          {verdict.summary}
        </p>

        {verdict.findings.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 'bold' }}>
              Findings:
            </h3>
            <ul style={{ margin: '0', paddingLeft: '16px', fontSize: '12px' }}>
              {verdict.findings.map((f, i) => (
                <li
                  key={i}
                  style={{
                    marginBottom: '4px',
                    color: f.severity === 'critical' ? '#ff4444' : '#aaa',
                  }}
                >
                  <strong>[{f.severity.toUpperCase()}]</strong> {f.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div
          style={{
            fontSize: '11px',
            color: '#888',
            marginBottom: '16px',
          }}
        >
          Score: {verdict.score.toFixed(2)} | Elapsed: {verdict.elapsedMs}ms
        </div>

        <div
          style={{
            display: 'flex',
            gap: '8px',
            justifyContent: isSafe ? 'center' : 'space-between',
          }}
        >
          {!isSafe && (
            <button
              onClick={onReject}
              style={{
                flex: 1,
                padding: '10px 16px',
                backgroundColor: '#8B0000',
                color: '#fff',
                border: '1px solid #ff4444',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
              }}
            >
              Reject
            </button>
          )}
          <button
            onClick={onProceed}
            style={{
              flex: 1,
              padding: '10px 16px',
              backgroundColor: isDanger ? '#444' : '#4CAF50',
              color: '#fff',
              border: isDanger ? '1px solid #666' : '1px solid #45a049',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            {isSafe ? 'Close' : 'Proceed'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Main content script logic
 */
function initOverlayListener(): void {
  let unmountFn: (() => void) | null = null;

  window.addEventListener(
    'message',
    async (event) => {
      // Only accept from same window
      if (event.source !== window) return;

      const req = event.data as InpageRequest | undefined;
      if (
        !req ||
        typeof req !== 'object' ||
        !('type' in req) ||
        !['analyze-tx', 'analyze-message'].includes(req.type as string)
      ) {
        return;
      }

      // Unmount any existing overlay
      if (unmountFn) {
        unmountFn();
        unmountFn = null;
      }

      try {
        // Relay to background service worker
        const response = await chrome.runtime.sendMessage({
          type:
            req.type === 'analyze-tx'
              ? 'inspect-tx'
              : req.type === 'analyze-message'
                ? 'inspect-message'
                : 'check-domain',
          data: req.data,
        });

        if (!response || (!response.verdict && response.failOpen !== false)) {
          // API error but failOpen — send OK verdict to let tx proceed
          const contentResponse: ContentResponse = {
            id: req.id,
            verdict: {
              kind: req.type === 'analyze-tx' ? 'tx' : 'msg',
              verdict: 'safe',
              score: 0,
              summary: '[SolShield offline] Transaction allowed (fail-open)',
              findings: [],
              models: [],
              startedAt: Date.now(),
            },
            failOpen: true,
          };
          window.postMessage(contentResponse, '*');
          return;
        }

        const verdict = response.verdict as VerdictView;

        // If safe, immediately respond and optionally show brief badge
        if (verdict.verdict === 'safe') {
          const contentResponse: ContentResponse = {
            id: req.id,
            verdict,
          };
          window.postMessage(contentResponse, '*');
          return;
        }

        // Not safe: mount full-page overlay and wait for user decision
        const host = document.createElement('div');
        host.id = 'solshield-overlay-host';
        document.body.appendChild(host);

        let userDecision: 'proceed' | 'reject' | null = null;

        const onProceed = (): void => {
          userDecision = 'proceed';
        };

        const onReject = (): void => {
          userDecision = 'reject';
        };

        // Mount overlay
        unmountFn = mountInShadow(
          host,
          <OverlayComponent
            verdict={verdict}
            onProceed={onProceed}
            onReject={onReject}
          />
        );

        // Poll for user decision
        let waitTime = 0;
        const maxWaitTime = 60000; // 60 seconds

        const pollDecision = (): void => {
          if (userDecision === 'proceed') {
            // User approved
            const contentResponse: ContentResponse = {
              id: req.id,
              verdict,
            };
            window.postMessage(contentResponse, '*');
            if (unmountFn) unmountFn();
            unmountFn = null;
            host.remove();
            return;
          }

          if (userDecision === 'reject') {
            // User rejected
            const contentResponse: ContentResponse = {
              id: req.id,
              error: 'User rejected the transaction',
            };
            window.postMessage(contentResponse, '*');
            if (unmountFn) unmountFn();
            unmountFn = null;
            host.remove();
            return;
          }

          waitTime += 100;
          if (waitTime < maxWaitTime) {
            setTimeout(pollDecision, 100);
          } else {
            // Timeout: reject
            const contentResponse: ContentResponse = {
              id: req.id,
              error: 'Verdict decision timeout',
            };
            window.postMessage(contentResponse, '*');
            if (unmountFn) unmountFn();
            unmountFn = null;
            host.remove();
          }
        };

        pollDecision();
      } catch (err) {
        // Error relaying to background
        const contentResponse: ContentResponse = {
          id: req.id,
          error: err instanceof Error ? err.message : 'Background error',
          failOpen: true,
        };
        window.postMessage(contentResponse, '*');
      }
    },
    false
  );
}

// Start listening when script loads
initOverlayListener();

export {};
