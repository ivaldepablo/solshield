/**
 * Service worker: receives inspection requests from content scripts,
 * calls SolShield API, caches results, tracks stats.
 *
 * Also relays system-notification requests for the focus-steal defense
 * (Layer 1): the wallet's notification.html tab can fullscreen-steal focus
 * after the user clicks PROCEED in our overlay, so we fire a `chrome.notifications`
 * toast in parallel — that toast is rendered by the OS, NOT by Chrome's
 * tab compositor, so it remains visible regardless of which tab is foregrounded.
 */

import { inspectTx, inspectMessage, checkDomain } from '~lib/api-client';
import type { BackgroundRequest, BackgroundResponse, VerdictView } from '~lib/messaging';

// chrome.notifications message contract from overlay-mount (ISOLATED-world).
// MAIN world cannot reach chrome.* APIs, ISOLATED can — but only chrome.runtime
// + chrome.storage. chrome.notifications is service-worker-only on most builds,
// so we proxy through here.
interface ShowSystemNotificationRequest {
  type: 'show-system-notification';
  verdict: VerdictView;
  hostname: string;
  // Optional: the source tab ID. If omitted we resolve from the sender.
  tabId?: number;
}

// Layer 3 (badge) clear request, fired by overlay-mount when the persistent
// banner is dismissed or when the user rejects (so the badge never lingers).
interface ClearWarningBadgeRequest {
  type: 'clear-warning-badge';
  // Optional: the tab to clear. If omitted we resolve from the sender.
  tabId?: number;
}

// Simple in-memory cache with 5-minute TTL.
//
// Keys are SHA-256 of the FULL payload, not a prefix. Earlier we used the
// first 50 chars of base64(tx), but Solana txs start with the signature
// length byte + 64-byte signature — those 50 chars are nearly identical
// across many different transactions from the same wallet, causing
// catastrophic cache collisions. A drainer could pre-poison the cache with
// a benign tx whose prefix collides with an attack tx, then the attack tx
// is served `safe` from cache.
const cache = new Map<string, { verdict: VerdictView; expires: number }>();

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}

async function cacheKey(req: BackgroundRequest): Promise<string> {
  const { type, data } = req;
  if (type === 'inspect-tx' && data.tx) {
    return `tx:${await sha256Hex(data.tx)}`;
  }
  if (type === 'inspect-message' && data.message) {
    return `msg:${await sha256Hex(data.message)}`;
  }
  if (type === 'check-domain' && data.url) {
    return `domain:${await sha256Hex(data.url)}`;
  }
  return '';
}

async function getCached(req: BackgroundRequest): Promise<VerdictView | null> {
  const key = await cacheKey(req);
  if (!key) return null;

  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.verdict;
  }

  if (cached) cache.delete(key);
  return null;
}

async function setCached(req: BackgroundRequest, verdict: VerdictView): Promise<void> {
  const key = await cacheKey(req);
  if (key) {
    cache.set(key, { verdict, expires: Date.now() + 5 * 60 * 1000 }); // 5 min TTL
  }
}

async function trackStats(verdict: VerdictView): Promise<void> {
  const stats = await chrome.storage.local.get(['totalScans', 'threatsBlocked']);
  const totalScans = (stats.totalScans || 0) + 1;
  const threatsBlocked =
    (stats.threatsBlocked || 0) + (verdict.verdict !== 'safe' ? 1 : 0);

  await chrome.storage.local.set({ totalScans, threatsBlocked });
}

async function handleRequest(
  req: BackgroundRequest
): Promise<BackgroundResponse> {
  const cached = await getCached(req);
  if (cached) {
    return { verdict: cached };
  }

  try {
    let verdict: VerdictView;

    if (req.type === 'inspect-tx' && req.data.tx) {
      verdict = await inspectTx(req.data.tx);
    } else if (req.type === 'inspect-message' && req.data.message) {
      verdict = await inspectMessage(req.data.message);
    } else if (req.type === 'check-domain' && req.data.url) {
      verdict = await checkDomain(req.data.url);
    } else {
      throw new Error('Invalid request: missing required fields');
    }

    await setCached(req, verdict);
    await trackStats(verdict);

    return { verdict };
  } catch (err) {
    console.error('[SolShield] Background request failed:', err);
    // Fail-open: let content script decide whether to proceed
    return {
      error: err instanceof Error ? err.message : 'Unknown error',
      failOpen: true,
    };
  }
}

