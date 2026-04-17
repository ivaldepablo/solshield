/**
 * Service worker: receives inspection requests from content scripts,
 * calls SolShield API, caches results, tracks stats.
 */

import { inspectTx, inspectMessage, checkDomain } from '~lib/api-client';
import type { BackgroundRequest, BackgroundResponse, VerdictView } from '~lib/messaging';

// Simple in-memory cache with 5-minute TTL
const cache = new Map<string, { verdict: VerdictView; expires: number }>();

function cacheKey(req: BackgroundRequest): string {
  const { type, data } = req;
  if (type === 'inspect-tx' && data.tx) {
    return `tx:${data.tx.slice(0, 50)}`; // Use tx prefix for cache busting
  }
  if (type === 'inspect-message' && data.message) {
    return `msg:${data.message}`;
  }
  if (type === 'check-domain' && data.url) {
    return `domain:${data.url}`;
  }
  return '';
}

function getCached(req: BackgroundRequest): VerdictView | null {
  const key = cacheKey(req);
  if (!key) return null;

  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.verdict;
  }

  // Expired, remove from cache
  if (cached) cache.delete(key);
  return null;
}

function setCached(req: BackgroundRequest, verdict: VerdictView): void {
  const key = cacheKey(req);
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
  // Check cache first
  const cached = getCached(req);
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

    // Cache and track
    setCached(req, verdict);
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

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener(
  (
    req: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundResponse) => void
  ) => {
    // Validate request shape
    if (typeof req !== 'object' || req === null) {
      sendResponse({ error: 'Invalid request', failOpen: true });
      return;
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
