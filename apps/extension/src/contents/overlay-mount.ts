/**
 * ISOLATED-world content script (document_start, post-v0.4.3).
 *
 * Bridges the page's MAIN-world provider hook with the extension's background
 * service worker, and mounts the React Overlay into a Shadow DOM when a
 * verdict is dangerous or suspicious.
 *
 * Filename is `.ts` (NOT `.tsx`) on purpose: Plasmo wraps any `.tsx`
 * content script in a content-script-ui-mount template that imports the
 * file's default export and renders it as React. We don't have a default
 * React component here — we mount on-demand — so we use `.ts` and call
 * `React.createElement` explicitly when needed.
 */

import type { PlasmoCSConfig } from 'plasmo';
import { createElement } from 'react';
import { Overlay } from '../components/Overlay';
import { mountInShadow } from '../lib/shadow-dom';
import { inspectTx, inspectMessage } from '../lib/api-client';
import type { ContentResponse, InpageRequest, VerdictView } from '../lib/messaging';

// document_start so our capture-phase 'solshield-show' listener is registered
// BEFORE any dapp <script> runs. Otherwise the dapp could register its own
// listener first and either spoof decisions or observe verdict payloads.
export const config: PlasmoCSConfig = {
  matches: ['<all_urls>'],
  world: 'ISOLATED',
  run_at: 'document_start',
};

// Stash native APIs at module load. If the dapp later replaces
// `document.addEventListener` etc., we still call originals via the prototype.
const _proto_addEventListener = EventTarget.prototype.addEventListener;
const _proto_dispatchEvent = EventTarget.prototype.dispatchEvent;
const _CustomEvent = window.CustomEvent;
const _setTimeout = window.setTimeout.bind(window);
const _clearTimeout = window.clearTimeout.bind(window);
const _crypto = window.crypto;

function randomHostId(): string {
  try {
    const buf = new Uint8Array(8);
    _crypto.getRandomValues(buf);
    let s = '';
    for (let i = 0; i < buf.length; i++) s += (buf[i] ?? 0).toString(16).padStart(2, '0');
    return `solshield-overlay-${s}`;
  } catch {
    return `solshield-overlay-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const HOST_ID = randomHostId();
const OVERLAY_TIMEOUT_MS = 60_000;
const MAX_REATTACH_ATTEMPTS = 5;

function postContentResponse(message: ContentResponse): void {
  // postMessage to self — the page's MAIN world will see it via its own
  // window.addEventListener('message', ...).
  window.postMessage(message, '*');
}

/** Send a log entry to MAIN world's __solshield.log via postMessage.
 *  Lets us see overlay-mount's internal events on /diagnostic. */
function postLogEntry(level: 'info' | 'warn' | 'err', tag: string, msg: string): void {
  try {
    window.postMessage(
      { __solshield_log: true, level, tag: 'om/' + tag, msg },
      '*',
    );
  } catch {
    // ignore
  }
}

/** Build a synthetic safe verdict used when fail-open kicks in. */
function failOpenVerdict(kind: VerdictView['kind']): VerdictView {
  return {
    kind,
    verdict: 'safe',
    score: 0,
    summary: '[SolShield offline] could not analyze — allowing through.',
    findings: [],
    models: [],
    startedAt: Date.now(),
  };
}

function inferKind(reqType: InpageRequest['type']): VerdictView['kind'] {
  if (reqType === 'analyze-tx') return 'tx';
  if (reqType === 'analyze-message') return 'msg';
  return 'domain';
}

/** Wait for the user to click reject/proceed in the overlay (or time out). */
function waitForUserDecision(
  signal: { decision: 'proceed' | 'reject' | null },
): Promise<'proceed' | 'reject'> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (signal.decision) {
        resolve(signal.decision);
        return;
      }
      if (Date.now() - start > OVERLAY_TIMEOUT_MS) {
        reject(new Error('overlay decision timeout'));
        return;
      }
      _setTimeout(tick, 80);
    };
    tick();
  });
}

async function showOverlayAndAwaitDecision(
  verdict: VerdictView,
): Promise<'proceed' | 'reject'> {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);

  const signal: { decision: 'proceed' | 'reject' | null } = { decision: null };

  let unmount = mountInShadow(
    host,
    createElement(Overlay, {
      verdict,
      onProceed: () => {
        signal.decision = 'proceed';
      },
      onReject: () => {
        signal.decision = 'reject';
      },
    }),
  );

  // If the dapp tries to remove our host element, re-attach it (capped at
  // MAX_REATTACH_ATTEMPTS to avoid an infinite re-attach loop if the dapp
  // synchronously re-removes on every mutation).
  let reattachAttempts = 0;
  const observer = new MutationObserver(() => {
    if (signal.decision) return;
    if (!document.body.contains(host)) {
      reattachAttempts++;
      if (reattachAttempts > MAX_REATTACH_ATTEMPTS) {
        postLogEntry('warn', 'overlay', 'host removed too many times — surrendering to reject');
        signal.decision = 'reject';
        return;
      }
      postLogEntry('warn', 'overlay', `host removed by page — re-attaching (#${reattachAttempts})`);
      try { unmount(); } catch { /* ignore */ }
      document.body.appendChild(host);
      unmount = mountInShadow(
        host,
        createElement(Overlay, {
          verdict,
          onProceed: () => { signal.decision = 'proceed'; },
          onReject: () => { signal.decision = 'reject'; },
        }),
      );
    }
  });
  observer.observe(document.body, { childList: true, subtree: false });

  try {
    return await waitForUserDecision(signal);
  } finally {
    observer.disconnect();
    try { unmount(); } catch { /* ignore */ }
    host.remove();
  }
}