// --------------------------------------------------------------------------
// System notification layer (focus-steal defense, Layer 1).
//
// We map a notification ID → tab ID so that clicking the notification can
// re-focus the dapp tab (where our banner is also waiting as Layer 2).
// --------------------------------------------------------------------------
const NOTIFICATION_PREFIX = 'solshield-';
const notificationToTab = new Map<string, number>();
let notifSeq = 0;

function newNotificationId(): string {
  notifSeq = (notifSeq + 1) & 0x7fffffff;
  return `${NOTIFICATION_PREFIX}${Date.now()}-${notifSeq}`;
}

/**
 * Resolve the 128px icon URL from the manifest. Plasmo content-hashes asset
 * filenames, so we can't hard-code `icon128.plasmo.<hash>.png` — read it
 * from the live manifest each call.
 */
function resolveIconUrl(): string | undefined {
  try {
    const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
      icons?: Record<string, string>;
    };
    const icons = manifest.icons ?? {};
    const fname = icons['128'] ?? icons['64'] ?? icons['48'] ?? icons['32'] ?? icons['16'];
    return fname ? chrome.runtime.getURL(fname) : undefined;
  } catch {
    return undefined;
  }
}

function buildNotificationOptions(verdict: VerdictView, hostname: string): chrome.notifications.NotificationCreateOptions {
  const isDanger = verdict.verdict === 'danger';
  const sevTag = isDanger ? 'DANGER' : 'SUSPICIOUS';
  const kindTag = verdict.kind === 'tx' ? 'transaction' : verdict.kind === 'msg' ? 'message' : 'site';
  const title = `SolShield · ${sevTag} ${kindTag} on ${hostname}`;

  // We try to surface the most useful snippet: prefer the verdict summary
  // (server-rendered), fall back to the first finding's message.
  const fallback = verdict.findings[0]?.message ?? 'verify in your wallet popup before signing';
  const body = (verdict.summary || fallback).slice(0, 220);

  const iconUrl = resolveIconUrl();
  const opts: chrome.notifications.NotificationCreateOptions = {
    type: 'basic',
    // chrome.notifications.create requires an iconUrl for type:'basic'. If we
    // somehow can't resolve one, fall back to a transparent data URL so the
    // call doesn't reject — losing the icon is better than losing the toast.
    iconUrl: iconUrl ?? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
    title,
    message: body,
    contextMessage: 'click to return to the dapp tab',
    priority: 2, // 2 = max; OS-level toast, breaks through fullscreen tab focus
    requireInteraction: true, // persist until user dismisses
    silent: false,
  };
  return opts;
}

// --------------------------------------------------------------------------
// Layer 3 — extension-icon badge.
//
// Even after the user dismisses the OS notification (Layer 1) and the
// in-page banner (Layer 2), they may still come back to this dapp tab later.
// The badge sits on the toolbar icon and is the persistent reminder that
// "this tab triggered a SolShield warning". Per-tab so it doesn't pollute
// other tabs the user has open.
// --------------------------------------------------------------------------
const BADGE_COLOR_DANGER = '#FF003C';
const BADGE_COLOR_SUSPICIOUS = '#FFAB00';
const BADGE_TEXT_WARNING = '!';

function setWarningBadge(tabId: number | undefined, verdict: VerdictView): void {
  if (verdict.verdict === 'safe') return;
  // chrome.action is MV3-only; in MV2/firefox builds it's chrome.browserAction.
  // We only target MV3 here, but we still feature-detect to avoid throwing in
  // unusual contexts (e.g. tests or future MV3->MV4 transitions).
  const action = chrome.action;
  if (typeof action === 'undefined' || typeof action.setBadgeText !== 'function') return;

  const color = verdict.verdict === 'danger' ? BADGE_COLOR_DANGER : BADGE_COLOR_SUSPICIOUS;
  try {
    // tabId can legitimately be undefined if the SW couldn't resolve a sender
    // tab (e.g. a request fired from the new-tab page during a tab-swap race).
    // In that case we set globally — better a slightly noisy badge than no
    // visual cue at all.
    if (typeof tabId === 'number') {
      action.setBadgeText({ text: BADGE_TEXT_WARNING, tabId });
      action.setBadgeBackgroundColor({ color, tabId });
    } else {
      action.setBadgeText({ text: BADGE_TEXT_WARNING });
      action.setBadgeBackgroundColor({ color });
    }
  } catch {
    // ignore — badge is purely cosmetic, never break the request flow.
  }
}

