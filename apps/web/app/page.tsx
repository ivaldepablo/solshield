'use client';

import { useState } from 'react';
import { MatrixRain } from './components/matrix-rain';
import { BannerHeader } from './components/banner-header';
import { VerdictCard } from './components/verdict-card';
import type { VerdictView } from './components/terminal';

const CLAUDE_AMBER = '#ffab00';

type DetectedKind = 'tx' | 'domain' | 'msg' | null;

function detect(input: string): DetectedKind {
  const t = input.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return 'domain';
  if (/^[A-Za-z0-9+/=]{30,}$/.test(t) && !t.includes(' ')) return 'tx';
  if (!/\s/.test(t) && /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(t)) return 'domain';
  return 'msg';
}

/** Hit the right API for the detected input kind. Returns a normalized VerdictView. */
async function analyze(input: string): Promise<VerdictView> {
  const kind = detect(input);
  if (!kind) throw new Error('nothing to analyze');
  const startedAt = Date.now();

  if (kind === 'domain') {
    const res = await fetch('/api/check-domain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: input.trim() }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return {
      kind: 'domain',
      verdict: body.verdict,
      score: body.score,
      summary:
        body.verdict === 'safe'
          ? `${body.hostname || input.trim()} — no red flags`
          : body.reasons[0]?.message ?? 'phishing pattern detected',
      findings: (body.reasons ?? []).map((r: { severity: string; code: string; message: string }) => ({
        severity: r.severity as 'low' | 'medium' | 'high' | 'critical',
        ruleId: r.code,
        message: r.message,
      })),
      models: [],
      startedAt,
    };
  }

  if (kind === 'msg') {
    const res = await fetch('/api/inspect-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: input, encoding: 'utf8' }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return {
      kind: 'msg',
      verdict: body.verdict,
      score: body.score,
      summary: body.summary,
      findings: body.findings,
      elapsedMs: body.elapsedMs,
      models: body.verdict === 'safe' ? ['haiku 4.5'] : ['haiku 4.5', 'opus 4.7'],
      startedAt,
    };
  }

  // tx
  const res = await fetch('/api/inspect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tx: input.trim(), encoding: 'base64' }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return {
    kind: 'tx',
    verdict: body.verdict,
    score: body.score,
    summary: body.summary,
    findings: body.findings,
    elapsedMs: body.elapsedMs,
    models: body.verdict === 'safe' ? ['haiku 4.5'] : ['haiku 4.5', 'opus 4.7'],
    startedAt,
  };
}

