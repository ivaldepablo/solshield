'use client';

import { useEffect, useRef, useState } from 'react';
import type { Finding, ThreatReport } from '@solshield/core';
import { AsciiLogo } from './components/ascii-logo';
import { MatrixRain } from './components/matrix-rain';

type Status = 'idle' | 'scanning' | 'done' | 'error';

interface TerminalLine {
  color: 'green' | 'cyan' | 'amber' | 'red' | 'mute' | 'white';
  text: string;
  prompt?: boolean;
}

const LINE_COLOR: Record<TerminalLine['color'], string> = {
  green: 'text-neon-green',
  cyan: 'text-neon-cyan',
  amber: 'text-neon-amber',
  red: 'text-neon-red',
  mute: 'text-mute',
  white: 'text-fg',
};

const SEVERITY_COLOR: Record<Finding['severity'], TerminalLine['color']> = {
  low: 'cyan',
  medium: 'amber',
  high: 'red',
  critical: 'red',
};

const VERDICT_STYLES: Record<ThreatReport['verdict'], { text: string; border: string; label: string }> = {
  safe: { text: 'text-neon-green', border: 'border-neon-green', label: 'SAFE · PROCEED' },
  suspicious: { text: 'text-neon-amber', border: 'border-neon-amber', label: 'SUSPICIOUS · REVIEW' },
  danger: { text: 'text-neon-red', border: 'border-neon-red', label: 'DANGER · DO NOT SIGN' },
};

const BOOT_SEQUENCE: TerminalLine[] = [
  { color: 'mute', text: '$ ./solshield --version', prompt: true },
  { color: 'green', text: 'solshield 0.1.0-alpha · pre-signature transaction firewall' },
  { color: 'mute', text: '$ ./solshield rules --count', prompt: true },
  { color: 'white', text: '15 detection rules loaded · claude haiku 4.5 + opus 4.7 online' },
  { color: 'mute', text: '$ ./solshield scan --help', prompt: true },
  { color: 'cyan', text: 'paste a base64-encoded unsigned solana transaction below ↓' },
];

const MOCK_FEED: Array<{ time: string; tag: string; color: TerminalLine['color']; detail: string }> = [
  { time: '17:42:12', tag: 'ALERT', color: 'red', detail: 'unlimited-spl-approval → blocked at 7xKX...Jjng' },
  { time: '17:41:55', tag: 'BLOCK', color: 'red', detail: 'mass-token-drain → 3 transfers converging on DrxVn...9kP' },
  { time: '17:41:30', tag: 'WARN', color: 'amber', detail: 'mint-authority-transfer → new authority on 5tG...rn3' },
  { time: '17:41:02', tag: 'SAFE', color: 'green', detail: 'routine-swap → jupiter v6 passthrough OK' },
  { time: '17:40:38', tag: 'ALERT', color: 'red', detail: 'simulated-signer-drain → 4.2 SOL (100% of balance)' },
  { time: '17:40:15', tag: 'BLOCK', color: 'red', detail: 'close-token-account-to-attacker → rent redirected' },
  { time: '17:39:54', tag: 'WARN', color: 'amber', detail: 'upgrade-authority-set → new program maintainer' },
  { time: '17:39:28', tag: 'SAFE', color: 'green', detail: 'stake-delegation → validator 8xj...QKm OK' },
];