function clearWarningBadge(tabId: number | undefined): void {
  const action = chrome.action;
  if (typeof action === 'undefined' || typeof action.setBadgeText !== 'function') return;
  try {
    if (typeof tabId === 'number') {
      action.setBadgeText({ text: '', tabId });
    } else {
      action.setBadgeText({ text: '' });
    }
  } catch {
    // ignore
  }
}

// When the user navigates away from the flagged dapp in this tab, the badge
// becomes stale. Clear it on URL change so a benign next-page visit doesn't
// keep wearing a red "!". Re-flagging will re-set it.
if (typeof chrome.tabs !== 'undefined' && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) clearWarningBadge(tabId);
  });
}

async function showSystemNotification(req: ShowSystemNotificationRequest, sender: chrome.runtime.MessageSender): Promise<void> {
  // Layer 3 always fires (even if chrome.notifications is unavailable) — the
  // badge is a separate API surface and should not be gated on notifications
  // permission. Resolve tabId once and use for both layers.
  const tabId = req.tabId ?? sender.tab?.id;
  setWarningBadge(tabId, req.verdict);

  if (typeof chrome.notifications === 'undefined' || typeof chrome.notifications.create !== 'function') {
    // Permission missing or chrome build without notifications API. Layer 2
    // (banner) and Layer 3 (badge above) still work, so we silently no-op.
    return;
  }
  const notifId = newNotificationId();
  if (typeof tabId === 'number') {
    notificationToTab.set(notifId, tabId);
    // GC: drop after 10 minutes if user never clicks.
    setTimeout(() => notificationToTab.delete(notifId), 10 * 60 * 1000);
  }
  const opts = buildNotificationOptions(req.verdict, req.hostname);
  try {
    await new Promise<void>((resolve) => {
      try {
        chrome.notifications.create(notifId, opts, () => {
          // chrome.runtime.lastError surfaces e.g. user-blocked notifications.
          // We swallow — Layer 2 still has the user's back.
          if (chrome.runtime.lastError) {
            // ignore
          }
          resolve();
        });
      } catch {
        resolve();
      }
    });
  } catch {
    // ignore — best effort.
  }
}

// Click → focus the originating tab. The dapp's banner (Layer 2) is rendered
// there and acts as the persistent visual reminder.
if (typeof chrome.notifications !== 'undefined' && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    const tabId = notificationToTab.get(notificationId);
    if (typeof tabId === 'number') {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        // Focus tab + window.
        chrome.tabs.update(tabId, { active: true });
        if (typeof tab.windowId === 'number') {
          chrome.windows.update(tab.windowId, { focused: true });
        }
      });
    }
    try {
      chrome.notifications.clear(notificationId);
    } catch {
      // ignore
    }
    notificationToTab.delete(notificationId);
  });
}

if (typeof chrome.notifications !== 'undefined' && chrome.notifications.onClosed) {
  chrome.notifications.onClosed.addListener((notificationId) => {
    notificationToTab.delete(notificationId);
  });
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener(
  (
    req: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundResponse | { ok: true }) => void
  ) => {
    // Validate request shape
    if (typeof req !== 'object' || req === null) {
      sendResponse({ error: 'Invalid request', failOpen: true });
      return;
    }

    // System notification side-channel — fire and forget.
    if ((req as { type?: string }).type === 'show-system-notification') {
      void showSystemNotification(req as ShowSystemNotificationRequest, sender);
      sendResponse({ ok: true });
      return false;
    }

    // Layer 3 — badge clear. Triggered by overlay-mount when the persistent
    // banner is dismissed or when the user rejects (banner never mounts in
    // that case but the notification + badge already fired in parallel).
    if ((req as { type?: string }).type === 'clear-warning-badge') {
      const r = req as ClearWarningBadgeRequest;
      clearWarningBadge(r.tabId ?? sender.tab?.id);
      sendResponse({ ok: true });
      return false;
    }

    const request = req as BackgroundRequest;

    // Handle asynchronously and send response
    handleRequest(request)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          error: err instanceof Error ? err.message : 'Unknown error',
          failOpen: true,
        });
      });

    // Return true to indicate we will send response asynchronously
    return true;
  }
);

export {};
