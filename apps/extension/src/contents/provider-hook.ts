/**
 * Injected into MAIN world at document_start.
 * Patches window.solana, window.phantom.solana, window.solflare to intercept
 * signTransaction, signAllTransactions, and signMessage before the wallet sees them.
 *
 * v0.1.2: hooks are now "sticky" via Object.defineProperty getters — even if a
 * dapp / SDK (Dynamic, Privy, ...) tries to overwrite our wrapper after we install
 * it, the setter re-wraps the new value. Plus a postMessage interceptor as a
 * catch-all safety net for wallet bridges that bypass the JS API entirely.
 *
 * Diagnostic state is exposed at `window.__solshield` so the /diagnostic page
 * (and curious devs) can introspect what's hooked in real time.
 */

import type { PlasmoCSConfig } from 'plasmo';
import { newId } from '~lib/messaging';
import type { InpageRequest, ContentResponse } from '~lib/messaging';

export const config: PlasmoCSConfig = {
  matches: ['<all_urls>'],
  world: 'MAIN',
  run_at: 'document_start',
};

const SOLSHIELD_VERSION = '0.1.4';

/**
 * v0.1.3 — bulletproof error handling.
 *
 * Every hook is wrapped in try/catch. Every error is recorded in
 * window.__solshield.errors. If we throw 3+ errors in 5 seconds, safe-mode
 * auto-engages and ALL our hooks become passthrough — guaranteeing that the
 * extension can never break a page even if some new wallet/SDK shape trips
 * our code in an unexpected way.
 */

interface SolShieldStatus {
  version: string;
  installedAt: number;
  /** if true, every hook returns immediately — site loads as if extension was off */
  safeMode: boolean;
  /** the reason safe mode engaged, for /diagnostic to show */
  safeModeReason: string | null;
  hooks: {
    legacyWindowSolana: boolean;
    legacyPhantom: boolean;
    legacySolflare: boolean;
    walletStandardWallets: number;
    postMessageInterceptor: boolean;
  };
  interceptions: {
    total: number;
    safe: number;
    flagged: number;
    failedOpen: number;
    last: {
      at: number;
      kind: 'tx' | 'msg' | 'wallet-standard-msg' | 'wallet-standard-tx' | 'wallet-standard-signin';
      verdict: 'safe' | 'suspicious' | 'danger' | 'failed-open' | 'unknown';
    } | null;
  };
  /** Last 20 errors thrown by our own hook code, for diagnostics. */
  errors: Array<{ at: number; phase: string; message: string }>;
}

function ensureStatus(): SolShieldStatus {
  const w = window as unknown as { __solshield?: SolShieldStatus };
  if (!w.__solshield) {
    w.__solshield = {
      version: SOLSHIELD_VERSION,
      installedAt: Date.now(),
      safeMode: false,
      safeModeReason: null,
      hooks: {
        legacyWindowSolana: false,
        legacyPhantom: false,
        legacySolflare: false,
        walletStandardWallets: 0,
        postMessageInterceptor: false,
      },
      interceptions: { total: 0, safe: 0, flagged: 0, failedOpen: 0, last: null },
      errors: [],
    };
  }
  return w.__solshield;
}

const SAFE_MODE_THRESHOLD = 3; // errors
const SAFE_MODE_WINDOW_MS = 5000;

/**
 * Record an error from our own hook code. Auto-engages safe mode if errors
 * pile up — guarantees the extension can never break the host page.
 */
function recordError(phase: string, err: unknown): void {
  try {
    const status = ensureStatus();
    const message = err instanceof Error ? err.message : String(err);
    status.errors.push({ at: Date.now(), phase, message });
    if (status.errors.length > 20) status.errors.shift();

    if (!status.safeMode) {
      const recent = status.errors.filter((e) => Date.now() - e.at < SAFE_MODE_WINDOW_MS);
      if (recent.length >= SAFE_MODE_THRESHOLD) {
        status.safeMode = true;
        status.safeModeReason = `${recent.length} errors in ${SAFE_MODE_WINDOW_MS / 1000}s — extension self-disabled to protect this page`;
        console.warn('[SolShield]', status.safeModeReason);
      }
    }
  } catch {
    // can't even record? give up silently.
  }
}