export default function Home() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [report, setReport] = useState<ThreatReport | null>(null);
  const [terminal, setTerminal] = useState<TerminalLine[]>([]);
  const [displayedScore, setDisplayedScore] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bootLines, setBootLines] = useState<TerminalLine[]>([]);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const line of BOOT_SEQUENCE) {
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 220));
        if (cancelled) return;
        setBootLines((prev) => [...prev, line]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!report) return;
    const target = report.score;
    const start = performance.now();
    const duration = 700;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      setDisplayedScore(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [report]);

  async function scan() {
    if (!input.trim() || status === 'scanning') return;
    setStatus('scanning');
    setError(null);
    setReport(null);
    setDisplayedScore(0);
    setTerminal([]);

    const tail = (line: TerminalLine) => setTerminal((prev) => [...prev, line]);
    const push = async (lines: TerminalLine[], delay = 180) => {
      for (const l of lines) {
        tail(l);
        await new Promise((r) => setTimeout(r, delay));
      }
    };

    await push([
      { color: 'mute', prompt: true, text: `$ ./solshield scan --tx ${preview(input)}` },
      { color: 'green', text: '[INIT] Decoding wire format...' },
      { color: 'cyan', text: '[RULES] 15 detectors loaded, running static pass...' },
    ]);

    try {
      const res = await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tx: input.trim(), encoding: 'base64' }),
      });
      const body = (await res.json()) as ThreatReport & { error?: string };
      if (!res.ok || body.error) {
        tail({ color: 'red', text: `[ERROR] ${body.error ?? `HTTP ${res.status}`}` });
        setError(body.error ?? 'request failed');
        setStatus('error');
        return;
      }

      for (const f of body.findings) {
        const sev = f.severity.toUpperCase();
        const tag = sev === 'CRITICAL' || sev === 'HIGH' ? 'ALERT' : sev === 'MEDIUM' ? 'WARN' : 'INFO';
        tail({
          color: SEVERITY_COLOR[f.severity],
          text: `[${tag}] ${f.ruleId} — ${f.message}`,
        });
        await new Promise((r) => setTimeout(r, 180));
      }

      const verdictMap: Record<ThreatReport['verdict'], TerminalLine> = {
        safe: { color: 'green', text: '[DONE] no threats detected. routine transaction.' },
        suspicious: { color: 'amber', text: '[DONE] review findings before signing.' },
        danger: { color: 'red', text: '[BLOCK] ⚠ drainer pattern detected. do NOT sign.' },
      };
      tail(verdictMap[body.verdict]);
      setReport(body);
      setStatus('done');
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } catch (err) {
      tail({ color: 'red', text: `[ERROR] ${(err as Error).message}` });
      setError((err as Error).message);
      setStatus('error');
    }
  }

  return (
    <>
      <MatrixRain opacity={0.14} />
      <div className="scanline" aria-hidden />

      <div className="relative z-10">
        <TopBar />

        {/* HERO */}
        <section className="px-4 sm:px-8 pt-8 pb-12">
          <div className="max-w-6xl mx-auto">
            <AsciiLogo />

            <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-mute tracking-[0.15em]">
              <span className="sticker">v0.1.0-alpha</span>
              <span className="sticker sticker-red">here be dragons</span>
              <span className="sticker sticker-cyan">mainnet-pilled</span>
              <span className="sticker sticker-amber">no token ever</span>
              <span className="sticker">apache 2.0</span>
            </div>

            {/* boot sequence */}
            <div className="mt-8 border border-neon-green/20 bg-panel/80 backdrop-blur-sm p-5 text-xs sm:text-sm leading-relaxed max-w-3xl">
              {bootLines.map((line, i) => (
                <TermLine key={i} line={line} />
              ))}
              {bootLines.length >= BOOT_SEQUENCE.length && (
                <div className="text-neon-green cursor-blink mt-1">$</div>
              )}
            </div>
          </div>
        </section>

        {/* SCANNER */}
        <section className="px-4 sm:px-8 pb-16">
          <div className="max-w-3xl mx-auto">
            <div className="text-[10px] text-mute tracking-[0.2em] mb-2">// PASTE TX BELOW</div>
            <div
              className={`relative border bg-panel/90 ${
                status === 'scanning' ? 'animate-pulse-border' : 'border-neon-cyan/30'
              }`}
            >
              <div className="absolute -top-[1px] left-[-1px] w-2 h-2 border-t-2 border-l-2 border-neon-cyan" />
              <div className="absolute -top-[1px] right-[-1px] w-2 h-2 border-t-2 border-r-2 border-neon-cyan" />
              <div className="absolute -bottom-[1px] left-[-1px] w-2 h-2 border-b-2 border-l-2 border-neon-cyan" />
              <div className="absolute -bottom-[1px] right-[-1px] w-2 h-2 border-b-2 border-r-2 border-neon-cyan" />
              <div className="flex items-center gap-2 px-4 pt-3 text-[10px] text-dim tracking-[0.15em]">
                <span className="text-neon-green">●</span>
                <span>solshield@mainnet · /scan</span>
              </div>
              <div className="flex items-start gap-2 px-4 pb-4 pt-2">
                <span className="text-neon-green pt-2">{'>'}</span>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) scan();
                  }}
                  placeholder="AQABAv..."
                  rows={3}
                  className="w-full bg-transparent border-none text-neon-cyan text-sm resize-none outline-none placeholder:text-dim/60"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={scan}
                disabled={!input.trim() || status === 'scanning'}
                className="px-5 py-2.5 bg-neon-green/10 border border-neon-green text-neon-green text-xs font-bold tracking-[0.2em] uppercase hover:bg-neon-green hover:text-bg transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-neon-green/10 disabled:hover:text-neon-green"
              >
                {status === 'scanning' ? (
                  <span className="cursor-blink">./exec</span>
                ) : (
                  '$ ./scan --run'
                )}
              </button>
              <span className="text-[10px] text-dim tracking-widest">⌘+↵ to execute</span>
            </div>
          </div>
        </section>

        {/* RESULTS */}
        {(terminal.length > 0 || report) && (
          <section ref={resultsRef} className="px-4 sm:px-8 pb-16">
            <div className="max-w-3xl mx-auto space-y-4">
              {report && (
                <div
                  className={`border-2 ${VERDICT_STYLES[report.verdict].border} bg-panel/90 p-5 animate-slide-up`}
                >
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="text-[10px] tracking-[0.3em] text-dim">// VERDICT</span>
                    <span className={`text-[10px] ${VERDICT_STYLES[report.verdict].text} font-bold`}>
                      SCORE {displayedScore} / 100
                    </span>
                  </div>
                  <div
                    className={`text-2xl sm:text-3xl font-bold tracking-[0.15em] ${VERDICT_STYLES[report.verdict].text}`}
                  >
                    {VERDICT_STYLES[report.verdict].label}
                  </div>
                  <p className="text-fg text-sm mt-3 leading-relaxed">{report.summary}</p>
                  {typeof report.elapsedMs === 'number' && (
                    <div className="text-[10px] text-dim mt-3">
                      analyzed in {report.elapsedMs}ms · {report.findings.length} finding
                      {report.findings.length === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
              )}

              <div className="border border-neon-cyan/20 bg-panel/80 backdrop-blur-sm">
                <div className="flex items-center justify-between px-4 py-2 border-b border-neon-cyan/10">
                  <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] text-neon-cyan">
                    <span>●</span>
                    <span>terminal</span>
                  </div>
                  <span className="text-[10px] text-dim">solshield@mainnet</span>
                </div>
                <div className="p-4 text-xs sm:text-sm leading-relaxed max-h-96 overflow-y-auto">
                  {terminal.map((line, i) => (
                    <TermLine key={i} line={line} />
                  ))}
                  {status === 'scanning' && <div className="text-neon-green cursor-blink">&nbsp;</div>}
                </div>
              </div>

              {report && report.findings.length > 0 && (
                <div className="border border-neon-red/30 bg-panel/80 p-4 animate-slide-up">
                  <div className="text-[10px] tracking-[0.2em] text-neon-red mb-3">
                    // THREATS · {report.findings.length}
                  </div>
                  <div className="space-y-2">
                    {report.findings.map((f, i) => (
                      <FindingLine key={i} finding={f} />
                    ))}
                  </div>
                </div>
              )}

              {error && status === 'error' && (
                <div className="border-2 border-neon-red text-neon-red p-4 text-sm animate-fade-in">
                  [ERROR] {error}
                </div>
              )}
            </div>
          </section>
        )}

        <LiveFeed />
        <InstallBlock />
        <Manifesto />
        <Footer />
      </div>
    </>
  );
}

