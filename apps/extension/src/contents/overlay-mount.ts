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
import { Banner } from '../components/Banner';
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
const BANNER_HOST_ID = `${HOST_ID}-banner`;
const OVERLAY_TIMEOUT_MS = 60_000;
const MAX_REATTACH_ATTEMPTS = 5;
// Banner sits for up to 90s after the overlay closes, then self-dismisses so
// we don't pollute the dapp page indefinitely. Long enough that a slow user
// alt-tabbing through Phantom + back still sees it.
const BANNER_LIFETIME_MS = 90_000;

function postContentResponse(message: ContentResponse): void {
  // postMessage to self — the page's MAIN world will see it via its own
  // window.addEventListener('message', ...).
  window.postMessage(message, '*');
}

/**
 * Layer 1 of focus-steal defense — fire a chrome.notifications toast via the
 * background SW. The toast is rendered by the OS (not Chrome's tab compositor)
 * so it remains visible even when Phantom's notification.html tab fullscreen-
 * focuses itself after the user clicks PROCEED.
 *
 * chrome.notifications is not available in MAIN world but IS available from
 * ISOLATED-world content scripts (this file) via chrome.runtime.sendMessage to
 * the SW. We do it as a SW round-trip rather than direct because permission
 * scope is cleaner and we want chrome.tabs.update access from the click handler.
 *
 * Best-effort, fire-and-forget. Layer 2 (Banner) is the safety net. The SW
 * also flips Layer 3 (toolbar-icon badge) inside this same handler.
 */
function fireSystemNotification(verdict: VerdictView): void {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    let hostname = '';
    try {
      hostname = location.hostname || location.host || 'this site';
    } catch {
      hostname = 'this site';
    }
    chrome.runtime.sendMessage(
      { type: 'show-system-notification', verdict, hostname },
      () => {
        // chrome.runtime.lastError can fire if the SW is asleep / no listener.
        // Either way we don't care — it's a best-effort side channel.
        const _err = chrome.runtime.lastError;
        if (_err) {
          // ignore
        }
      },
    );
  } catch {
    // ignore
  }
}

/**
 * Layer 3 cleanup — ask the SW to wipe the toolbar badge for this tab.
 * Called from:
 *   1. Banner onDismiss (user clicked the × on the persistent banner).
 *   2. Banner auto-dismiss timer (90s lifetime expired).
 *   3. Overlay reject path (no banner mounts there, but the badge was set in
 *      parallel via fireSystemNotification → must clean up explicitly).
 */
function clearWarningBadge(): void {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({ type: 'clear-warning-badge' }, () => {
      const _err = chrome.runtime.lastError;
      if (_err) {
        // ignore — best effort
      }
    });
  } catch {
    // ignore
  }
}

/**
 * Layer 2 of focus-steal defense — mount a persistent banner on the dapp page
 * so when the user comes back to this tab after interacting with the wallet's
 * notification.html, they still see the verdict. Independent host element +
 * shadow root so the overlay's lifecycle doesn't kill it.
 */
function mountPersistentBanner(verdict: VerdictView): void {
  try {
    document.getElementById(BANNER_HOST_ID)?.remove();

    const host = document.createElement('div');
    host.id = BANNER_HOST_ID;
    document.body.appendChild(host);

    let unmount: (() => void) | null = null;
    let cleared = false;
    const cleanup = (): void => {
      try { unmount?.(); } catch { /* ignore */ }
      unmount = null;
      try { host.remove(); } catch { /* ignore */ }
      // Layer 3: idempotently clear the toolbar badge. The banner can be torn
      // down via the user clicking ×, the auto-dismiss timer, or both back-
      // to-back — we only want to message the SW once.
      if (!cleared) {
        cleared = true;
        clearWarningBadge();
      }
    };

    unmount = mountInShadow(
      host,
      createElement(Banner, {
        verdict,
        onDismiss: cleanup,
      }),
    );

    // Auto-dismiss after BANNER_LIFETIME_MS so we don't hang around forever.
    _setTimeout(cleanup, BANNER_LIFETIME_MS);
  } catch (err) {
    postLogEntry('warn', 'banner', `mount failed: ${err instanceof Error ? err.message : String(err)}`);
  }
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

  // Layer 1 fires in PARALLEL with the overlay mount — the user may be
  // about to alt-tab to Phantom's notification.html, so we want the OS toast
  // up immediately, not after they decide.
  fireSystemNotification(verdict);

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

  let bannerWillOwnBadge = false;
  try {
    const decision = await waitForUserDecision(signal);
    // Layer 2: when the user PROCEEDs, leave a persistent banner so when
    // they return to this dapp tab from the wallet's notification.html they
    // can still see what we flagged. We don't show it on REJECT since the
    // tx never goes to the wallet — banner would be noise.
    if (decision === 'proceed') {
      mountPersistentBanner(verdict);
      // Banner cleanup will fire clearWarningBadge() — don't double-clear.
      bannerWillOwnBadge = true;
    } else {
      // Layer 3 cleanup on reject: the badge was set in parallel via
      // fireSystemNotification, but no banner mounts on the reject path —
      // without an explicit clear here the badge would linger forever.
      clearWarningBadge();
    }
    return decision;
  } finally {
    observer.disconnect();
    try { unmount(); } catch { /* ignore */ }
    host.remove();
    // If we exited via throw (e.g. waitForUserDecision timed out) no banner
    // was mounted and the reject branch above never ran — clear the badge so
    // it doesn't linger after a failed decision wait.
    if (!bannerWillOwnBadge && signal.decision !== 'reject') {
      clearWarningBadge();
    }
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