function inSafeMode(): boolean {
  try {
    return ensureStatus().safeMode;
  } catch {
    return false;
  }
}

/**
 * Wrap any sync function so a thrown error is recorded and swallowed —
 * the original page-side caller sees a no-op instead of a crash.
 */
function safeSync<T>(phase: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    recordError(phase, err);
    return fallback;
  }
}

function recordInterception(
  kind: SolShieldStatus['interceptions']['last'] extends { kind: infer K } | null ? K : never,
  verdict: SolShieldStatus['interceptions']['last'] extends { verdict: infer V } | null ? V : never,
): void {
  try {
    const status = ensureStatus();
    status.interceptions.total++;
    if (verdict === 'safe') status.interceptions.safe++;
    else if (verdict === 'failed-open') status.interceptions.failedOpen++;
    else if (verdict === 'suspicious' || verdict === 'danger') status.interceptions.flagged++;
    status.interceptions.last = { at: Date.now(), kind, verdict };
  } catch (err) {
    recordError('recordInterception', err);
  }
}

ensureStatus(); // always create the status object at script load

// Global map to correlate requests with responses
const pendingRequests = new Map<
  string,
  {
    resolve: (value: ContentResponse) => void;
    reject: (err: Error) => void;
    timeoutId: NodeJS.Timeout;
  }
>();

// Listen for responses from content script
window.addEventListener(
  'message',
  (event) => {
    // Only accept messages from window to itself (content script posts back)
    if (event.source !== window) return;

    const response = event.data as ContentResponse | undefined;
    if (
      !response ||
      typeof response !== 'object' ||
      !('id' in response) ||
      !pendingRequests.has(response.id)
    ) {
      return;
    }

    const pending = pendingRequests.get(response.id)!;
    clearTimeout(pending.timeoutId);
    pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error));
    } else if (response.verdict) {
      pending.resolve(response);
    }
  },
  false
);

/**
 * Send a request to the content script and wait for a verdict.
 * If user rejects: throw wallet-style rejection error (code 4001).
 * If timeout/offline: fail-open by calling original fn.
 */
async function waitForVerdict(
  requestId: string,
  timeout: number = 5000
): Promise<ContentResponse> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Verdict timeout'));
    }, timeout);

    pendingRequests.set(requestId, { resolve, reject, timeoutId });
  });
}

/**
 * Convert a Uint8Array to base64 using only browser-native APIs.
 * Chunked to avoid `RangeError: Maximum call stack size exceeded` on big buffers.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Decode a base64 string to bytes using browser APIs. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Serialize a transaction to base64.
 * Handles VersionedTransaction, Transaction, or raw Uint8Array.
 */
function serializeTransaction(tx: unknown): string {
  let bytes: Uint8Array;

  if (tx instanceof Uint8Array) {
    bytes = tx;
  } else if (typeof tx === 'object' && tx !== null) {
    const obj = tx as Record<string, unknown>;
    if (typeof obj.serialize === 'function') {
      const result = (obj.serialize as (...a: unknown[]) => unknown)();
      if (result instanceof Uint8Array) {
        bytes = result;
      } else if (typeof result === 'string') {
        // Some wallets already return base64 — decode then re-encode (round-trips cleanly).
        bytes = base64ToBytes(result);
      } else {
        throw new Error('Unexpected transaction.serialize() result');
      }
    } else {
      throw new Error('Transaction object has no serialize method');
    }
  } else {
    throw new Error('Invalid transaction type');
  }

  return bytesToBase64(bytes);
}

/**
 * Serialize a message to UTF-8 string.
 * Input is typically Uint8Array from signMessage(data: Uint8Array).
 */
function serializeMessage(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(data);
}

/**
 * Create a wallet-style rejection error that mimics Phantom/Solflare.
 * Matches EIP-1193 error shape so dapps treat it like a native wallet reject.
 */
