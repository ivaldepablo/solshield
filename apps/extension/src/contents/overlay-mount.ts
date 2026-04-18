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
import { inspectTx, inspectMessage } from '../lib/api-client';
import type { ContentResponse, InpageRequest, VerdictView } from '../lib/messaging';

export const config: PlasmoCSConfig = {
  matches: ['<all_urls>'],
  world: 'ISOLATED',
  run_at: 'document_idle',
};

const HOST_ID = 'solshield-overlay-host';
const OVERLAY_TIMEOUT_MS = 60_000;

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

window.addEventListener(
  'message',
  (event) => {
    if (event.source !== window) return;
    const data = event.data as
      | (InpageRequest & { __solshield_show_overlay?: undefined })
      | { __solshield_show_overlay: true; id: string; verdict: VerdictView; kind: VerdictView['kind'] }
      | undefined;
    if (!data || typeof data !== 'object') return;

    // New v0.3.1 path: provider-hook fetched verdict directly and just wants
    // us to show the overlay.
    if ((data as { __solshield_show_overlay?: boolean }).__solshield_show_overlay === true) {
      const showReq = data as {
        __solshield_show_overlay: true;
        id: string;
        verdict: VerdictView;
        kind: VerdictView['kind'];
      };
      void (async () => {
        try {
          const decision = await showOverlayAndAwaitDecision(showReq.verdict);
          window.postMessage({ id: showReq.id, decision }, '*');
        } catch {
          window.postMessage({ id: showReq.id, decision: 'reject' as const }, '*');
        }
      })();
      return;
    }

    // Legacy path (still supported as fallback for any provider-hook < 0.3.1).
    if (
      !('type' in data) ||
      (data.type !== 'analyze-tx' && data.type !== 'analyze-message')
    ) {
      return;
    }
    void handleInpageRequest(data as InpageRequest);
  },
  false,
);
