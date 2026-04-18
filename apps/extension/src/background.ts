/**
 * Service worker: receives inspection requests from content scripts,
 * calls SolShield API, caches results, tracks stats.
 */

import { inspectTx, inspectMessage, checkDomain } from '~lib/api-client';
import type { BackgroundRequest, BackgroundResponse, VerdictView } from '~lib/messaging';

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