type CodedError = Error & { code: number };
function createRejectionError(): CodedError {
  const err = new Error('User rejected the request.') as CodedError;
  err.code = 4001;
  return err;
}

/**
 * Wrap a provider method to intercept and check transactions/messages.
 * Preserves original function reference so dapps can't easily detect the wrapper.
 */
function createProxyFn(
  original: (...args: unknown[]) => unknown,
  type: 'signTransaction' | 'signAllTransactions' | 'signMessage'
): (...args: unknown[]) => unknown {
  // Create async wrapper. `this: unknown` lets strict TS compile `.apply(this, ...)`
  // while preserving the call-site receiver (i.e. the provider object Phantom cares about).
  const wrapped = async function (this: unknown, ...args: unknown[]) {
    try {
      if (type === 'signTransaction') {
        // args[0] is the transaction
        const tx = args[0];
        const txBase64 = serializeTransaction(tx);
        const requestId = newId();

        // Post request to content script
        window.postMessage(
          {
            type: 'analyze-tx',
            id: requestId,
            data: { tx: txBase64 },
            timeout: 5000,
          } as InpageRequest,
          '*'
        );

        // Wait for verdict
        const response = await waitForVerdict(requestId, 5000);

        // If not safe, user rejected (verdict was shown in overlay)
        if (response.verdict?.verdict !== 'safe') {
          throw createRejectionError();
        }

        // User approved or safe, call original
        return original.apply(this, args);
      } else if (type === 'signAllTransactions') {
        // args[0] is array of transactions
        const txs = args[0] as unknown[];

        // For now, check the first significant transaction
        // In production, might want to check all or just show a single overlay
        if (Array.isArray(txs) && txs.length > 0) {
          const txBase64 = serializeTransaction(txs[0]);
          const requestId = newId();

          window.postMessage(
            {
              type: 'analyze-tx',
              id: requestId,
              data: { tx: txBase64 },
              timeout: 5000,
            } as InpageRequest,
            '*'
          );

          const response = await waitForVerdict(requestId, 5000);

          if (response.verdict?.verdict !== 'safe') {
            throw createRejectionError();
          }
        }

        return original.apply(this, args);
      } else if (type === 'signMessage') {
        // args[0] is Uint8Array or { data: Uint8Array }
        const msgData =
          args[0] instanceof Uint8Array
            ? args[0]
            : (args[0] as Record<string, unknown>)?.data instanceof Uint8Array
              ? (args[0] as Record<string, unknown>).data
              : args[0];

        if (!(msgData instanceof Uint8Array)) {
          throw new Error('signMessage requires Uint8Array or { data: Uint8Array }');
        }

        const msgUtf8 = serializeMessage(msgData);
        const requestId = newId();

        window.postMessage(
          {
            type: 'analyze-message',
            id: requestId,
            data: { message: msgUtf8 },
            timeout: 5000,
          } as InpageRequest,
          '*'
        );

        const response = await waitForVerdict(requestId, 5000);

        if (response.verdict?.verdict !== 'safe') {
          throw createRejectionError();
        }

        return original.apply(this, args);
      }
    } catch (err) {
      // Handle timeout or offline errors
      if (
        err instanceof Error &&
        (err.message.includes('Verdict timeout') ||
          err.message.includes('offline'))
      ) {
        console.warn('[SolShield] offline, failed open');
        return original.apply(this, args);
      }
      throw err;
    }
  };

  // Preserve original function properties for dapp detection evasion
  Object.defineProperty(wrapped, 'name', { value: original.name });
  Object.defineProperty(wrapped, 'toString', {
    value: () => original.toString(),
  });

  return wrapped;
}

/**
 * Install a "sticky" wrapped method on a provider — even if the dapp / SDK
 * later tries to reassign the property, our setter re-wraps the new value.
 * This is what defeats Dynamic / Privy / Reown style abstraction layers that
 * cache and replace wallet methods at connection time.
 */
