'use client';

import { useEffect, useRef, useState } from 'react';
import type { Finding, ThreatReport } from '@solshield/core';

type Status = 'idle' | 'scanning' | 'done' | 'error';

interface TerminalLine {
  color: 'green' | 'cyan' | 'amber' | 'red' | 'mute';
  text: string;
}

const LINE_COLOR: Record<TerminalLine['color'], string> = {
  green: 'text-neon-green',
  cyan: 'text-neon-cyan',
  amber: 'text-neon-amber',
  red: 'text-neon-red',
  mute: 'text-mute',
};

const SEVERITY_COLOR: Record<Finding['severity'], TerminalLine['color']> = {
  low: 'cyan',
  medium: 'amber',
  high: 'red',
  critical: 'red',
};

const VERDICT_STYLES: Record<
  ThreatReport['verdict'],
  { color: string; label: string; action: string }
> = {
  safe: { color: 'text-neon-green border-neon-green', label: 'SAFE', action: 'PROCEED' },
  suspicious: { color: 'text-neon-amber border-neon-amber', label: 'SUSPICIOUS', action: 'REVIEW' },
  danger: { color: 'text-neon-red border-neon-red', label: 'DANGER', action: 'BLOCK TX' },
};

export default function Home() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [report, setReport] = useState<ThreatReport | null>(null);
  const [terminal, setTerminal] = useState<TerminalLine[]>([]);
  const [displayedScore, setDisplayedScore] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

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

    await typeLines(
      [
        { color: 'green', text: `[INIT] Scanning transaction ${preview(input)}` },
        { color: 'cyan', text: '[DECODE] Parsing wire format...' },
        { color: 'cyan', text: '[RULES] Running static detection pass...' },
      ],
      tail,
      220,
    );

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
        tail({
          color: SEVERITY_COLOR[f.severity],
          text: `[${sev === 'CRITICAL' || sev === 'HIGH' ? 'ALERT' : 'WARN'}] ${f.ruleId} — ${f.message}`,
        });
        await wait(240);
      }

      const verdictLine: Record<ThreatReport['verdict'], TerminalLine> = {
        safe: { color: 'green', text: '[DONE] No threats detected. Transaction looks routine.' },
        suspicious: { color: 'amber', text: '[DONE] Transaction flagged — review before signing.' },
        danger: { color: 'red', text: '[BLOCK] Transaction blocked — DRAINER PATTERN DETECTED' },
      };
      tail(verdictLine[body.verdict]);
      setReport(body);
      setStatus('done');
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    } catch (err) {
      tail({ color: 'red', text: `[ERROR] ${(err as Error).message}` });
      setError((err as Error).message);
      setStatus('error');
    }
  }

  return (
    <>
      <div className="scanline" aria-hidden />

      <nav className="flex items-center justify-between px-6 py-4 border-b border-neon-cyan/10">
        <div className="flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 28 28" className="animate-flicker">
            <polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="none" stroke="#00ff41" strokeWidth="1.5" />
            <polygon points="14,7 21,11 21,19 14,23 7,19 7,11" fill="none" stroke="#00ff41" strokeWidth="0.8" opacity="0.5" />
            <circle cx="14" cy="14" r="3" fill="#00ff41" opacity="0.8" />
          </svg>
          <span className="text-lg font-bold tracking-[0.2em] text-neon-green text-glow-green">SOLSHIELD</span>
          <span className="text-[11px] text-dim tracking-[0.15em] ml-1">v0.1.0</span>
        </div>
        <div className="hidden sm:flex gap-6 text-xs tracking-[0.12em] text-mute">
          <span className="text-neon-green border-b border-neon-green pb-0.5">SCAN</span>
          <span className="hover:text-neon-cyan transition-colors cursor-default">DASHBOARD</span>
          <a href="https://github.com/0xnullpavel/solshield" target="_blank" rel="noreferrer" className="hover:text-neon-cyan transition-colors">
            SOURCE
          </a>
          <a href="https://github.com/0xnullpavel/solshield#readme" target="_blank" rel="noreferrer" className="hover:text-neon-cyan transition-colors">
            DOCS
          </a>
        </div>
      </nav>

      <header className="px-6 pt-12 pb-5 text-center animate-fade-in">
        <div className="text-[11px] tracking-[0.3em] text-neon-cyan mb-2 text-glow-cyan">
          SOLANA TRANSACTION FIREWALL
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-[0.15em] text-fg mb-2">
          SCAN BEFORE YOU SIGN
        </h1>
        <p className="text-sm text-dim max-w-lg mx-auto">
          Paste a serialized Solana transaction (base64). We decode, run 12 static rules, and escalate to Claude Haiku + Opus for ambiguous cases.
        </p>
      </header>

      <section className="px-6 pb-6 max-w-2xl mx-auto">
        <div
          className={`relative border bg-panel corner-brackets ${
            status === 'scanning' ? 'animate-pulse-border' : 'border-neon-cyan/20'
          }`}
        >
          <span className="c-br-bl" />
          <span className="c-br-br" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && scan()}
            placeholder="Paste transaction (base64)..."
            className="w-full bg-transparent border-none text-neon-cyan font-mono text-sm px-5 py-4 outline-none placeholder:text-dim"
          />
        </div>
        <button
          onClick={scan}
          disabled={!input.trim() || status === 'scanning'}
          className="group w-full mt-3 py-3 bg-transparent border border-neon-green text-neon-green font-mono text-[13px] tracking-[0.15em] font-bold uppercase transition-all hover:bg-neon-green/10 hover:animate-pulse-glow disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:animate-none"
        >
          {status === 'scanning' ? (
            <span className="cursor-blink">Scanning</span>
          ) : (
            'Initialize scan sequence'
          )}
        </button>
      </section>

      {(terminal.length > 0 || status === 'scanning') && (
        <section ref={resultsRef} className="px-6 pb-8 max-w-2xl mx-auto">
          {report && (
            <div className="grid grid-cols-3 gap-3 mb-5 animate-slide-up">
              <Stat label="RISK SCORE" value={String(displayedScore)} valueClass={verdictNumberColor(report.verdict)} />
              <Stat
                label="VERDICT"
                badge={VERDICT_STYLES[report.verdict].label}
                badgeClass={VERDICT_STYLES[report.verdict].color}
              />
              <Stat label="ACTION" value={VERDICT_STYLES[report.verdict].action} valueClass={verdictNumberColor(report.verdict)} />
            </div>
          )}

          <Panel titleClass="text-neon-cyan" title="TERMINAL OUTPUT">
            <div className="text-xs leading-loose">
              {terminal.map((line, i) => (
                <div key={i} className={`${LINE_COLOR[line.color]} animate-fade-in`}>
                  {line.text}
                </div>
              ))}
              {status === 'scanning' && <div className="text-neon-green cursor-blink">&nbsp;</div>}
            </div>
          </Panel>

          {report && report.findings.length > 0 && (
            <Panel titleClass="text-neon-red" title={`THREATS DETECTED (${report.findings.length})`} borderClass="border-neon-red/20">
              <div className="space-y-3">
                {report.findings.map((f, i) => (
                  <FindingRow key={i} finding={f} />
                ))}
              </div>
            </Panel>
          )}

          {report && (
            <Panel titleClass="text-neon-cyan" title="ANALYSIS SUMMARY">
              <p className="text-sm text-fg leading-relaxed">{report.summary}</p>
              {typeof report.elapsedMs === 'number' && (
                <p className="text-[11px] text-dim mt-3">
                  analyzed in {report.elapsedMs}ms · {report.findings.length} finding
                  {report.findings.length === 1 ? '' : 's'}
                </p>
              )}
            </Panel>
          )}

          {error && status === 'error' && (
            <div className="border border-neon-red/40 text-neon-red p-4 text-sm animate-fade-in">
              {error}
            </div>
          )}
        </section>
      )}

      <footer className="px-6 py-6 border-t border-neon-cyan/10 text-center">
        <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-[11px] text-dim tracking-[0.1em]">
          <span>12 RULES LOADED</span>
          <span className="text-neon-cyan/30">|</span>
          <span>HAIKU 4.5 + OPUS 4.7</span>
          <span className="text-neon-cyan/30">|</span>
          <span className="text-neon-green">OPEN SOURCE · APACHE 2.0</span>
        </div>
      </footer>
    </>
  );
}

