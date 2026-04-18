/**
 * ISOLATED-world content script (document_idle).
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
import type { ContentResponse, InpageRequest, VerdictView } from '../lib/messaging';

export const config: PlasmoCSConfig = {
  matches: ['<all_urls>'],
  world: 'ISOLATED',
  run_at: 'document_idle',
};

const HOST_ID = 'solshield-overlay-host';
const OVERLAY_TIMEOUT_MS = 60_000;

interface BackgroundResponse {
  verdict?: VerdictView;
  error?: string;
  failOpen?: boolean;
}

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
      setTimeout(tick, 80);
    };
    tick();
  });
}

async function showOverlayAndAwaitDecision(
  verdict: VerdictView,
): Promise<'proceed' | 'reject'> {
  // Tear down any leftover overlay from a previous request.
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);

  const signal: { decision: 'proceed' | 'reject' | null } = { decision: null };

  const unmount = mountInShadow(
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

  try {
    return await waitForUserDecision(signal);
  } finally {
    unmount();
    host.remove();
  }
}

async function handleInpageRequest(req: InpageRequest): Promise<void> {
  const kind = inferKind(req.type);
  const t0 = performance.now();
  postLogEntry('info', 'recv', `${req.type} id=${req.id.slice(-6)}`);
  try {
    const bgRequest =
      req.type === 'analyze-tx'
        ? { type: 'inspect-tx' as const, data: { tx: req.data.tx } }
        : { type: 'inspect-message' as const, data: { message: req.data.message } };

    let response: BackgroundResponse | undefined;
    try {
      response = (await chrome.runtime.sendMessage(bgRequest)) as BackgroundResponse | undefined;
      postLogEntry(
        'info',
        'bg-resp',
        `${Math.round(performance.now() - t0)}ms verdict=${!!response?.verdict} err=${response?.error || 'none'}`,
      );
    } catch (err) {
      postLogEntry('err', 'bg-throw', err instanceof Error ? err.message : String(err));
      throw err;
    }

    // Background unreachable or returned no verdict → fail open.
    if (!response || (!response.verdict && response.failOpen !== false)) {
      postContentResponse({
        id: req.id,
        verdict: failOpenVerdict(kind),
        failOpen: true,
      });
      return;
    }

    if (!response.verdict) {
      postContentResponse({
        id: req.id,
        error: response.error ?? 'unknown background error',
      });
      return;
    }

    // Safe → forward verdict immediately, no UI.
    if (response.verdict.verdict === 'safe') {
      postContentResponse({ id: req.id, verdict: response.verdict });
      return;
    }

    // Dangerous / suspicious → show overlay and wait for the user.
    try {
      const decision = await showOverlayAndAwaitDecision(response.verdict);
      if (decision === 'reject') {
        postContentResponse({
          id: req.id,
          error: 'User rejected the request.',
        });
      } else {
        postContentResponse({ id: req.id, verdict: response.verdict });
      }
    } catch {
      // Timeout → treat as rejection (safer default for hostile-looking txs).
      postContentResponse({
        id: req.id,
        error: 'User rejected the request.',
      });
    }
  } catch (err) {
    postContentResponse({
      id: req.id,
      error: err instanceof Error ? err.message : 'unknown error',
      failOpen: true,
    });
  }
}

window.addEventListener(
  'message',
  (event) => {
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
  },
  false,
);
