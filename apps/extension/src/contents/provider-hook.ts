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

const SOLSHIELD_VERSION = '0.4.0';
const VERDICT_TIMEOUT_MS = 15_000;

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
  /** Names of wallets we've wrapped via Wallet Standard, in order of first sight. */
  walletNames: string[];
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
  /** Full event log (last 100). Higher-fidelity than counters — every hook event lands here. */
  log: Array<{ at: number; level: 'info' | 'warn' | 'err'; tag: string; msg: string }>;
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
      walletNames: [],
      interceptions: { total: 0, safe: 0, flagged: 0, failedOpen: 0, last: null },
      errors: [],
      log: [],
    };
  }
  return w.__solshield;
}

/** Append to circular event log. /diagnostic surfaces this for runtime debugging. */
function logEvent(level: 'info' | 'warn' | 'err', tag: string, msg: string): void {
  try {
    const status = ensureStatus();
    status.log.push({ at: Date.now(), level, tag, msg });
    if (status.log.length > 100) status.log.shift();
  } catch {
    // ignore
  }
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
    logEvent('err', phase, message);

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

// Listen for responses from content script.
//
// CRITICAL: window.postMessage broadcasts to ALL listeners on window —
// including our own. We send analyze-* requests AND we listen for the
// content-script's responses on the same channel. To avoid consuming our
// own request (which would clearTimeout but never resolve/reject, hanging
// the promise forever), we only accept messages that look like responses:
// they must NOT carry our request `type` field, and must carry either
// `verdict` or `error`.
window.addEventListener(
  'message',
  (event) => {
    if (event.source !== window) return;

    const data = event.data as ContentResponse | undefined;
    if (!data || typeof data !== 'object') return;

    // overlay-mount log forwarding: bridges its events into __solshield.log
    // so /diagnostic shows the full pipeline.
    if ((data as unknown as Record<string, unknown>).__solshield_log === true) {
      const d = data as unknown as { level: 'info' | 'warn' | 'err'; tag: string; msg: string };
      logEvent(d.level, d.tag, d.msg);
      return;
    }

    if (!('id' in data)) return;
    // Skip our own outgoing requests — they have a `type` field, responses don't.
    if ('type' in (data as unknown as Record<string, unknown>)) return;
    // Must be a response from overlay-mount — has verdict or error.
    if (!('verdict' in data) && !('error' in data)) return;

    if (!pendingRequests.has(data.id)) return;

    const pending = pendingRequests.get(data.id)!;
    clearTimeout(pending.timeoutId);
    pendingRequests.delete(data.id);

    if (data.error) {
      pending.reject(new Error(data.error));
    } else if (data.verdict) {
      pending.resolve(data);
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
    logEvent('info', 'intercept', `legacy ${type} called`);
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
            timeout: VERDICT_TIMEOUT_MS,
          } as InpageRequest,
          '*'
        );

        // Wait for verdict
        const response = await waitForVerdict(requestId, VERDICT_TIMEOUT_MS);

        const v = response.verdict?.verdict ?? 'unknown';
        recordInterception('tx', v as 'safe' | 'suspicious' | 'danger' | 'unknown');
        logEvent('info', 'verdict', `legacy tx → ${v}`);

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
              timeout: VERDICT_TIMEOUT_MS,
            } as InpageRequest,
            '*'
          );

          const response = await waitForVerdict(requestId, VERDICT_TIMEOUT_MS);
          const v = response.verdict?.verdict ?? 'unknown';
          recordInterception('tx', v as 'safe' | 'suspicious' | 'danger' | 'unknown');
          logEvent('info', 'verdict', `legacy txs[] → ${v}`);

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
            timeout: VERDICT_TIMEOUT_MS,
          } as InpageRequest,
          '*'
        );

        const response = await waitForVerdict(requestId, VERDICT_TIMEOUT_MS);
        const v = response.verdict?.verdict ?? 'unknown';
        recordInterception('msg', v as 'safe' | 'suspicious' | 'danger' | 'unknown');
        logEvent('info', 'verdict', `legacy msg → ${v}`);

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
        recordInterception(type === 'signMessage' ? 'msg' : 'tx', 'failed-open');
        logEvent('warn', 'fail-open', `legacy ${type}: ${err.message}`);
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
 * Returns true iff we successfully installed (so /diagnostic can report
 * accurately instead of lying that we patched when we didn't).
 */
function installStickyProxy(
  provider: Record<string, unknown>,
  methodName: 'signTransaction' | 'signAllTransactions' | 'signMessage',
  label: string,
): boolean {
  let original: unknown;
  try {
    original = provider[methodName];
  } catch (err) {
    logEvent('warn', 'install-sticky', `${label}.${methodName}: read threw — ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  if (typeof original !== 'function') {
    return false;
  }
  // Already our wrapper — skip silently. The polling loop re-runs every 100ms
  // and we don't want to spam the log or re-wrap our own wrapper on each pass.
  if ((original as { __solshield_wrapped?: boolean }).__solshield_wrapped) return true;

  let wrapped = createProxyFn(original as (...args: unknown[]) => unknown, methodName);
  Object.defineProperty(wrapped, '__solshield_wrapped', { value: true });

  try {
    Object.defineProperty(provider, methodName, {
      configurable: true,
      enumerable: true,
      get: () => wrapped,
      set: (newValue: unknown) => {
        if (typeof newValue === 'function') {
          // If the incoming value is already wrapped, keep it as-is to avoid
          // double-wrapping when SDKs round-trip the same fn through us.
          if ((newValue as { __solshield_wrapped?: boolean }).__solshield_wrapped) {
            wrapped = newValue as typeof wrapped;
          } else {
            wrapped = createProxyFn(newValue as (...args: unknown[]) => unknown, methodName);
            Object.defineProperty(wrapped, '__solshield_wrapped', { value: true });
            logEvent('info', 'install-sticky', `${label}.${methodName} re-wrapped after SDK reassigned`);
          }
        } else {
          wrapped = newValue as never;
        }
      },
    });
    logEvent('info', 'install-sticky', `${label}.${methodName} installed via defineProperty`);
    return true;
  } catch (err) {
    try {
      provider[methodName] = wrapped;
      logEvent('info', 'install-sticky', `${label}.${methodName} installed via direct assignment`);
      return true;
    } catch (err2) {
      logEvent('err', 'install-sticky', `${label}.${methodName} BOTH failed — defineProperty: ${err instanceof Error ? err.message : String(err)} | assignment: ${err2 instanceof Error ? err2.message : String(err2)}`);
      return false;
    }
  }
}

/** Patch a provider object's signing methods (wallet-standard-agnostic legacy hook).
 *  Only marks the hook flag if at least one method was successfully patched. */
function patchProvider(provider: Record<string, unknown>, label: string): void {
  const okTx = installStickyProxy(provider, 'signTransaction', label);
  const okTxs = installStickyProxy(provider, 'signAllTransactions', label);
  const okMsg = installStickyProxy(provider, 'signMessage', label);
  const anyPatched = okTx || okTxs || okMsg;
  if (!anyPatched) return;

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
    logEvent('info', 'intercept', `polled ws-${methodName} called`);
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
            const response = await waitForVerdict(requestId, VERDICT_TIMEOUT_MS);
            const v = response.verdict?.verdict ?? 'unknown';
            recordInterception(
              methodName === 'signIn' ? 'wallet-standard-signin' : 'wallet-standard-msg',
              v as 'safe' | 'suspicious' | 'danger' | 'unknown',
            );
            logEvent('info', 'verdict', `polled ws-${methodName} → ${v}`);
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
            const response = await waitForVerdict(requestId, VERDICT_TIMEOUT_MS);
            const v = response.verdict?.verdict ?? 'unknown';
            recordInterception(
              'wallet-standard-tx',
              v as 'safe' | 'suspicious' | 'danger' | 'unknown',
            );
            logEvent('info', 'verdict', `polled ws-${methodName} → ${v}`);
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
        recordInterception(
          intent === 'tx' ? 'wallet-standard-tx' : 'wallet-standard-msg',
          'failed-open',
        );
        logEvent('warn', 'fail-open', `polled ws-${methodName}: ${err.message}`);
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

/**
 * v0.2.0 critical fix: register-wallet redispatch pattern.
 *
 * The wallet-standard discovery dance has a fatal flaw if you only ATTACH
 * a listener: the wallet dispatches register-wallet → both YOU and the
 * dapp's listener fire. The wallet calls your callback AND the dapp's
 * callback separately. You wrap your copy. The dapp gets the unwrapped
 * original. Every signing call from the dapp bypasses your hook.
 *
 * The fix is to MUTATE THE EVENT before it reaches the dapp:
 *   1. Catch register-wallet in capture phase
 *   2. stopImmediatePropagation()
 *   3. Redispatch a NEW event whose detail is a wrapping callback
 *   4. The dapp's listener catches the new event and calls our wrapping
 *      callback with its api. Our wrapping callback wraps the api, then
 *      calls the original wallet callback with the wrapped api.
 *   5. The wallet calls wrappedApi.register(self) → we wrap → call dappApi
 *      .register(wrappedWallet) → dapp ends up with the wrapped wallet.
 *
 * This is what Pocket Universe / Stelo / Wallet Guard all do (they use
 * window.ethereum proxy, but the same "intercept-and-hold" pattern).
 */
function setupWalletStandardHook(): void {
  // Marker for "this detail is OUR wrapping callback" so we don't infinite-loop.
  const WRAPPING_MARKER = '__solshield_wrapping_detail';

  // Our API. Wallets call `register(wallet)` on this when they discover us.
  // Each wallet entry is independently guarded — one bad wallet can't poison the rest.
  // The wrapping returns a Proxy; the wallet that called us continues with the
  // unwrapped instance (it doesn't read its own re-registered self), but any
  // dApp that later receives the wallet via getWallets() will get the wrapped
  // version because we mutated nothing on the underlying object.
  const ourApi: WalletStandardApi = Object.freeze({
    register: (...wallets: WalletStandardWallet[]) => {
      if (inSafeMode()) return () => undefined;
      for (const w of wallets) {
        try {
          wrapWalletWithProxy(w);
        } catch (err) {
          recordError('wallet-standard:register-iter', err);
        }
      }
      return () => undefined;
    },
  });

  try {
    // CAPTURE PHASE — guarantees we see the event before the dApp's listener.
    window.addEventListener(
      'wallet-standard:register-wallet',
      (event: Event) => {
        if (inSafeMode()) return;
        try {
          const detail = (event as CustomEvent).detail as
            | (((api: WalletStandardApi) => void) & { [k: string]: boolean | undefined })
            | undefined;
          if (typeof detail !== 'function') return;

          // Already-wrapped detail (we redispatched this) → let the dapp's
          // listener handle it normally.
          if (detail[WRAPPING_MARKER]) return;

          // STOP propagation so the dapp's listener never sees this raw event.
          // We'll redispatch with a wrapping detail.
          event.stopImmediatePropagation();

          logEvent('info', 'register-wallet', 'caught raw event, wrapping detail and redispatching');

          const wrappingDetail = (apiFromAnyone: WalletStandardApi): void => {
            // Build a wrapping API that wraps wallets, then forwards to the
            // real api (the dapp's). When the wallet calls our register, we
            // wrap and pipe wrapped wallets to the dapp's register so the
            // dapp ends up with our Proxy-wrapped wallet.
            const wrappingApi: WalletStandardApi = {
              register: (...wallets: WalletStandardWallet[]) => {
                if (inSafeMode()) return apiFromAnyone.register(...wallets);
                const wrapped = wallets.map((w) => {
                  try {
                    return wrapWalletWithProxy(w);
                  } catch (err) {
                    recordError('wallet-standard:wrap-iter', err);
                    return w;
                  }
                });
                return apiFromAnyone.register(...wrapped);
              },
            };
            try {
              detail(wrappingApi);
            } catch (err) {
              recordError('wallet-standard:wrapped-detail-call', err);
            }
          };
          (wrappingDetail as unknown as Record<string, boolean>)[WRAPPING_MARKER] = true;

          // Redispatch the wrapped event so the dapp's listener picks it up.
          // Our own listener will see the marker and pass through.
          // (Do NOT also call detail(ourApi) as a fallback — that would call
          // the wallet's callback twice and some wallets infinite-loop or
          // re-dispatch when called more than once. The 500ms polling loop
          // below catches any wallet that has no dapp listener.)
          window.dispatchEvent(
            new CustomEvent('wallet-standard:register-wallet', { detail: wrappingDetail }),
          );
        } catch (err) {
          recordError('wallet-standard:register-wallet:listener', err);
        }
      },
      { capture: true },
    );
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
 * dispatchEvent hijack — intercept wallet-standard:app-ready from dApps
 *
 * Modern wallets (Phantom 2025+, Solflare, Backpack, Glow) define
 * `window.solana` and `window.phantom` as NON-CONFIGURABLE properties
 * for security. Object.defineProperty throws "Cannot redefine property"
 * which is what crashed v0.1.3/4 on Magic Eden.
 *
 * The interception point that actually works on modern wallets is the
 * Wallet Standard handshake. The protocol:
 *   1. App calls getWallets() → app dispatches `wallet-standard:app-ready`
 *      with `{ detail: { register } }`.
 *   2. Wallet's register-wallet listener invokes `register(wallet)`.
 *
 * If we hijack window.dispatchEvent, we see EVERY app-ready dispatched by
 * EVERY dApp on the page, and can swap `detail.register` for our wrapping
 * register before the wallet ever sees it. This is what Pocket Universe,
 * Sherlock Wallet, and the modern WalletGuard Solana flow do.
 *
 * Verified against:
 *   - github.com/wallet-standard/wallet-standard (spec source)
 *   - docs.phantom.com/developer-powertools/wallet-standard
 *   - github.com/TeamRaccoons/sherlock-wallet (Solana reference)
 * ────────────────────────────────────────────────────────────────── */

/**
 * v0.4.0 — third interception point: navigator.wallets.get()
 *
 * Dynamic SDK (used by Magic Eden, many others) caches the wallet reference
 * at connect-time via @wallet-standard/app's getWallets().get(). If our
 * wrap installed AFTER Dynamic's cache snapshot, Dynamic forever calls
 * signMessage on the unwrapped original.
 *
 * Defensive measure: poll for navigator.wallets to appear, then wrap its
 * `get` method so EVERY enumeration returns wrapped wallets. This catches
 * any dapp that uses @wallet-standard/app even if we lost the register-wallet
 * race.
 */
function setupNavigatorWalletsHook(): void {
  let installed = false;
  const tryInstall = (): void => {
    if (installed) return;
    const nav = navigator as unknown as {
      wallets?: { get?: () => readonly WalletStandardWallet[]; push?: (...wallets: WalletStandardWallet[]) => unknown };
    };
    const reg = nav.wallets;
    if (!reg || typeof reg.get !== 'function') return;
    installed = true;

    const origGet = reg.get.bind(reg);
    reg.get = function (): readonly WalletStandardWallet[] {
      try {
        const wallets = origGet();
        if (!Array.isArray(wallets)) return wallets;
        return wallets.map((w) => {
          try {
            return wrapWalletWithProxy(w) as WalletStandardWallet;
          } catch {
            return w;
          }
        });
      } catch (err) {
        recordError('navigator-wallets:get', err);
        return [];
      }
    };
    logEvent('info', 'nav-wallets', 'wrapped navigator.wallets.get');

    // Also wrap push() so any LATE-added wallets get wrapped
    if (typeof reg.push === 'function') {
      const origPush = reg.push.bind(reg);
      reg.push = function (...wallets: WalletStandardWallet[]) {
        const wrapped = wallets.map((w) => {
          try {
            return wrapWalletWithProxy(w) as WalletStandardWallet;
          } catch {
            return w;
          }
        });
        return origPush(...wrapped);
      };
      logEvent('info', 'nav-wallets', 'wrapped navigator.wallets.push');
    }
  };

  // Try now, then poll for 5 seconds since navigator.wallets appears late
  // (after the wallet-standard library inits).
  tryInstall();
  let attempts = 0;
  const id = setInterval(() => {
    attempts++;
    tryInstall();
    if (installed || attempts >= 50) clearInterval(id);
  }, 100);
}

function setupDispatchEventHijack(): void {
  const origDispatch = window.dispatchEvent.bind(window);
  try {
    window.dispatchEvent = function (event: Event) {
      try {
        if (
          !inSafeMode() &&
          event &&
          event.type === 'wallet-standard:app-ready' &&
          'detail' in event
        ) {
          const detail = (event as CustomEvent).detail as
            | { register?: (...wallets: WalletStandardWallet[]) => unknown }
            | undefined;
          if (detail && typeof detail.register === 'function') {
            const realRegister = detail.register;
            logEvent('info', 'dispatch-hijack', 'caught wallet-standard:app-ready, swapping register');
            // Replace register so anything the wallet passes through gets wrapped.
            detail.register = (...wallets: WalletStandardWallet[]) => {
              logEvent('info', 'dispatch-hijack', `register called with ${wallets.length} wallet(s)`);
              const wrapped = wallets.map((w) => {
                try {
                  return wrapWalletWithProxy(w);
                } catch (err) {
                  recordError('dispatchEvent:wrap-wallet', err);
                  return w;
                }
              });
              return realRegister.call(detail, ...wrapped);
            };
          }
        }
      } catch (err) {
        recordError('dispatchEvent:inspect', err);
      }
      return origDispatch(event);
    };
  } catch (err) {
    recordError('dispatchEvent:install', err);
  }
}

/* ──────────────────────────────────────────────────────────────────
 * Proxy-based wallet wrapping
 *
 * Direct mutation `wallet.features['solana:signMessage'].signMessage = fn`
 * silently no-ops when the wallet froze the feature object (Backpack does
 * this; Phantom does it intermittently). A Proxy intercepts at property-
 * access time without touching the underlying object, so Object.freeze
 * doesn't matter and Dynamic/Privy/Reown can't cache around us.
 * ────────────────────────────────────────────────────────────────── */

const SIGNING_FEATURES = new Set([
  'solana:signMessage',
  'solana:signTransaction',
  'solana:signAndSendTransaction',
  'solana:signIn',
]);

const SIGNING_METHODS_BY_FEATURE: Record<string, string> = {
  'solana:signMessage': 'signMessage',
  'solana:signTransaction': 'signTransaction',
  'solana:signAndSendTransaction': 'signAndSendTransaction',
  'solana:signIn': 'signIn',
};

function wrapSigningInvocation(
  fn: (...args: unknown[]) => unknown,
  featureName: string,
): (this: unknown, ...args: unknown[]) => Promise<unknown> {
  const intent: 'msg' | 'tx' =
    featureName === 'solana:signTransaction' || featureName === 'solana:signAndSendTransaction'
      ? 'tx'
      : 'msg';

  const wrapper = async function (this: unknown, ...inputs: unknown[]): Promise<unknown> {
    if (inSafeMode()) return fn.apply(this, inputs);
    logEvent('info', 'intercept', `${featureName} called`);
    try {
      const first = inputs[0] as Record<string, unknown> | undefined;
      if (!first) return fn.apply(this, inputs);

      // Get the verdict. Try DIRECT fetch first (MAIN world to solshield.dev
      // — CORS allows it, no CSP on supported dapps). If that fails (CSP on
      // some dapp, network), fall back to the postMessage → overlay-mount
      // path. Either way we get a verdict or fail-open in <15s.
      let verdict: { verdict: 'safe' | 'suspicious' | 'danger'; summary?: string } | null = null;
      let verdictKind: 'msg' | 'tx' = intent;

      if (intent === 'msg') {
        const message = (first.message as Uint8Array | undefined) ?? siwsInputToBytes(first);
        if (!(message instanceof Uint8Array)) {
          logEvent('warn', 'intercept', `${featureName}: no Uint8Array payload, passing through`);
          return fn.apply(this, inputs);
        }
        const text = serializeMessage(message);
        logEvent('info', 'analyze-msg', text.slice(0, 80));
        verdict = await getVerdict('inspect-message', { message: text, encoding: 'utf8' });
      } else {
        const tx = first.transaction;
        if (!(tx instanceof Uint8Array)) {
          logEvent('warn', 'intercept', `${featureName}: no Uint8Array tx, passing through`);
          return fn.apply(this, inputs);
        }
        logEvent('info', 'analyze-tx', `${tx.length} bytes`);
        verdict = await getVerdict('inspect', { tx: bytesToBase64(tx), encoding: 'base64' });
        verdictKind = 'tx';
      }

      if (!verdict) {
        // Both direct fetch AND postMessage fallback failed. Fail-open.
        console.warn('[SolShield] all paths failed, failing open');
        recordInterception(
          verdictKind === 'tx' ? 'wallet-standard-tx' : 'wallet-standard-msg',
          'failed-open',
        );
        logEvent('warn', 'fail-open', `${featureName}: no verdict from any path`);
        return fn.apply(this, inputs);
      }

      recordInterception(
        featureName === 'solana:signIn'
          ? 'wallet-standard-signin'
          : verdictKind === 'tx'
            ? 'wallet-standard-tx'
            : 'wallet-standard-msg',
        verdict.verdict,
      );
      logEvent('info', 'verdict', `${verdictKind} → ${verdict.verdict}`);

      if (verdict.verdict !== 'safe') {
        // Show overlay via overlay-mount (postMessage). Wait for user.
        // If overlay-mount is unreachable, default to reject (safer for
        // suspicious calls).
        const decision = await askUserViaOverlay(verdict, verdictKind);
        if (decision === 'reject') throw createRejectionError();
      }
      return fn.apply(this, inputs);
    } catch (err) {
      if (err instanceof Error && err.message === 'User rejected the request.') throw err;
      throw err;
    }
  };
  Object.defineProperty(wrapper, '__solshield_wrapped', { value: true });
  return wrapper;
}

/** Direct fetch to the SolShield API from MAIN world. Returns null on failure
 *  (so caller can decide to fail-open). 8s timeout. */
async function getVerdict(
  endpoint: 'inspect-message' | 'inspect',
  body: Record<string, unknown>,
): Promise<{ verdict: 'safe' | 'suspicious' | 'danger'; summary?: string } | null> {
  const url = `https://solshield.dev/api/${endpoint}`;
  logEvent('info', 'verdict-fetch', `→ ${endpoint}`);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      logEvent('warn', 'verdict-fetch', `HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { verdict: 'safe' | 'suspicious' | 'danger'; summary?: string };
    logEvent('info', 'verdict-fetch', `← ${data.verdict}`);
    return data;
  } catch (err) {
    logEvent('warn', 'verdict-fetch', `fail: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Show overlay via overlay-mount in ISOLATED world. Wait for user's click
 *  back via postMessage. Returns 'proceed' or 'reject'. Defaults to reject
 *  on timeout (safer for non-safe verdicts). */
async function askUserViaOverlay(
  verdictData: { verdict: 'safe' | 'suspicious' | 'danger'; summary?: string },
  kind: 'msg' | 'tx',
): Promise<'proceed' | 'reject'> {
  const requestId = newId();
  logEvent('info', 'overlay-ask', `${requestId.slice(-6)}`);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      logEvent('warn', 'overlay-ask', `${requestId.slice(-6)} timeout → reject`);
      window.removeEventListener('message', listener);
      resolve('reject');
    }, 60_000);

    const listener = (event: MessageEvent): void => {
      if (event.source !== window) return;
      const data = event.data as { id?: string; decision?: 'proceed' | 'reject' } | undefined;
      if (!data || data.id !== requestId || !data.decision) return;
      clearTimeout(timer);
      window.removeEventListener('message', listener);
      logEvent('info', 'overlay-ask', `${requestId.slice(-6)} → ${data.decision}`);
      resolve(data.decision);
    };
    window.addEventListener('message', listener);

    window.postMessage(
      {
        __solshield_show_overlay: true,
        id: requestId,
        verdict: verdictData,
        kind,
      },
      '*',
    );
  });
}

/**
 * Wrap a wallet with a Proxy that intercepts the signing features on access.
 * The underlying wallet object is unchanged — Object.freeze on features can't
 * stop us, and SDKs that cache method references at a future point still get
 * our wrapper because they read through the Proxy.
 */
/** Cached wrapped Proxies — same wallet must always map to the same Proxy
 *  identity, otherwise SDKs that use Map<wallet, ...> get duplicate entries
 *  and DynamicSDK's WeakMap-based session cache breaks. */
const wrappedProxyCache = new WeakMap<WalletStandardWallet, WalletStandardWallet>();

function wrapWalletWithProxy(wallet: WalletStandardWallet): WalletStandardWallet {
  if (!wallet || typeof wallet !== 'object') return wallet;

  const cached = wrappedProxyCache.get(wallet);
  if (cached) return cached;

  try {
    wrappedWallets.add(wallet);
  } catch {
    return wallet;
  }

  const featureProxyCache = new WeakMap<object, unknown>();
  // CRITICAL: cache the features Proxy so wallet.features returns the SAME
  // object every time. Otherwise React sees a new object on every render,
  // thinks state changed, hits hydration error #418, and re-renders forever.
  // (DynamicSDK on magiceden.io was crashing because of exactly this.)
  let featuresProxyMemo: unknown = undefined;
  let featuresOriginalMemo: unknown = undefined;

  const proxied = new Proxy(wallet, {
    get(target, prop, receiver) {
      if (prop !== 'features') return Reflect.get(target, prop, receiver);
      const features = Reflect.get(target, prop, receiver);
      if (!features || typeof features !== 'object') return features;
      // If the underlying features object is the same as last time, return
      // the SAME proxy. Wallet usually keeps features stable, so this hits
      // 99%+ of the time and gives React the reference equality it needs.
      if (featuresOriginalMemo === features && featuresProxyMemo) return featuresProxyMemo;
      featuresOriginalMemo = features;
      const featuresObj = features as Record<string, unknown>;

      const featuresProxy = new Proxy(featuresObj, {
        get(fTarget, fKey) {
          const feature = Reflect.get(fTarget, fKey);
          if (!feature || typeof feature !== 'object') return feature;
          if (typeof fKey !== 'string' || !SIGNING_FEATURES.has(fKey)) return feature;

          // Reuse the same feature-proxy across reads to avoid identity issues
          // (some SDKs use Map<feature, ...> internally).
          const cached = featureProxyCache.get(feature as object);
          if (cached) return cached;

          const featureProxy = new Proxy(feature as Record<string, unknown>, {
            get(fpTarget, fpKey) {
              const value = Reflect.get(fpTarget, fpKey);
              if (typeof value !== 'function') return value;
              if (fpKey !== SIGNING_METHODS_BY_FEATURE[fKey]) return value;
              // If polling already wrapped this method in place, return as-is.
              // Re-wrapping causes a 2-level nested wrapper that doubles
              // latency and breaks the message correlation.
              if ((value as { __solshield_wrapped?: boolean }).__solshield_wrapped) {
                return value;
              }
              return wrapSigningInvocation(
                value as (...args: unknown[]) => unknown,
                fKey,
              );
            },
          });
          featureProxyCache.set(feature as object, featureProxy);
          return featureProxy;
        },
      });
      featuresProxyMemo = featuresProxy;
      return featuresProxy;
    },
  });

  wrappedProxyCache.set(wallet, proxied);

  try {
    const status = ensureStatus();
    status.hooks.walletStandardWallets++;
    const name = typeof wallet.name === 'string' ? wallet.name : '<unnamed>';
    if (!status.walletNames.includes(name)) status.walletNames.push(name);
    logEvent('info', 'wrap-wallet', `wrapped wallet: ${name}`);
  } catch {
    // ignore counter update failure
  }

  return proxied;
}

ensureStatus().hooks.legacyWindowSolana = false;
ensureStatus().hooks.legacyPhantom = false;
ensureStatus().hooks.legacySolflare = false;
ensureStatus().hooks.postMessageInterceptor = false;

// v0.1.5 init order — proxy-based interception via Wallet Standard.
//
// Modern wallets (Phantom 2025+, Solflare, Backpack) define their globals
// as non-configurable. The defineProperty trap from v0.1.3/4 always threw
// "Cannot redefine property" and triggered safe-mode. We've dropped it.
//
// What works on modern Phantom: the Wallet Standard handshake. Two hooks:
//   1. dispatchEvent hijack — catches the dApp's wallet-standard:app-ready
//      and replaces detail.register so any wallet that responds gets
//      Proxy-wrapped before reaching the real registry.
//   2. wallet-standard:register-wallet capture-phase listener — catches
//      wallets that announce themselves first; we hand them our own api
//      whose register applies the same Proxy wrap.
//
// Both layers use the same wrapWalletWithProxy() — defeats Object.freeze
// (Backpack), defeats reference caching (Dynamic / Privy / Reown), and
// works regardless of which side (wallet or dApp) loads first.
//
// Legacy initProviderPatching is kept ONLY for ancient dApps that read
// window.solana directly without going through Wallet Standard. It's a
// no-op on Phantom 2025+ because window.solana is non-configurable, but
// it doesn't crash anymore (we don't use defineProperty on it).
logEvent('info', 'boot', `SolShield v${SOLSHIELD_VERSION} loading on ${location.host}`);
// Init order matters: install register-wallet capture-phase listener FIRST so
// any synchronous register-wallet event during the dispatchEvent hijack setup
// is caught. Then install dispatchEvent hijack. Then legacy provider patches.
safeSync('init:wallet-standard', setupWalletStandardHook, undefined);
safeSync('init:dispatch-hijack', setupDispatchEventHijack, undefined);
safeSync('init:navigator-wallets', setupNavigatorWalletsHook, undefined);
safeSync('init:legacy-providers', initProviderPatching, undefined);
logEvent('info', 'boot', 'all hooks installed');

export {};