function installStickyProxy(
  provider: Record<string, unknown>,
  methodName: 'signTransaction' | 'signAllTransactions' | 'signMessage',
): void {
  const original = provider[methodName];
  if (typeof original !== 'function') return;

  let wrapped = createProxyFn(original as (...args: unknown[]) => unknown, methodName);

  try {
    Object.defineProperty(provider, methodName, {
      configurable: true,
      enumerable: true,
      get: () => wrapped,
      set: (newValue: unknown) => {
        // Someone (likely Dynamic / Privy) is trying to swap our wrapper out.
        // Wrap the new function and keep them happy.
        if (typeof newValue === 'function') {
          wrapped = createProxyFn(newValue as (...args: unknown[]) => unknown, methodName);
        } else {
          wrapped = newValue as never;
        }
      },
    });
  } catch {
    // Property is non-configurable for some reason — fall back to direct assignment.
    provider[methodName] = wrapped;
  }
}

/** Patch a provider object's signing methods (wallet-standard-agnostic legacy hook). */
function patchProvider(provider: Record<string, unknown>, label: string): void {
  installStickyProxy(provider, 'signTransaction');
  installStickyProxy(provider, 'signAllTransactions');
  installStickyProxy(provider, 'signMessage');

  const status = ensureStatus();
  if (label === 'window.solana') status.hooks.legacyWindowSolana = true;
  else if (label === 'phantom.solana') status.hooks.legacyPhantom = true;
  else if (label === 'solflare') status.hooks.legacySolflare = true;
}

/**
 * Poll for wallet providers and patch them as they appear.
 */
function initProviderPatching(): void {
  const maxAttempts = 50; // ~5 seconds at 100ms intervals
  let attempts = 0;

  const checkProviders = (): void => {
    const w = window as unknown as Record<string, unknown>;

    // Check window.solana (legacy)
    if (w.solana && typeof w.solana === 'object') {
      patchProvider(w.solana as Record<string, unknown>, 'window.solana');
    }

    // Check window.phantom.solana
    if (
      w.phantom &&
      typeof w.phantom === 'object' &&
      (w.phantom as Record<string, unknown>).solana &&
      typeof (w.phantom as Record<string, unknown>).solana === 'object'
    ) {
      patchProvider(
        (w.phantom as Record<string, unknown>).solana as Record<string, unknown>,
        'phantom.solana',
      );
    }

    // Check window.solflare
    if (w.solflare && typeof w.solflare === 'object') {
      patchProvider(w.solflare as Record<string, unknown>, 'solflare');
    }

    attempts++;
    if (attempts < maxAttempts) {
      setTimeout(checkProviders, 100);
    }
  };

  checkProviders();
}

/* ──────────────────────────────────────────────────────────────────
 * Wallet Standard hook
 *
 * Modern dapps (Magic Eden, Jupiter latest, Tensor, Drift...) talk to
 * wallets through the Wallet Standard registry, not via window.solana.
 * Specifically they use @wallet-standard/app's `getWallets()` which
 * dispatches a `wallet-standard:app-ready` event; wallets respond by
 * calling `register(wallet)`. We intercept this dance.
 *
 * Strategy:
 *   1. Dispatch our own app-ready event so already-loaded wallets register
 *      with US first. We mutate their feature objects in place, so when
 *      the real app receives them later, the patched versions are what
 *      get used.
 *   2. Listen for register-wallet events for wallets that load later
 *      (race-safe).
 *   3. As a belt-and-braces fallback, poll navigator.wallets every 500ms
 *      and wrap anything we missed.
 * ────────────────────────────────────────────────────────────────── */

interface WalletStandardWallet {
  name?: string;
  features?: Record<string, unknown>;
}

interface WalletStandardApi {
  register: (...wallets: WalletStandardWallet[]) => () => void;
}

const wrappedWallets = new WeakSet<WalletStandardWallet>();

