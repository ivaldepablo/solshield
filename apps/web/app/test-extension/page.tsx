'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const CLAUDE_AMBER = '#ffab00';

interface MockWallet {
  isPhantom: boolean;
  publicKey: { toString: () => string };
  isConnected: boolean;
  signTransaction: (tx: unknown) => Promise<unknown>;
  signAllTransactions: (txs: unknown[]) => Promise<unknown[]>;
  signMessage: (msg: Uint8Array) => Promise<{ signature: Uint8Array }>;
}

type LogEntry = {
  ts: number;
  kind: 'info' | 'reject' | 'allow' | 'error';
  text: string;
};

const SIWS_SPOOF =
  'phishy-jup.xyz wants you to sign in with your Solana account:\n\nURI: https://jup.ag\nNonce: a1b2c3d4\nIssued At: 2026-04-17T22:00:00Z';
const SIWS_LEGIT =
  'jup.ag wants you to sign in with your Solana account:\n\nURI: https://jup.ag\nNonce: e5f6g7h8\nIssued At: 2026-04-17T22:00:00Z';
const PERMIT_LIKELY =
  'Authorize transfer of 1,000,000 USDC from your wallet to address 9aB...DnK on behalf of dapp.tld';

export default function TestExtensionPage() {
  const [hookDetected, setHookDetected] = useState<'unknown' | 'yes' | 'no'>(
    'unknown',
  );
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  // Mount a fake window.solana so the SolShield provider-hook has something to wrap.
  useEffect(() => {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const mock: MockWallet = {
      isPhantom: true,
      publicKey: { toString: () => 'TestWalletDemo11111111111111111111111111111' },
      isConnected: true,
      signTransaction: async (tx) => {
        await sleep(300);
        return tx;
      },
      signAllTransactions: async (txs) => {
        await sleep(300);
        return txs;
      },
      signMessage: async (_msg) => {
        await sleep(300);
        return { signature: new Uint8Array(64) };
      },
    };

    const w = window as unknown as Record<string, unknown>;
    w.solana = mock;
    w.phantom = { solana: mock };

    // Heuristic: if SolShield extension patched the function, it'll have re-defined the
    // method. We can't reliably detect because the proxy preserves .toString(), but we
    // can check after a short delay whether the function reference changed.
    const original = mock.signMessage;
    setTimeout(() => {
      const current = (w.solana as MockWallet | undefined)?.signMessage;
      // If extension is loaded, current !== original (it's a proxy).
      setHookDetected(current && current !== original ? 'yes' : 'no');
    }, 1500);
  }, []);

  const append = (entry: Omit<LogEntry, 'ts'>) =>
    setLog((prev) => [{ ts: Date.now(), ...entry }, ...prev].slice(0, 12));

  const callSignMessage = async (text: string, label: string) => {
    if (busy) return;
    setBusy(true);
    append({ kind: 'info', text: `→ window.solana.signMessage("${label}")` });
    try {
      const bytes = new TextEncoder().encode(text);
      const w = window as unknown as { solana: MockWallet };
      await w.solana.signMessage(bytes);
      append({ kind: 'allow', text: `✓ wallet returned a signature (you allowed it)` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      append({ kind: msg.toLowerCase().includes('reject') ? 'reject' : 'error', text: `✗ ${msg}` });
    } finally {
      setBusy(false);
    }
  };

  const callSignTransaction = async () => {
    if (busy) return;
    setBusy(true);
    append({ kind: 'info', text: `→ window.solana.signTransaction(<demo bytes>)` });
    try {
      // Demo "VersionedTransaction-like" object with a serialize() that returns a junk
      // base64 payload. The API will likely fail to decode it (returns 400) which the
      // extension handles via fail-open. Useful to demonstrate the wrapping itself.
      const fakeTx = {
        serialize: () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      };
      const w = window as unknown as { solana: MockWallet };
      await w.solana.signTransaction(fakeTx);
      append({ kind: 'allow', text: `✓ wallet returned signed tx (extension fail-open or allowed)` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      append({ kind: msg.toLowerCase().includes('reject') ? 'reject' : 'error', text: `✗ ${msg}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg text-fg font-mono">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        <h1 className="text-2xl sm:text-3xl font-bold text-neon-green mb-2">
          // test the SolShield extension
        </h1>
        <p className="text-mute text-sm mb-6">
          this page mounts a fake <code className="text-neon-cyan">window.solana</code>{' '}
          wallet provider. if the SolShield extension is installed and active, it will
          intercept signing calls and show the warning overlay — same as on a real dapp.
        </p>

        <ExtensionStatus state={hookDetected} />

        <Section title="// step 1 — load the extension">
          <ol className="space-y-2 text-sm leading-relaxed">
            <li className="flex gap-2">
              <span className="text-neon-green font-bold w-5 shrink-0">1.</span>
              <span>
                clone the repo and run{' '}
                <Code>pnpm -F @solshield/extension build</Code> (or use the prebuilt
                <Code>build/chrome-mv3-prod/</Code> folder)
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-neon-green font-bold w-5 shrink-0">2.</span>
              <span>
                open <Code>chrome://extensions</Code>, enable{' '}
                <span className="text-neon-amber">Developer mode</span> (top right)
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-neon-green font-bold w-5 shrink-0">3.</span>
              <span>
                click <Code>Load unpacked</Code> and select{' '}
                <Code>apps/extension/build/chrome-mv3-prod/</Code>
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-neon-green font-bold w-5 shrink-0">4.</span>
              <span>
                refresh this page — the status above should flip to{' '}
                <span className="text-neon-green font-bold">DETECTED</span>
              </span>
            </li>
          </ol>
        </Section>

        <Section title="// step 2 — trigger a sign request">
          <p className="text-sm text-mute mb-4">
            click any button. the fake wallet calls{' '}
            <Code>signMessage</Code> / <Code>signTransaction</Code>. with the extension
            installed, you&apos;ll see the SolShield overlay and can choose{' '}
            <span className="text-neon-green">REJECT</span> or{' '}
            <span className="text-neon-red">PROCEED</span>.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            <TestButton
              tone="red"
              onClick={() => callSignMessage(SIWS_SPOOF, 'spoofed sign-in')}
              disabled={busy}
              label="Sign in (spoofed jup.ag)"
              hint="critical · domain mismatch"
            />
            <TestButton
              tone="amber"
              onClick={() => callSignMessage(PERMIT_LIKELY, 'off-chain permit')}
              disabled={busy}
              label="Authorize 1M USDC (permit)"
              hint="high · off-chain approval"
            />
            <TestButton
              tone="green"
              onClick={() => callSignMessage(SIWS_LEGIT, 'legit sign-in')}
              disabled={busy}
              label="Sign in (legit jup.ag)"
              hint="safe · should pass through"
            />
            <TestButton
              tone="cyan"
              onClick={callSignTransaction}
              disabled={busy}
              label="Sign a transaction"
              hint="demo bytes · just exercises the hook"
            />
          </div>
        </Section>

        <Section title="// activity log">
          <div className="border border-neon-green/15 bg-bg/40 p-3 text-xs space-y-1.5 max-h-64 overflow-y-auto font-mono">
            {log.length === 0 ? (
              <p className="text-dim">no calls yet — click a button above.</p>
            ) : (
              log.map((entry) => (
                <div key={entry.ts} className="flex gap-2">
                  <span className="text-dim shrink-0">
                    {new Date(entry.ts).toISOString().slice(11, 19)}
                  </span>
                  <LogLine entry={entry} />
                </div>
              ))
            )}
          </div>
        </Section>

        <Section title="// step 3 — test the domain blocker">
          <p className="text-sm text-mute mb-3">
            the extension also blocks known phishing domains{' '}
            <span className="text-neon-amber">before</span> the page loads, with no
            wallet interaction needed. open this URL in a new tab while the extension is
            loaded:
          </p>
          <Code block>https://jupitor-claim.io/</Code>
          <p className="text-dim text-xs mt-2">
            (this is a real example from the embedded blocklist — chrome will navigate,
            then SolShield&apos;s domain-guard injects a full-page red warning before any
            content renders)
          </p>
        </Section>

        <Section title="// what to look for">
          <ul className="text-sm space-y-2">
            <li className="flex gap-2">
              <span className="text-neon-green shrink-0">●</span>
              <span>
                <strong>Spoofed sign-in</strong> → red overlay, score 90+, &quot;message
                claims a different site&quot;
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-neon-amber shrink-0">●</span>
              <span>
                <strong>Permit</strong> → amber-ish, score 55+, &quot;off-chain token
                approval&quot;
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-neon-green shrink-0">●</span>
              <span>
                <strong>Legit sign-in</strong> → safe pass-through, tiny green badge top
                right (or no overlay)
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-neon-cyan shrink-0">●</span>
              <span>
                <strong>Demo tx</strong> → API likely 400s on junk bytes, extension
                fails open with a console warning. The hook itself is exercised.
              </span>
            </li>
          </ul>
        </Section>
      </main>

      <Footer />
    </div>
  );
}

function ExtensionStatus({ state }: { state: 'unknown' | 'yes' | 'no' }) {
  if (state === 'unknown') {
    return (
      <div className="border border-neon-cyan/30 bg-neon-cyan/5 px-4 py-3 mb-6 text-sm">
        <span className="text-neon-cyan">●</span> detecting extension…
      </div>
    );
  }
  if (state === 'yes') {
    return (
      <div className="border-2 border-neon-green/50 bg-neon-green/10 px-4 py-3 mb-6 text-sm">
        <span className="text-neon-green font-bold">✓ EXTENSION DETECTED</span> —{' '}
        <span style={{ color: CLAUDE_AMBER }}>✦</span> claude AI analyzing every signing
        request.
      </div>
    );
  }
  return (
    <div className="border-2 border-neon-amber/50 bg-neon-amber/10 px-4 py-3 mb-6 text-sm">
      <span className="text-neon-amber font-bold">⚠ EXTENSION NOT DETECTED</span> — sign
      requests will pass through unchecked. Follow step 1 below to install.
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border border-neon-green/15 bg-panel/20 px-4 sm:px-5 py-4">
      <h2 className="text-neon-cyan text-[10px] tracking-[0.3em] uppercase font-bold mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function TestButton({
  tone,
  onClick,
  disabled,
  label,
  hint,
}: {
  tone: 'red' | 'amber' | 'green' | 'cyan';
  onClick: () => void;
  disabled: boolean;
  label: string;
  hint: string;
}) {
  const colors = {
    red: 'border-neon-red/40 text-neon-red hover:bg-neon-red/10',
    amber: 'border-neon-amber/40 text-neon-amber hover:bg-neon-amber/10',
    green: 'border-neon-green/40 text-neon-green hover:bg-neon-green/10',
    cyan: 'border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left px-3 py-3 border-2 ${colors} transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      <div className="text-xs sm:text-sm tracking-[0.1em] font-bold uppercase">
        [ {label} ]
      </div>
      <div className="text-[10px] text-mute mt-1 normal-case tracking-normal">{hint}</div>
    </button>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const cls = {
    info: 'text-neon-cyan',
    reject: 'text-neon-green',
    allow: 'text-neon-amber',
    error: 'text-neon-red',
  }[entry.kind];
  return <span className={cls}>{entry.text}</span>;
}

function Code({ children, block }: { children: React.ReactNode; block?: boolean }) {
  if (block) {
    return (
      <pre className="bg-bg border border-neon-green/20 px-3 py-2 text-xs text-neon-cyan overflow-x-auto">
        {children}
      </pre>
    );
  }
  return (
    <code className="bg-bg/60 border border-neon-green/20 px-1.5 py-0.5 text-[12px] text-neon-cyan">
      {children}
    </code>
  );
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
          / TEST EXTENSION
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

function Footer() {
  return (
    <footer className="border-t border-neon-green/15 bg-bg/60 px-4 py-4 text-center text-[11px] text-dim mt-8">
      this is a testing harness — no real keys, no real tx submissions.
    </footer>
  );
}
