'use client';

import { useState } from 'react';
import type { ThreatReport } from '@solshield/core';

type Status = 'idle' | 'pending' | 'done' | 'error';

const VERDICT_COLOR: Record<ThreatReport['verdict'], string> = {
  safe: 'text-emerald-400 border-emerald-500',
  suspicious: 'text-amber-400 border-amber-500',
  danger: 'text-accent border-accent',
};

export default function Home() {
  const [tx, setTx] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [report, setReport] = useState<ThreatReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function inspect() {
    setStatus('pending');
    setError(null);
    setReport(null);
    try {
      const res = await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tx: tx.trim(), encoding: 'base64' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'request failed');
        setStatus('error');
        return;
      }
      setReport(body as ThreatReport);
      setStatus('done');
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  }

  return (
    <main className="min-h-screen px-6 py-16 max-w-3xl mx-auto">
      <header className="mb-12">
        <h1 className="text-3xl mb-3">
          <span className="text-accent">sol</span>shield
        </h1>
        <p className="text-fg">Pre-signature transaction analysis for Solana.</p>
        <p className="text-mute text-sm mt-1">
          Paste a base64-encoded unsigned transaction. We decode, run static rules, and return a verdict.
        </p>
      </header>

      <section className="mb-6">
        <label className="block text-sm text-mute mb-2" htmlFor="tx">
          serialized transaction (base64)
        </label>
        <textarea
          id="tx"
          value={tx}
          onChange={(e) => setTx(e.target.value)}
          placeholder="AQABA..."
          rows={8}
          className="w-full bg-black/40 border border-white/10 rounded p-3 text-sm font-mono focus:outline-none focus:border-accent"
        />
        <button
          onClick={inspect}
          disabled={!tx.trim() || status === 'pending'}
          className="mt-3 px-5 py-2 bg-accent text-black font-medium rounded disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90"
        >
          {status === 'pending' ? 'inspecting…' : 'inspect'}
        </button>
      </section>

      {error && (
        <div className="border border-accent/60 text-accent p-4 rounded text-sm">{error}</div>
      )}

      {report && (
        <section className="border border-white/10 rounded">
          <div className={`p-4 border-b border-white/10 ${VERDICT_COLOR[report.verdict]}`}>
            <div className="text-xs uppercase tracking-wider text-mute mb-1">verdict</div>
            <div className="text-2xl font-bold">{report.verdict}</div>
            <div className="text-xs text-mute mt-1">score {report.score}/100</div>
          </div>
          <div className="p-4 border-b border-white/10 text-sm">{report.summary}</div>
          {report.findings.length > 0 && (
            <ul className="divide-y divide-white/5">
              {report.findings.map((f, i) => (
                <li key={i} className="p-4 text-sm">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="font-mono text-xs text-mute">{f.ruleId}</span>
                    <span className="text-xs uppercase tracking-wider">{f.severity}</span>
                  </div>
                  <div>{f.message}</div>
                </li>
              ))}
            </ul>
          )}
          {typeof report.elapsedMs === 'number' && (
            <div className="p-3 text-xs text-mute text-right">
              analyzed in {report.elapsedMs}ms
            </div>
          )}
        </section>
      )}

      <footer className="mt-24 text-xs text-mute">
        open source · apache 2.0 ·{' '}
        <a
          href="https://github.com/0xnullpavel/solshield"
          className="underline hover:text-accent"
          target="_blank"
          rel="noreferrer"
        >
          github
        </a>
      </footer>
    </main>
  );
}