/** Wrap a single Wallet Standard feature method. Returns silently if not present. */
function wrapWalletStandardMethod(
  feature: unknown,
  methodName: string,
  intent: 'msg' | 'tx',
): void {
  if (!feature || typeof feature !== 'object') return;
  const f = feature as Record<string, unknown>;
  const original = f[methodName];
  if (typeof original !== 'function') return;
  if ((original as { __solshield_wrapped?: boolean }).__solshield_wrapped) return;

  const orig = original as (...args: unknown[]) => unknown;
  const wrapped = async function (this: unknown, ...inputs: unknown[]) {
    try {
      // Wallet Standard methods receive (...inputs) where each input has
      // either `message: Uint8Array` (signMessage), `transaction: Uint8Array`
      // (signTransaction), or `transaction: Uint8Array` (signAndSendTransaction).
      // For SIWS (signIn), the input has domain/statement/nonce/etc fields.
      const first = inputs[0] as Record<string, unknown> | undefined;
      if (first) {
        if (intent === 'msg') {
          const message = first.message ?? siwsInputToBytes(first);
          if (message instanceof Uint8Array) {
            const requestId = newId();
            window.postMessage(
              {
                type: 'analyze-message',
                id: requestId,
                data: { message: serializeMessage(message) },
              } as InpageRequest,
              '*',
            );
            const response = await waitForVerdict(requestId, 5000);
            if (response.verdict?.verdict !== 'safe') {
              throw createRejectionError();
            }
          }
        } else {
          const tx = first.transaction;
          if (tx instanceof Uint8Array) {
            const requestId = newId();
            window.postMessage(
              {
                type: 'analyze-tx',
                id: requestId,
                data: { tx: bytesToBase64(tx) },
              } as InpageRequest,
              '*',
            );
            const response = await waitForVerdict(requestId, 5000);
            if (response.verdict?.verdict !== 'safe') {
              throw createRejectionError();
            }
          }
        }
      }
      return orig.apply(this, inputs);
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes('Verdict timeout') || err.message.includes('offline'))
      ) {
        console.warn('[SolShield] wallet-standard offline, failed open');
        return orig.apply(this, inputs);
      }
      throw err;
    }
  };

  Object.defineProperty(wrapped, '__solshield_wrapped', { value: true });
  Object.defineProperty(wrapped, 'name', { value: orig.name });
  Object.defineProperty(wrapped, 'toString', { value: () => orig.toString() });
  f[methodName] = wrapped;
}

/** Reconstruct a SIWS message string from a wallet-standard signIn input. */
function siwsInputToBytes(input: Record<string, unknown>): Uint8Array | undefined {
  const domain = typeof input.domain === 'string' ? input.domain : undefined;
  if (!domain) return undefined;

  const lines: string[] = [`${domain} wants you to sign in with your Solana account:`];
  if (typeof input.address === 'string') {
    lines.push(input.address);
  }
  if (typeof input.statement === 'string') {
    lines.push('', input.statement);
  }
  const meta: string[] = [];
  if (typeof input.uri === 'string') meta.push(`URI: ${input.uri}`);
  if (typeof input.version === 'string') meta.push(`Version: ${input.version}`);
  if (typeof input.chainId === 'string') meta.push(`Chain ID: ${input.chainId}`);
  if (typeof input.nonce === 'string') meta.push(`Nonce: ${input.nonce}`);
  if (typeof input.issuedAt === 'string') meta.push(`Issued At: ${input.issuedAt}`);
  if (meta.length > 0) lines.push('', ...meta);

  return new TextEncoder().encode(lines.join('\n'));
}