function Stat({
  label,
  value,
  valueClass,
  badge,
  badgeClass,
}: {
  label: string;
  value?: string;
  valueClass?: string;
  badge?: string;
  badgeClass?: string;
}) {
  return (
    <div className="bg-card border border-neon-green/15 p-4 text-center">
      <div className="text-[11px] text-dim tracking-[0.15em] mb-1.5">{label}</div>
      {value && <div className={`text-3xl font-bold ${valueClass ?? 'text-fg'}`}>{value}</div>}
      {badge && (
        <div className={`text-sm font-bold tracking-[0.1em] border inline-block px-3 py-1 mt-1 ${badgeClass}`}>
          {badge}
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  titleClass,
  borderClass,
  children,
}: {
  title: string;
  titleClass: string;
  borderClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`bg-panel border p-4 mb-4 animate-slide-up ${borderClass ?? 'border-neon-cyan/10'}`}>
      <div className={`text-[11px] tracking-[0.15em] mb-3 pb-2 border-b border-white/5 ${titleClass}`}>
        {title}
      </div>
      {children}
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const styles = FINDING_STYLES[finding.severity];
  return (
    <div className={`p-3 border-l-2 ${styles.border}`} style={{ background: styles.bg }}>
      <div className="flex justify-between items-center mb-1">
        <span className={`text-xs font-bold ${styles.text}`}>
          {finding.ruleId.toUpperCase().replace(/-/g, ' ')}
        </span>
        <span className={`text-[11px] border px-2 py-0.5 ${styles.text} ${styles.border}`}>
          {finding.severity.toUpperCase()}
        </span>
      </div>
      <div className="text-xs text-mute">{finding.message}</div>
    </div>
  );
}

const FINDING_STYLES: Record<Finding['severity'], { border: string; text: string; bg: string }> = {
  critical: { border: 'border-neon-red', text: 'text-neon-red', bg: 'rgba(255, 0, 60, 0.05)' },
  high: { border: 'border-neon-red', text: 'text-neon-red', bg: 'rgba(255, 0, 60, 0.05)' },
  medium: { border: 'border-neon-amber', text: 'text-neon-amber', bg: 'rgba(255, 171, 0, 0.05)' },
  low: { border: 'border-neon-cyan', text: 'text-neon-cyan', bg: 'rgba(0, 229, 255, 0.04)' },
};

function verdictNumberColor(v: ThreatReport['verdict']): string {
  return v === 'safe' ? 'text-neon-green' : v === 'suspicious' ? 'text-neon-amber' : 'text-neon-red';
}

function preview(s: string): string {
  const trimmed = s.trim();
  return trimmed.length > 20 ? `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}` : trimmed;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function typeLines(
  lines: TerminalLine[],
  emit: (l: TerminalLine) => void,
  delay: number,
): Promise<void> {
  for (const line of lines) {
    emit(line);
    await wait(delay);
  }
}