function TopBar() {
  return (
    <nav className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-neon-green/15">
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 border border-neon-green flex items-center justify-center text-neon-green text-xs">
          ∆
        </div>
        <span className="text-xs tracking-[0.25em] text-neon-green">SOLSHIELD.DEV</span>
        <span className="text-[10px] tracking-[0.15em] text-dim hidden sm:inline">v0.1.0-alpha</span>
      </div>
      <div className="flex items-center gap-5 text-[11px] tracking-[0.2em]">
        <span className="text-neon-green">● ONLINE</span>
        <a
          href="https://github.com/0xnullpavel/solshield"
          className="text-mute hover:text-neon-cyan transition-colors"
          target="_blank"
          rel="noreferrer"
        >
          GITHUB
        </a>
        <a
          href="#feed"
          className="text-mute hover:text-neon-cyan transition-colors hidden sm:inline"
        >
          FEED
        </a>
      </div>
    </nav>
  );
}

function TermLine({ line }: { line: TerminalLine }) {
  return (
    <div className={`${LINE_COLOR[line.color]} animate-fade-in`}>
      {line.prompt ? line.text : <span className="text-mute">├─ </span>}
      {!line.prompt && line.text}
    </div>
  );
}

function FindingLine({ finding }: { finding: Finding }) {
  const c = LINE_COLOR[SEVERITY_COLOR[finding.severity]];
  return (
    <div className="flex items-start gap-3 text-xs sm:text-sm">
      <span className={`${c} font-bold tracking-widest shrink-0 w-20`}>
        {finding.severity.toUpperCase()}
      </span>
      <span className={`${c} shrink-0 w-auto font-mono opacity-80`}>{finding.ruleId}</span>
      <span className="text-mute flex-1">─ {finding.message}</span>
    </div>
  );
}