async function handleInpageRequest(req: InpageRequest): Promise<void> {
  const kind = inferKind(req.type);
  const t0 = performance.now();
  postLogEntry('info', 'recv', `${req.type} id=${req.id.slice(-6)}`);

  try {
    // Call API DIRECTLY from this ISOLATED-world content script. We used to
    // proxy through background.ts via chrome.runtime.sendMessage, but on real
    // dapps under heavy react traffic the message to the service worker
    // sometimes never resolved (SW killed mid-request, or some other extension
    // interfering). Doing fetch here:
    //   - avoids any chrome.runtime.sendMessage round-trip
    //   - bypasses the dapp's CSP (ISOLATED-world has host_permissions)
    //   - keeps the request alive even if the SW dies
    let verdict: VerdictView;
    try {
      verdict =
        req.type === 'analyze-tx'
          ? await inspectTx(req.data.tx ?? '')
          : await inspectMessage(req.data.message ?? '');
      postLogEntry(
        'info',
        'api-resp',
        `${Math.round(performance.now() - t0)}ms verdict=${verdict.verdict}`,
      );
    } catch (err) {
      // API failed (timeout, network, server error) → fail open so the dapp
      // doesn't break. User loses our protection on this one call but their
      // wallet flow continues.
      postLogEntry(
        'warn',
        'api-fail',
        `${Math.round(performance.now() - t0)}ms err=${err instanceof Error ? err.message : String(err)}`,
      );
      postContentResponse({
        id: req.id,
        verdict: failOpenVerdict(kind),
        failOpen: true,
      });
      return;
    }

    // Safe → forward verdict immediately, no UI.
    if (verdict.verdict === 'safe') {
      postContentResponse({ id: req.id, verdict });
      return;
    }

    // Dangerous / suspicious → show overlay and wait for the user.
    postLogEntry('info', 'overlay', `showing for verdict=${verdict.verdict}`);
    try {
      const decision = await showOverlayAndAwaitDecision(verdict);
      postLogEntry('info', 'overlay', `user decision=${decision}`);
      if (decision === 'reject') {
        postContentResponse({ id: req.id, error: 'User rejected the request.' });
      } else {
        postContentResponse({ id: req.id, verdict });
      }
    } catch (err) {
      postLogEntry(
        'warn',
        'overlay',
        `timed out / threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Treat as rejection (safer default for hostile-looking txs).
      postContentResponse({ id: req.id, error: 'User rejected the request.' });
    }
  } catch (err) {
    postLogEntry('err', 'handler', err instanceof Error ? err.message : String(err));
    postContentResponse({
      id: req.id,
      error: err instanceof Error ? err.message : 'unknown error',
      failOpen: true,
    });
  }
}

// v0.4.3: decision protocol uses CustomEvent on `document` instead of
// window.postMessage. We register at document_start in capture phase so that:
//   1. We fire BEFORE any dapp listener (registration order; dapp scripts
//      can't run until after document_start content scripts).
//   2. stopImmediatePropagation prevents the dapp from EVER seeing the
//      verdict payload or the requestId. The dapp therefore cannot forge a
//      `solshield-decision` event because it has no valid requestId to bind.
_proto_addEventListener.call(
  document,
  'solshield-show',
  (ev: Event) => {
    try {
      ev.stopImmediatePropagation();
    } catch { /* ignore */ }
    const evt = ev as CustomEvent<{
      requestId?: string;
      verdict?: VerdictView;
      kind?: VerdictView['kind'];
    }>;
    const detail = evt.detail ?? {};
    const requestId = detail.requestId;
    const verdict = detail.verdict;
    if (typeof requestId !== 'string' || !verdict) return;

    postLogEntry('info', 'recv-show', `${requestId.slice(-6)} verdict=${verdict.verdict}`);

    void (async () => {
      try {
        // If the tab is hidden, defer the overlay until visible — otherwise
        // the user can't see/click it and we'd just time out at 60s.
        if (document.visibilityState !== 'visible') {
          await new Promise<void>((res) => {
            const onVis = (): void => {
              if (document.visibilityState === 'visible') {
                document.removeEventListener('visibilitychange', onVis);
                res();
              }
            };
            document.addEventListener('visibilitychange', onVis);
            _setTimeout(() => {
              document.removeEventListener('visibilitychange', onVis);
              res();
            }, OVERLAY_TIMEOUT_MS - 1000);
          });
        }
        const decision = await showOverlayAndAwaitDecision(verdict);
        dispatchDecision(requestId, decision);
      } catch (err) {
        postLogEntry('warn', 'overlay', `error: ${err instanceof Error ? err.message : String(err)}`);
        dispatchDecision(requestId, 'reject');
      }
    })();
  },
  { capture: true },
);

function dispatchDecision(requestId: string, decision: 'proceed' | 'reject'): void {
  try {
    _proto_dispatchEvent.call(
      document,
      new _CustomEvent('solshield-decision', { detail: { requestId, decision } }),
    );
    postLogEntry('info', 'send-dec', `${requestId.slice(-6)} → ${decision}`);
  } catch (err) {
    postLogEntry('err', 'send-dec', err instanceof Error ? err.message : String(err));
  }
}

// Legacy window.postMessage path for older callers (analyze-message /
// analyze-tx going through ISOLATED to fetch verdict). Provider-hook v0.4.x
// fetches verdicts directly from MAIN and never uses this path, but we keep
// it for any third-party integration that still might.
_proto_addEventListener.call(
  window,
  'message',
  ((event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as InpageRequest | undefined;
    if (
      !data ||
      typeof data !== 'object' ||
      !('type' in data) ||
      (data.type !== 'analyze-tx' && data.type !== 'analyze-message')
    ) {
      return;
    }
    void handleInpageRequest(data);
  }) as EventListener,
  { capture: true },
);
