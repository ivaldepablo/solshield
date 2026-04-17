'use client';

/**
 * /diagnostic — comprehensive health check for the SolShield extension.
 *
 * Reads `window.__solshield` (set by the extension's MAIN-world content
 * script), pings the API, and runs live interception tests so anyone can
 * verify in 5 seconds whether the extension is working before demoing it.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

const CLAUDE_AMBER = '#ffab00';

interface SolShieldStatus {
  version: string;
  installedAt: number;
  safeMode: boolean;
  safeModeReason: string | null;
  hooks: {
    legacyWindowSolana: boolean;
    legacyPhantom: boolean;
    legacySolflare: boolean;
    walletStandardWallets: number;
    postMessageInterceptor: boolean;
  };
  walletNames?: string[];
  interceptions: {
    total: number;
    safe: number;
    flagged: number;
    failedOpen: number;
    last: { at: number; kind: string; verdict: string } | null;
  };
  errors: Array<{ at: number; phase: string; message: string }>;
  log?: Array<{ at: number; level: 'info' | 'warn' | 'err'; tag: string; msg: string }>;
}

type ApiStatus = { state: 'idle' | 'checking' | 'ok' | 'error'; ms?: number; error?: string };

export default function Diagnostic() {
  const [status, setStatus] = useState<SolShieldStatus | null>(null);
  const [tick, setTick] = useState(0);
  const [domainApi, setDomainApi] = useState<ApiStatus>({ state: 'idle' });
  const [msgApi, setMsgApi] = useState<ApiStatus>({ state: 'idle' });
  const [txApi, setTxApi] = useState<ApiStatus>({ state: 'idle' });
  const [interceptionTest, setInterceptionTest] = useState<{
    state: 'idle' | 'running' | 'caught' | 'missed' | 'error';
    detail?: string;
  }>({ state: 'idle' });

  // Re-read window.__solshield every second so live counters update.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const w = window as unknown as { __solshield?: SolShieldStatus };
    setStatus(w.__solshield ?? null);
  }, [tick]);

  const checkApi = useCallback(async () => {
    setDomainApi({ state: 'checking' });
    setMsgApi({ state: 'checking' });
    setTxApi({ state: 'checking' });

    const ping = async (
      path: string,
      body: object,
      setter: (s: ApiStatus) => void,
    ): Promise<void> => {
      const start = performance.now();
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const ms = Math.round(performance.now() - start);
        if (res.ok) setter({ state: 'ok', ms });
        else setter({ state: 'error', ms, error: `HTTP ${res.status}` });
      } catch (err) {
        setter({ state: 'error', error: (err as Error).message });
      }
    };

    await Promise.all([
      ping('/api/check-domain', { url: 'jup.ag' }, setDomainApi),
      ping(
        '/api/inspect-message',
        { message: 'health-check ping', encoding: 'utf8' },
        setMsgApi,
      ),
      // /api/inspect needs a real tx; skip the body and check we get a 400 (alive).
      ping('/api/inspect', { tx: '', encoding: 'base64' }, setTxApi),
    ]);
  }, []);

  // Auto-ping on mount
  useEffect(() => {
    void checkApi();
  }, [checkApi]);

  const runInterceptionTest = useCallback(async () => {
    setInterceptionTest({ state: 'running' });
    try {
      const w = window as unknown as {
        solana?: { signMessage?: ((b: Uint8Array) => Promise<unknown>) & { __solshield_wrapped?: boolean } };
      };
      if (!w.solana?.signMessage) {
        setInterceptionTest({
          state: 'missed',
          detail:
            'no window.solana.signMessage found — Phantom 2025+ does not always expose it on window.solana anymore. The wallet-standard path (modern API, 5 wallets wrapped above) is what real dapps use. This legacy test is informational only.',
        });
        return;
      }

      // Identity check — is the function we got actually our wrapper?
      const fnSrc = w.solana.signMessage.toString();
      const isMarked = w.solana.signMessage.__solshield_wrapped === true;

      const before = (window as unknown as { __solshield?: SolShieldStatus }).__solshield
        ?.interceptions.total ?? 0;

      const malicious =
        'phishy-jup.xyz wants you to sign in with your Solana account:\n\nURI: https://jup.ag\nNonce: diagnostic-test';
      const bytes = new TextEncoder().encode(malicious);

      let caught = false;
      let signResult: unknown;
      let signError: string | null = null;
      try {
        signResult = await Promise.race([
          w.solana.signMessage(bytes),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        signError = msg;
        if (msg.toLowerCase().includes('reject')) caught = true;
      }

      const after = (window as unknown as { __solshield?: SolShieldStatus }).__solshield
        ?.interceptions.total ?? 0;

      const idLine = isMarked
        ? '✓ identity: wrapper is OURS (__solshield_wrapped=true)'
        : `✗ identity: wrapper is NOT ours — fn source starts with: ${fnSrc.slice(0, 120)}`;

      if (after > before) {
        setInterceptionTest({
          state: 'caught',
          detail: `${idLine}\ncounter ${before} → ${after}. ${
            caught
              ? 'You rejected — perfect.'
              : signError
                ? `error: ${signError}`
                : 'Signed (you accepted, or fail-open).'
          }`,
        });
      } else if (!isMarked) {
        setInterceptionTest({
          state: 'missed',
          detail: `${idLine}\nthe extension hooked window.solana but something replaced the function later. Phantom may inject signMessage via a getter that we can't override. The wallet-standard path (above) is the real protection on Phantom 2025+.`,
        });
      } else {
        setInterceptionTest({
          state: 'missed',
          detail: `${idLine}\nour wrapper IS installed but the counter did not move. signResult=${
            signResult === undefined ? 'undefined' : typeof signResult
          }, error=${signError ?? 'none'}. Possible: overlay-mount didn't respond; check that extension service worker is alive.`,
        });
      }
    } catch (err) {
      setInterceptionTest({
        state: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  return (
    <div className="min-h-screen bg-bg text-fg font-mono">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
        <h1 className="text-2xl sm:text-3xl font-bold text-neon-green mb-2">
          // diagnostic
        </h1>
        <p className="text-mute text-sm mb-8">
          end-to-end health check of the SolShield extension. green = working, amber =
          partial, red = broken. open this page right after loading the extension to
          confirm everything is wired up before demoing.
        </p>

        <OverallBanner status={status} />

        {status?.safeMode && (
          <div className="border-2 border-neon-amber/60 bg-neon-amber/10 px-4 py-3 mb-6 text-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-neon-amber font-bold">⚠ SAFE MODE ENGAGED</span>
            </div>
            <p className="text-fg text-xs">
              {status.safeModeReason ?? 'self-disabled to protect this page.'} reload the
              page to retry. if this happens repeatedly on a specific dapp, that dapp&apos;s
              wallet integration is incompatible — file an issue with the URL.
            </p>
          </div>
        )}

        {status?.errors && status.errors.length > 0 && (
          <Section title="// recent errors (from our own hook code)">
            <div className="text-xs space-y-1.5 font-mono">
              {status.errors
                .slice()
                .reverse()
                .map((e, i) => (
                  <div key={i} className="flex gap-3 py-1 border-b border-neon-red/20 last:border-0">
                    <span className="text-dim shrink-0">
                      {new Date(e.at).toISOString().slice(11, 19)}
                    </span>
                    <span className="text-neon-amber shrink-0 w-44 truncate" title={e.phase}>
                      {e.phase}
                    </span>
                    <span className="text-neon-red text-[11px] truncate" title={e.message}>
                      {e.message}
                    </span>
                  </div>
                ))}
            </div>
          </Section>
        )}

        <Section title="// extension presence">
          {status ? (
            <Row label="installed" value={`v${status.version}`} state="ok" />
          ) : (
            <Row
              label="installed"
              value="not detected"
              state="error"
              hint="load the extension from chrome://extensions and refresh this page"
            />
          )}
          {status && (
            <Row
              label="installed at"
              value={new Date(status.installedAt).toLocaleTimeString()}
              state="ok"
            />
          )}
        </Section>

        <Section title="// hooks installed (legacy api)">
          <Row
            label="window.solana"
            value={status?.hooks.legacyWindowSolana ? 'patched' : 'not present'}
            state={status?.hooks.legacyWindowSolana ? 'ok' : 'warn'}
            hint={
              status?.hooks.legacyWindowSolana
                ? undefined
                : 'no Solana wallet exposes window.solana on this page'
            }
          />
          <Row
            label="window.phantom.solana"
            value={status?.hooks.legacyPhantom ? 'patched' : 'not present'}
            state={status?.hooks.legacyPhantom ? 'ok' : 'warn'}
            hint={
              status?.hooks.legacyPhantom
                ? undefined
                : 'install Phantom to enable this hook'
            }
          />
          <Row
            label="window.solflare"
            value={status?.hooks.legacySolflare ? 'patched' : 'not present'}
            state={status?.hooks.legacySolflare ? 'ok' : 'warn'}
          />
        </Section>

        <Section title="// hooks installed (modern api)">
          <Row
            label="wallet-standard wallets wrapped"
            value={String(status?.hooks.walletStandardWallets ?? 0)}
            state={
              status && status.hooks.walletStandardWallets > 0 ? 'ok' : 'warn'
            }
            hint={
              status && status.hooks.walletStandardWallets > 0
                ? undefined
                : 'no wallets registered via Wallet Standard yet'
            }
          />
          <Row
            label="postMessage interceptor"
            value={status?.hooks.postMessageInterceptor ? 'active' : 'inactive'}
            state={status?.hooks.postMessageInterceptor ? 'ok' : 'warn'}
            hint="catches wallet bridge calls that bypass the JS API (Dynamic, Privy, etc.)"
          />
          {status?.walletNames && status.walletNames.length > 0 && (
            <div className="text-xs text-mute mt-2 ml-5">
              wallets seen:{' '}
              {status.walletNames.map((n, i) => (
                <span key={i} className="text-neon-green">
                  {n}
                  {i < status.walletNames!.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section title="// live event log (this tab only)">
          <p className="text-mute text-[11px] mb-2 leading-relaxed">
            every hook event on <b>this tab</b>. to debug magiceden / jupiter / etc:
            open that site → devtools console → run{' '}
            <code className="text-neon-cyan">copy(JSON.stringify(__solshield.log,null,2))</code>{' '}
            then paste here or share with us.
          </p>
          {status?.log && status.log.length > 0 && (
            <div className="mb-2">
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(JSON.stringify(status.log, null, 2));
                }}
              >
                ⎘ copy log as json
              </Button>
            </div>
          )}
          {status?.log && status.log.length > 0 ? (
            <div className="text-[11px] font-mono space-y-0.5 max-h-96 overflow-y-auto bg-bg/60 p-2 border border-neon-green/10">
              {status.log
                .slice()
                .reverse()
                .map((e, i) => {
                  const color =
                    e.level === 'err'
                      ? 'text-neon-red'
                      : e.level === 'warn'
                        ? 'text-neon-amber'
                        : 'text-neon-green';
                  return (
                    <div key={i} className="flex gap-2">
                      <span className="text-dim shrink-0">
                        {new Date(e.at).toISOString().slice(11, 23)}
                      </span>
                      <span className={`${color} shrink-0 w-32 truncate`} title={e.tag}>
                        {e.tag}
                      </span>
                      <span className="text-fg/80 truncate" title={e.msg}>
                        {e.msg}
                      </span>
                    </div>
                  );
                })}
            </div>
          ) : (
            <div className="text-dim text-xs italic">
              no events yet — visit a dapp in another tab to populate this
            </div>
          )}
        </Section>

        <Section title="// api reachability">
          <Row
            label="POST /api/check-domain"
            value={apiText(domainApi)}
            state={apiState(domainApi)}
          />
          <Row
            label="POST /api/inspect-message"
            value={apiText(msgApi)}
            state={apiState(msgApi)}
          />
          <Row
            label="POST /api/inspect"
            value={apiText(txApi)}
            state={apiState(txApi)}
          />
          <Button onClick={() => void checkApi()}>↻ re-ping</Button>
        </Section>

        <Section title="// live interception test">
          <p className="text-mute text-sm mb-3 leading-relaxed">
            calls{' '}
            <code className="text-neon-cyan">window.solana.signMessage()</code> with a
            spoofed SIWS payload. with the extension active, the overlay should appear
            within 1 second. requires Phantom (or another window.solana wallet).
          </p>
          <Button onClick={() => void runInterceptionTest()}>
            ▶ run interception test
          </Button>
          {interceptionTest.state !== 'idle' && (
            <div
              className={`mt-3 p-3 border-l-2 text-sm ${
                interceptionTest.state === 'caught'
                  ? 'border-neon-green bg-neon-green/5 text-neon-green'
                  : interceptionTest.state === 'missed'
                    ? 'border-neon-red bg-neon-red/5 text-neon-red'
                    : interceptionTest.state === 'error'
                      ? 'border-neon-amber bg-neon-amber/5 text-neon-amber'
                      : 'border-neon-cyan bg-neon-cyan/5 text-neon-cyan'
              }`}
            >
              {interceptionTest.state === 'running' && '⏳ running…'}
              {interceptionTest.state === 'caught' && '✓ INTERCEPTED · '}
              {interceptionTest.state === 'missed' && '✗ MISSED · '}
              {interceptionTest.state === 'error' && '⚠ error · '}
              {interceptionTest.detail}
            </div>
          )}
        </Section>

        <Section title="// interception counters">
          <Row
            label="total signing requests caught"
            value={String(status?.interceptions.total ?? 0)}
            state="ok"
          />
          <Row
            label="returned safe"
            value={String(status?.interceptions.safe ?? 0)}
            state="ok"
          />
          <Row
            label="flagged (overlay shown)"
            value={String(status?.interceptions.flagged ?? 0)}
            state={status && status.interceptions.flagged > 0 ? 'warn' : 'ok'}
          />
          <Row
            label="failed open (api down / timeout)"
            value={String(status?.interceptions.failedOpen ?? 0)}
            state={status && status.interceptions.failedOpen > 0 ? 'warn' : 'ok'}
          />
          {status?.interceptions.last && (
            <Row
              label="last interception"
              value={`${status.interceptions.last.kind} → ${status.interceptions.last.verdict} (${secondsAgo(status.interceptions.last.at)}s ago)`}
              state="ok"
            />
          )}
        </Section>

        <div className="mt-12 pt-6 border-t border-neon-green/15 text-center text-mute text-xs">
          <span style={{ color: CLAUDE_AMBER }}>✦</span> SolShield diagnostic ·{' '}
          <Link href="/" className="text-neon-cyan hover:text-neon-cyan/80">
            home
          </Link>{' '}
          ·{' '}
          <Link href="/real-test" className="text-neon-cyan hover:text-neon-cyan/80">
            real-test
          </Link>{' '}
          ·{' '}
          <Link href="/demo" className="text-neon-cyan hover:text-neon-cyan/80">
            demo
          </Link>{' '}
          ·{' '}
          <a
            href="https://github.com/0xnullpavel/solshield"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neon-cyan hover:text-neon-cyan/80"
          >
            github
          </a>
        </div>
      </main>
    </div>
  );
}

function OverallBanner({ status }: { status: SolShieldStatus | null }) {
  if (!status) {
    return (
      <div className="border-2 border-neon-red/50 bg-neon-red/10 px-4 py-3 mb-6 text-sm">
        <span className="text-neon-red font-bold">✗ EXTENSION NOT DETECTED</span> —
        load the extension from <code className="text-neon-cyan">chrome://extensions</code>{' '}
        and refresh this page.
      </div>
    );
  }
  const hookCount =
    Number(status.hooks.legacyWindowSolana) +
    Number(status.hooks.legacyPhantom) +
    Number(status.hooks.legacySolflare) +
    Math.min(1, status.hooks.walletStandardWallets) +
    Number(status.hooks.postMessageInterceptor);
  const total = 5;
  const ok = hookCount >= 3;
  return (
    <div
      className={`border-2 ${
        ok ? 'border-neon-green/50 bg-neon-green/10' : 'border-neon-amber/50 bg-neon-amber/10'
      } px-4 py-3 mb-6 text-sm`}
    >
      <span className={`font-bold ${ok ? 'text-neon-green' : 'text-neon-amber'}`}>
        {ok ? '✓ HEALTHY' : '⚠ PARTIAL'}
      </span>{' '}
      — extension v{status.version} active, {hookCount}/{total} hooks installed.
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 border border-neon-green/15 bg-panel/20 p-4">
      <h2 className="text-neon-cyan text-[10px] tracking-[0.3em] uppercase font-bold mb-3">
        {title}
      </h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  state,
  hint,
}: {
  label: string;
  value: string;
  state: 'ok' | 'warn' | 'error';
  hint?: string;
}) {
  const color = {
    ok: 'text-neon-green',
    warn: 'text-neon-amber',
    error: 'text-neon-red',
  }[state];
  const dot = { ok: '●', warn: '●', error: '●' }[state];
  return (
    <div className="text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-mute">
          <span className={`${color} mr-2`}>{dot}</span>
          {label}
        </span>
        <span className={`${color} font-mono text-xs sm:text-sm`}>{value}</span>
      </div>
      {hint && <div className="text-dim text-xs ml-5 mt-0.5">{hint}</div>}
    </div>
  );
}

function Button({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 px-4 py-2 border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 transition-colors text-xs tracking-[0.2em] uppercase font-bold"
    >
      {children}
    </button>
  );
}

function apiText(s: ApiStatus): string {
  if (s.state === 'idle') return 'pending';
  if (s.state === 'checking') return '⏳ pinging…';
  if (s.state === 'ok') return `${s.ms}ms`;
  return `error: ${s.error ?? 'unknown'}`;
}

function apiState(s: ApiStatus): 'ok' | 'warn' | 'error' {
  if (s.state === 'ok') return 'ok';
  if (s.state === 'error') return 'error';
  return 'warn';
}

function secondsAgo(at: number): number {
  return Math.max(0, Math.round((Date.now() - at) / 1000));
}

function Header() {
  return (
    <nav className="flex items-center justify-between px-4 sm:px-8 py-2.5 border-b border-neon-green/20 bg-bg/85 backdrop-blur-md sticky top-0 z-20">
      <Link href="/" className="flex items-center gap-3">
        <div className="w-6 h-6 border border-neon-green flex items-center justify-center text-neon-green text-xs font-bold">
          ∆
        </div>
        <span className="text-sm tracking-[0.25em] text-neon-green font-bold">SOLSHIELD</span>
        <span className="text-dim text-[10px] tracking-[0.2em] hidden sm:inline">
          / DIAGNOSTIC
        </span>
      </Link>
      <Link
        href="/"
        className="text-mute hover:text-neon-cyan text-[11px] tracking-[0.2em] uppercase"
      >
        [ home ]
      </Link>
    </nav>
  );
}