function LiveFeed() {
  const [feed, setFeed] = useState(MOCK_FEED);
  useEffect(() => {
    const iv = setInterval(() => {
      setFeed((prev) => {
        const next = MOCK_FEED[Math.floor(Math.random() * MOCK_FEED.length)]!;
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        return [{ ...next, time: `${hh}:${mm}:${ss}` }, ...prev.slice(0, 7)];
      });
    }, 3500);
    return () => clearInterval(iv);
  }, []);

  return (
    <section id="feed" className="px-4 sm:px-8 pb-16">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs tracking-[0.3em] text-neon-green">// LIVE FEED</h2>
          <span className="text-[10px] text-dim tracking-widest">mainnet · last 30s</span>
        </div>
        <div className="border border-neon-green/20 bg-panel/80 backdrop-blur-sm p-4 text-[11px] sm:text-xs leading-loose font-mono">
          {feed.map((entry, i) => (
            <div
              key={`${entry.time}-${i}`}
              className="flex gap-3 items-baseline"
              style={{ animation: `feed-slide 0.4s ease-out both` }}
            >
              <span className="text-dim shrink-0">[{entry.time}]</span>
              <span className={`${LINE_COLOR[entry.color]} font-bold shrink-0 w-14`}>{entry.tag}</span>
              <span className="text-mute truncate">{entry.detail}</span>
            </div>
          ))}
        </div>
        <div className="text-[10px] text-dim mt-2 tracking-widest">
          ☝ mock data until persistence lands. real feed in alpha 0.2.
        </div>
      </div>
    </section>
  );
}

function InstallBlock() {
  const [copied, setCopied] = useState(false);
  const cmd = 'npm install @solshield/sdk';
  return (
    <section className="px-4 sm:px-8 pb-16">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-xs tracking-[0.3em] text-neon-green mb-3">// INSTALL</h2>
        <div className="border border-neon-cyan/25 bg-panel/90 p-4 flex items-center justify-between group">
          <div className="font-mono text-sm text-neon-cyan overflow-x-auto">
            <span className="text-mute">$ </span>
            {cmd}
          </div>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(cmd);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="text-[10px] tracking-[0.2em] text-mute hover:text-neon-green transition-colors shrink-0 ml-4"
          >
            {copied ? 'COPIED' : 'COPY'}
          </button>
        </div>
        <div className="text-[10px] text-dim mt-2 tracking-widest">
          ☝ not published yet. dropping with alpha 0.2.
        </div>
      </div>
    </section>
  );
}

function Manifesto() {
  return (
    <section className="px-4 sm:px-8 pb-16">
      <div className="max-w-3xl mx-auto border-l-2 border-neon-green/30 pl-6 text-fg text-sm leading-relaxed space-y-3">
        <p className="text-neon-green font-bold tracking-widest text-[10px]">// MANIFESTO</p>
        <p>
          wallet security on solana is thin. when a user clicks <span className="text-neon-amber">approve</span>, a signature grants the requested operation with almost no context.
        </p>
        <p>
          <span className="text-fg">blockaid</span> and <span className="text-fg">blowfish</span> solve part of this but they are closed source and pay-walled. if you want to know <em>why</em> a transaction was flagged, too bad.
        </p>
        <p>
          solshield is the open alternative. every rule, every heuristic, every model prompt is auditable in-tree. the day a new drainer lands on mainnet, anyone can ship a signature against it.
        </p>
        <p className="text-neon-green font-bold">no token. no VC. no acquisition ambitions. just code.</p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="px-4 sm:px-8 py-10 border-t border-neon-green/15">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 text-[10px] text-dim tracking-[0.2em]">
        <div className="flex flex-wrap gap-4">
          <span className="text-neon-green">◢ SOLSHIELD.DEV</span>
          <span>APACHE 2.0</span>
          <span>SELF-HOSTED · HETZNER · ASHBURN</span>
        </div>
        <div className="flex gap-4">
          <a
            href="https://github.com/0xnullpavel/solshield"
            className="hover:text-neon-cyan transition-colors"
            target="_blank"
            rel="noreferrer"
          >
            GITHUB
          </a>
          <a
            href="mailto:security@solshield.dev"
            className="hover:text-neon-red transition-colors"
          >
            SECURITY@SOLSHIELD.DEV
          </a>
        </div>
      </div>
    </footer>
  );
}

function preview(s: string): string {
  const t = s.trim();
  return t.length > 20 ? `${t.slice(0, 8)}...${t.slice(-4)}` : t;
}
