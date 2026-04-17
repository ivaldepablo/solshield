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

const SOLSHIELD_VERSION = '0.1.2';

interface SolShieldStatus {
  version: string;
  installedAt: number;
  hooks: {
    legacyWindowSolana: boolean;
    legacyPhantom: boolean;
    legacySolflare: boolean;
    walletStandardWallets: number;
    postMessageInterceptor: boolean;
  };
  interceptions: {
    /** counter — total signing requests we caught and analyzed */
    total: number;
    /** counter — analyses that came back as safe */
    safe: number;
    /** counter — verdicts that triggered the overlay (suspicious + danger) */
    flagged: number;
    /** counter — calls where we failed open (API down, timeout, etc.) */
    failedOpen: number;
    /** the most recent intercepted call, useful for the diagnostic page */
    last: {
      at: number;
      kind: 'tx' | 'msg' | 'wallet-standard-msg' | 'wallet-standard-tx' | 'wallet-standard-signin';
      verdict: 'safe' | 'suspicious' | 'danger' | 'failed-open' | 'unknown';
    } | null;
  };
}

function ensureStatus(): SolShieldStatus {
  const w = window as unknown as { __solshield?: SolShieldStatus };
  if (!w.__solshield) {
    w.__solshield = {
      version: SOLSHIELD_VERSION,
      installedAt: Date.now(),
      hooks: {
        legacyWindowSolana: false,
        legacyPhantom: false,
        legacySolflare: false,
        walletStandardWallets: 0,
        postMessageInterceptor: false,
      },
      interceptions: { total: 0, safe: 0, flagged: 0, failedOpen: 0, last: null },
    };
  }
  return w.__solshield;
}

function recordInterception(
  kind: SolShieldStatus['interceptions']['last'] extends { kind: infer K } | null ? K : never,
  verdict: SolShieldStatus['interceptions']['last'] extends { verdict: infer V } | null ? V : never,
): void {
  const status = ensureStatus();
  status.interceptions.total++;
  if (verdict === 'safe') status.interceptions.safe++;
  else if (verdict === 'failed-open') status.interceptions.failedOpen++;
  else if (verdict === 'suspicious' || verdict === 'danger') status.interceptions.flagged++;
  status.interceptions.last = { at: Date.now(), kind, verdict };
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

function wrapWalletStandardWallet(wallet: WalletStandardWallet): void {
  if (wrappedWallets.has(wallet)) return;
  wrappedWallets.add(wallet);

  const features = wallet.features;
  if (!features || typeof features !== 'object') return;

  // Each feature lives at a namespaced key. We monkey-patch its method in place.
  wrapWalletStandardMethod(features['solana:signMessage'], 'signMessage', 'msg');
  wrapWalletStandardMethod(features['solana:signTransaction'], 'signTransaction', 'tx');
  wrapWalletStandardMethod(
    features['solana:signAndSendTransaction'],
    'signAndSendTransaction',
    'tx',
  );
  wrapWalletStandardMethod(features['solana:signIn'], 'signIn', 'msg');

  ensureStatus().hooks.walletStandardWallets++;
}

function setupWalletStandardHook(): void {
  // Our API. Wallets call `register(wallet)` on this when they discover us.
  const ourApi: WalletStandardApi = Object.freeze({
    register: (...wallets: WalletStandardWallet[]) => {
      wallets.forEach(wrapWalletStandardWallet);
      // Return a no-op unregister — we don't need to actually unregister from our side.
      return () => undefined;
    },
  });

  // Listen for future wallet registration events. The wallet dispatches a
  // `wallet-standard:register-wallet` event whose detail is a callback that
  // expects to be called with `{ register }`.
  try {
    window.addEventListener('wallet-standard:register-wallet', (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (typeof detail === 'function') {
        try {
          detail(ourApi);
        } catch {
          // Swallow — never let our hook break the page.
        }
      }
    });
  } catch {
    // If addEventListener fails for some reason, give up silently.
  }

  // Dispatch our own app-ready event so wallets that loaded BEFORE our content
  // script will see us and call register on us. (This is the race-fix.)
  try {
    window.dispatchEvent(
      new CustomEvent('wallet-standard:app-ready', { detail: ourApi }),
    );
  } catch {
    // ignore
  }

  // Belt-and-braces: some apps construct their own getWallets() and only expose
  // it via navigator.wallets. Poll and wrap anything we missed.
  setInterval(() => {
    const nav = navigator as unknown as { wallets?: { get?: () => readonly WalletStandardWallet[] } };
    const reg = nav.wallets;
    if (reg && typeof reg.get === 'function') {
      try {
        for (const w of reg.get()) wrapWalletStandardWallet(w);
      } catch {
        // ignore
      }
    }
  }, 500);
}

/* ──────────────────────────────────────────────────────────────────
 * postMessage safety net
 *
 * Some wallet abstraction SDKs (Dynamic, Privy, Reown) cache method
 * references at app load time and call them directly later — bypassing
 * our defineProperty getters. As a final layer, we hook window.postMessage
 * and detect signing requests by shape (regardless of who's sending them).
 *
 * This is a "best effort" interceptor and currently logs to
 * window.__solshield.interceptions for diagnostics. Production-blocking
 * via this path is risky (wallets use a confirm/response handshake we'd
 * have to fake), so for now we use it to surface bypass cases on the
 * /diagnostic page.
 * ────────────────────────────────────────────────────────────────── */

function setupPostMessageInterceptor(): void {
  const original = window.postMessage.bind(window);
  let installed = false;

  try {
    Object.defineProperty(window, 'postMessage', {
      configurable: true,
      writable: true,
      value: function (this: Window, message: unknown, ...rest: unknown[]) {
        // Inspect by shape — common wallet bridge patterns include a `method`
        // field with 'signMessage' / 'signTransaction' / 'sign'.
        if (message && typeof message === 'object') {
          const msg = message as Record<string, unknown>;
          const candidate =
            (typeof msg.method === 'string' ? msg.method : undefined) ||
            (typeof msg.type === 'string' ? msg.type : undefined) ||
            '';
          if (/sign(transaction|message|in|all)?/i.test(candidate)) {
            // Just record — don't block (yet). The other hooks should have caught
            // this. If they didn't, the diagnostic page will surface the gap.
            const status = ensureStatus();
            status.interceptions.total++;
            status.interceptions.last = {
              at: Date.now(),
              kind: /transaction/i.test(candidate)
                ? 'wallet-standard-tx'
                : 'wallet-standard-msg',
              verdict: 'unknown',
            };
          }
        }
        // pass through always
        return original.call(window, message as never, ...(rest as []));
      },
    });
    installed = true;
  } catch {
    // window.postMessage is locked down by SES on some pages — ignore.
  }

  ensureStatus().hooks.postMessageInterceptor = installed;
}

// Start patching when script loads
initProviderPatching();
setupWalletStandardHook();
setupPostMessageInterceptor();

export {};