function wrapWalletStandardWallet(wallet: WalletStandardWallet | unknown): void {
  if (inSafeMode()) return;

  // Defensive: WeakSet REQUIRES that the key be an object.
  // Dynamic / Privy / weird wallet shims sometimes pass primitives or null.
  // The original v0.1.2 crashed here with "Invalid value used as weak map key",
  // which then took down DynamicSDK on Magic Eden.
  if (!wallet || typeof wallet !== 'object') return;

  try {
    if (wrappedWallets.has(wallet as WalletStandardWallet)) return;
    wrappedWallets.add(wallet as WalletStandardWallet);
  } catch (err) {
    // Frozen / non-extensible objects can also reject WeakSet membership.
    recordError('wrapWalletStandardWallet:weakset', err);
    return;
  }

  const features = (wallet as WalletStandardWallet).features;
  if (!features || typeof features !== 'object') return;

  // Each feature lives at a namespaced key. We monkey-patch its method in place.
  // Each call is independently guarded so one missing/odd-shaped feature can't
  // cascade and disable the rest.
  safeSync('wrap-wallet-standard:signMessage', () => {
    wrapWalletStandardMethod(features['solana:signMessage'], 'signMessage', 'msg');
  }, undefined);
  safeSync('wrap-wallet-standard:signTransaction', () => {
    wrapWalletStandardMethod(features['solana:signTransaction'], 'signTransaction', 'tx');
  }, undefined);
  safeSync('wrap-wallet-standard:signAndSendTransaction', () => {
    wrapWalletStandardMethod(
      features['solana:signAndSendTransaction'],
      'signAndSendTransaction',
      'tx',
    );
  }, undefined);
  safeSync('wrap-wallet-standard:signIn', () => {
    wrapWalletStandardMethod(features['solana:signIn'], 'signIn', 'msg');
  }, undefined);

  try {
    ensureStatus().hooks.walletStandardWallets++;
  } catch {
    // ignore counter update failure
  }
}

function setupWalletStandardHook(): void {
  // Our API. Wallets call `register(wallet)` on this when they discover us.
  // Each wallet entry is independently guarded — one bad wallet can't poison the rest.
  const ourApi: WalletStandardApi = Object.freeze({
    register: (...wallets: WalletStandardWallet[]) => {
      if (inSafeMode()) return () => undefined;
      for (const w of wallets) {
        try {
          wrapWalletStandardWallet(w);
        } catch (err) {
          recordError('wallet-standard:register-iter', err);
        }
      }
      return () => undefined;
    },
  });

  try {
    window.addEventListener('wallet-standard:register-wallet', (event: Event) => {
      if (inSafeMode()) return;
      try {
        const detail = (event as CustomEvent).detail;
        if (typeof detail === 'function') {
          try {
            detail(ourApi);
          } catch (err) {
            recordError('wallet-standard:register-wallet:detail-callback', err);
          }
        }
      } catch (err) {
        recordError('wallet-standard:register-wallet:listener', err);
      }
    });
  } catch (err) {
    recordError('wallet-standard:addEventListener', err);
  }

  // Dispatch our own app-ready event so wallets that loaded BEFORE our content
  // script will see us and call register on us. (This is the race-fix.)
  try {
    window.dispatchEvent(
      new CustomEvent('wallet-standard:app-ready', { detail: ourApi }),
    );
  } catch (err) {
    recordError('wallet-standard:dispatch-app-ready', err);
  }

  // Belt-and-braces: some apps construct their own getWallets() and only expose
  // it via navigator.wallets. Poll and wrap anything we missed.
  setInterval(() => {
    if (inSafeMode()) return;
    safeSync(
      'wallet-standard:poll',
      () => {
        const nav = navigator as unknown as {
          wallets?: { get?: () => readonly WalletStandardWallet[] };
        };
        const reg = nav.wallets;
        if (!reg || typeof reg.get !== 'function') return;
        const list = reg.get();
        if (!list) return;
        for (const w of list) {
          if (w && typeof w === 'object') {
            wrapWalletStandardWallet(w);
          }
        }
      },
      undefined,
    );
  }, 500);
}

/* ──────────────────────────────────────────────────────────────────
 * Pre-write provider trap
 *
 * The most reliable interception point isn't AFTER a wallet writes
 * window.solana — it's defining `window.solana` ourselves with a
 * setter, BEFORE any wallet runs. Whoever (Phantom, Solflare,
 * arbitrary new wallet) tries to assign `window.solana = provider`
 * goes through our setter, we wrap on write, and the dapp later
 * reads back the wrapped version. This is the technique used by
 * Pocket Universe, Stelo, ScamSniffer.
 *
 * NOTE: v0.1.3 had a window.postMessage interceptor here that caused
 * an infinite loop in React's scheduler (which calls postMessage for
 * task scheduling). Removed in v0.1.4 — the property-setter trap
 * achieves the same coverage without touching message dispatch.
 * ────────────────────────────────────────────────────────────────── */