export default function Home() {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<VerdictView | null>(null);

  const detected = detect(value);

  const submit = async (overrideValue?: string) => {
    const input = (overrideValue ?? value).trim();
    if (!input) return;
    setLoading(true);
    setError(null);
    setVerdict(null);
    try {
      const result = await analyze(input);
      setVerdict(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const tryExample = (url: string) => {
    setValue(url);
    void submit(url);
  };

  return (
    <>
      <MatrixRain opacity={0.08} />
      <div className="scanline" aria-hidden />

      <div className="relative z-10 flex flex-col min-h-screen">
        <TopBar />

        <main className="flex-1 flex flex-col items-center px-4 py-6 sm:py-10">
          <BannerHeader />

          <div className="w-full max-w-xl mt-6 sm:mt-10 text-center">
            <h1 className="text-xl sm:text-2xl text-fg font-mono leading-snug">
              got a <span className="text-neon-red font-bold">sketchy crypto link?</span>
              <br />
              paste it here to see if it&apos;s a scam.
            </h1>
            <p className="text-mute mt-3 text-sm font-mono">
              works with dapp URLs · transactions · sign-in messages
            </p>
          </div>

          <div className="w-full max-w-xl mt-6">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
                placeholder="paste a url, tx or sign-in message…"
                spellCheck={false}
                autoComplete="off"
                disabled={loading}
                className="flex-1 min-w-0 bg-bg/80 border-2 border-neon-green/40 px-4 py-3 text-fg font-mono text-sm sm:text-base focus:border-neon-green focus:outline-none placeholder:text-dim transition-colors disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!detected || loading}
                className="shrink-0 px-6 py-3 border-2 border-neon-green text-neon-green font-bold tracking-[0.2em] uppercase text-sm bg-neon-green/10 hover:bg-neon-green/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {loading ? 'checking…' : 'check →'}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-mono justify-center">
              <span className="text-dim uppercase tracking-wider">try:</span>
              <ExampleChip onClick={() => tryExample('jupitor.ag')} tone="red">
                jupitor.ag
              </ExampleChip>
              <ExampleChip onClick={() => tryExample('phantom-login.com')} tone="red">
                phantom-login.com
              </ExampleChip>
              <ExampleChip onClick={() => tryExample('xn--phntm-rsa.app')} tone="amber">
                xn--phntm-rsa.app
              </ExampleChip>
              <ExampleChip onClick={() => tryExample('jup.ag')} tone="green">
                jup.ag
              </ExampleChip>
            </div>

            {detected && value.trim() && !loading && (
              <p className="mt-2 text-center text-[10px] text-dim font-mono uppercase tracking-wider">
                detected: <span className="text-neon-amber">{detected === 'tx' ? 'transaction' : detected === 'domain' ? 'dapp url' : 'signable message'}</span>
              </p>
            )}
          </div>

          <div className="w-full flex justify-center mt-8">
            {loading && <LoadingStrip />}
            {error && (
              <div className="w-full max-w-xl border-2 border-neon-red/50 bg-neon-red/5 p-4 font-mono text-neon-red text-sm">
                ✗ error: {error}
              </div>
            )}
            {verdict && <VerdictCard verdict={verdict} />}
            {!loading && !error && !verdict && <HowItWorks />}
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}

function TopBar() {
  return (
    <nav className="flex items-center justify-between px-4 sm:px-8 py-2.5 border-b border-neon-green/20 bg-bg/85 backdrop-blur-md font-mono">
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 border border-neon-green flex items-center justify-center text-neon-green text-xs font-bold">
          ∆
        </div>
        <span className="text-sm tracking-[0.25em] text-neon-green font-bold">SOLSHIELD</span>
      </div>
      <div className="flex items-center gap-3 sm:gap-4 text-[11px] tracking-[0.2em] uppercase">
        <a
          href="/demo"
          className="text-neon-red hover:text-neon-red/80 transition-colors font-bold animate-pulse-glow border border-neon-red/50 px-2 py-0.5"
          title="watch the extension catch a fake airdrop drainer"
        >
          [ ▶ live demo ]
        </a>
        <a
          href="/lab"
          className="text-neon-cyan/70 hover:text-neon-cyan transition-colors hidden sm:inline"
          title="advanced terminal mode for devs"
        >
          [ /lab ]
        </a>
        <a
          href="https://github.com/0xnullpavel/solshield"
          className="text-mute hover:text-neon-cyan transition-colors hidden md:inline"
          target="_blank"
          rel="noopener noreferrer"
        >
          [ github ]
        </a>
        <span className="hidden lg:inline-flex items-center gap-1.5 text-neon-green">
          <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
          ONLINE
        </span>
      </div>
    </nav>
  );
}

function ExampleChip({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone: 'red' | 'amber' | 'green';
}) {
  const cls = {
    red: 'border-neon-red/40 text-neon-red hover:bg-neon-red/15',
    amber: 'border-neon-amber/40 text-neon-amber hover:bg-neon-amber/15',
    green: 'border-neon-green/40 text-neon-green hover:bg-neon-green/15',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 border transition-colors ${cls}`}
    >
      {children}
    </button>
  );
}

function LoadingStrip() {
  return (
    <div className="w-full max-w-xl border-2 border-neon-cyan/40 bg-bg/40 p-4 font-mono text-neon-cyan text-sm">
      <div className="flex items-center gap-3">
        <span className="inline-block w-2 h-2 bg-neon-cyan rounded-full animate-pulse" />
        <span>analyzing with claude AI…</span>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="w-full max-w-xl border border-neon-green/15 bg-bg/40 p-5 sm:p-6 font-mono text-sm">
      <p className="text-neon-cyan text-[10px] tracking-[0.25em] uppercase font-bold mb-3">
        // how this works
      </p>
      <ol className="space-y-2 text-fg">
        <li className="flex gap-3">
          <span className="text-neon-green font-bold shrink-0">1.</span>
          <span>
            paste a <span className="text-neon-cyan">url</span>,{' '}
            <span className="text-neon-cyan">transaction</span>, or{' '}
            <span className="text-neon-cyan">sign-in message</span> above
          </span>
        </li>
        <li className="flex gap-3">
          <span className="text-neon-amber font-bold shrink-0">2.</span>
          <span>
            <span style={{ color: CLAUDE_AMBER }}>✦</span>{' '}
            <span className="text-neon-amber font-bold">claude AI</span> analyzes it in ~200ms
          </span>
        </li>
        <li className="flex gap-3">
          <span className="text-neon-green font-bold shrink-0">3.</span>
          <span>
            get a verdict: <span className="text-neon-green font-bold">safe</span>,{' '}
            <span className="text-neon-amber font-bold">suspicious</span>, or{' '}
            <span className="text-neon-red font-bold">don&apos;t sign</span> — with reasons you can understand
          </span>
        </li>
      </ol>

      <p className="text-dim mt-4 pt-4 border-t border-dim/20 text-[11px]">
        solshield NEVER connects to your wallet. you paste the data yourself — we just read it and tell you if it&apos;s sketchy.
      </p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-neon-green/15 bg-bg/60 backdrop-blur-sm px-4 py-4 text-center font-mono text-[11px] text-dim">
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        <a href="/privacy" className="hover:text-neon-cyan transition-colors">
          /privacy
        </a>
        <span>·</span>
        <a href="/lab" className="hover:text-neon-cyan transition-colors">
          /lab — advanced terminal
        </a>
        <span>·</span>
        <a
          href="https://github.com/0xnullpavel/solshield"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-neon-cyan transition-colors"
        >
          github
        </a>
        <span>·</span>
        <span>
          <span style={{ color: CLAUDE_AMBER }}>✦</span> powered by{' '}
          <span className="text-neon-amber/80">claude</span> +{' '}
          <a
            href="https://github.com/0xnullpavel"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neon-amber/80 hover:text-neon-amber transition-colors"
          >
            0xnullpavel
          </a>
        </span>
      </div>
    </footer>
  );
}