/** Build a setter that wraps any incoming provider object on assignment. */
function trapProvider(target: object, key: string, label: string): void {
  // If something is already there, wrap and re-store via the new descriptor.
  let stored: unknown = (target as Record<string, unknown>)[key];
  if (stored && typeof stored === 'object') {
    safeSync(`provider-trap:${label}:initial`, () => {
      patchProvider(stored as Record<string, unknown>, label);
    }, undefined);
  }
  try {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      get: () => stored,
      set: (newValue: unknown) => {
        stored = newValue;
        if (newValue && typeof newValue === 'object') {
          safeSync(`provider-trap:${label}:set`, () => {
            patchProvider(newValue as Record<string, unknown>, label);
          }, undefined);
        }
      },
    });
  } catch (err) {
    recordError(`provider-trap:${label}:defineProperty`, err);
  }
}

function setupProviderTraps(): void {
  // window.solana — used by older Phantom builds and most wallet adapters.
  safeSync('trap:window.solana', () => {
    trapProvider(window, 'solana', 'window.solana');
  }, undefined);

  // window.solflare — Solflare's primary handle.
  safeSync('trap:window.solflare', () => {
    trapProvider(window, 'solflare', 'solflare');
  }, undefined);

  // window.phantom — Phantom uses a nested object: window.phantom.solana.
  // We can't trap nested keys before the parent exists, so we trap window.phantom
  // and then trap .solana once phantom is set.
  safeSync('trap:window.phantom', () => {
    let phantomStored: unknown = (window as unknown as Record<string, unknown>).phantom;
    const wrapPhantom = (p: unknown) => {
      if (!p || typeof p !== 'object') return;
      // If phantom.solana already exists, patch it.
      const inner = (p as Record<string, unknown>).solana;
      if (inner && typeof inner === 'object') {
        patchProvider(inner as Record<string, unknown>, 'phantom.solana');
      }
      // Trap future writes to phantom.solana.
      try {
        const phantomObj = p as Record<string, unknown>;
        let solanaStored: unknown = phantomObj.solana;
        Object.defineProperty(phantomObj, 'solana', {
          configurable: true,
          enumerable: true,
          get: () => solanaStored,
          set: (newSolana: unknown) => {
            solanaStored = newSolana;
            if (newSolana && typeof newSolana === 'object') {
              safeSync('trap:phantom.solana:set', () => {
                patchProvider(newSolana as Record<string, unknown>, 'phantom.solana');
              }, undefined);
            }
          },
        });
      } catch (err) {
        recordError('trap:phantom.solana:defineProperty', err);
      }
    };

    if (phantomStored && typeof phantomStored === 'object') {
      wrapPhantom(phantomStored);
    }
    Object.defineProperty(window, 'phantom', {
      configurable: true,
      enumerable: true,
      get: () => phantomStored,
      set: (newPhantom: unknown) => {
        phantomStored = newPhantom;
        wrapPhantom(newPhantom);
      },
    });
  }, undefined);

  // Mark all three legacy hooks as "ready" — actual hook flips happen inside
  // patchProvider when wallets assign themselves through our setter.
  ensureStatus().hooks.legacyWindowSolana = true;
  ensureStatus().hooks.legacyPhantom = true;
  ensureStatus().hooks.legacySolflare = true;
  // postMessage interceptor removed — see comment block above.
  ensureStatus().hooks.postMessageInterceptor = false;
}

// Start patching when script loads. Each top-level setup is independently
// guarded — if one throws, the others still install and the page stays usable.
//
// Order matters:
//   1. setupProviderTraps    — define window.solana / window.phantom / window.solflare
//                              with setters BEFORE any wallet writes them.
//   2. initProviderPatching  — best-effort poll for wallets that already wrote
//                              their provider before we got here.
//   3. setupWalletStandardHook — modern dapp interception via wallet-standard.
safeSync('init:provider-traps', setupProviderTraps, undefined);
safeSync('init:legacy-providers', initProviderPatching, undefined);
safeSync('init:wallet-standard', setupWalletStandardHook, undefined);

export {};
