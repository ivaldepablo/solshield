'use client';

import { useEffect, useState } from 'react';
import type { VerdictView } from './terminal';

/**
 * Plain-language one-liner per detection rule. Shown in green under each
 * finding so a normie can grasp severity without learning the jargon.
 * Keys are rule IDs; missing keys fall back to nothing.
 */
const PLAIN_LANGUAGE: Record<string, string> = {
  // tx rules
  'unlimited-spl-approval': "they want permission to take ALL your tokens — not just one transfer.",
  'mint-authority-transfer': "they're taking control of who can create new tokens.",
  'mass-token-drain': "multiple transfers funneling into one wallet — looks like a drain.",
  'upgrade-authority-set': "they're taking control of the program — they could replace it later.",
  'hidden-sol-transfer': "moving SOL to someone else's wallet — not shown clearly in the UI.",
  'spl-account-owner-change': "rewriting who owns your token account — they become the owner.",
  'close-token-account-to-attacker': "closing your account and sending the rent SOL to them.",
  'token-freeze-abuse': "freezing your tokens so you can't move them.",
  'stake-authority-hijack': "stealing control of your staked SOL.",
  'memo-exfiltration': "memo contains data matching known scam signatures.",
  'compute-budget-anomaly': "compute config looks unusual — could mean hidden activity.",
  'multisig-cosigner-manipulation': "changing your multisig setup — full takeover possible.",
  'simulated-signer-drain': "simulation shows YOUR balance dropping over 90%.",
  'simulated-token-wipe': "simulation shows multiple tokens going to zero.",
  'simulation-failure': "tx fails simulation — could be anti-detection.",
  // message rules
  'empty-message-sign': "blank message — your signature could be replayed elsewhere.",
  'opaque-binary-sign': "signing binary data with no explanation — risky.",
  'url-in-message': "message contains a link — verify before clicking.",
  'rtl-override-attack': "message hides text using unicode tricks.",
  'spoofed-siws-domain': "message claims a different site than the one asking.",
  'permit-style-approval': "message looks like an off-chain token approval.",
  // domain rules
  blocklisted: "this domain is on our scam blocklist.",
  typosquat: "name looks like a 1–2 letter typo of a real dapp.",
  'suspicious-tld': "uses a free TLD popular with scammers.",
  'punycode-idn': "punycode hostname — could impersonate a real brand.",
  'phishing-keyword': "name combines a real brand with a scam keyword.",
  'suspicious-structure': "hostname shape is unusual for legit dapps.",
  'invalid-url': "couldn't parse this as a valid URL.",
};

const CLAUDE_AMBER = '#ffab00';

const SEVERITY_META: Record<
  'critical' | 'high' | 'medium' | 'low',
  { icon: string; color: string; bg: string; label: string }
> = {
  critical: { icon: '✗', color: 'text-neon-red', bg: 'border-neon-red/40 bg-neon-red/5', label: 'CRITICAL' },
  high: { icon: '⚠', color: 'text-neon-red', bg: 'border-neon-red/30 bg-neon-red/5', label: 'HIGH' },
  medium: { icon: '◯', color: 'text-neon-amber', bg: 'border-neon-amber/30 bg-neon-amber/5', label: 'MEDIUM' },
  low: { icon: '·', color: 'text-neon-cyan', bg: 'border-neon-cyan/20 bg-neon-cyan/5', label: 'LOW' },
};

const VERDICT_META: Record<
  'safe' | 'suspicious' | 'danger',
  { color: string; bg: string; label: string; ascii: string; ring: string }
> = {
  safe: {
    color: 'text-neon-green',
    bg: 'bg-neon-green/10',
    ring: 'ring-neon-green/40',
    label: 'SAFE · PROCEED',
    ascii: '✓',
  },
  suspicious: {
    color: 'text-neon-amber',
    bg: 'bg-neon-amber/10',
    ring: 'ring-neon-amber/40',
    label: 'SUSPICIOUS',
    ascii: '⚠',
  },
  danger: {
    color: 'text-neon-red',
    bg: 'bg-neon-red/10',
    ring: 'ring-neon-red/40',
    label: 'DRAIN · DO NOT SIGN',
    ascii: '☠',
  },
};

const KIND_LABEL: Record<'tx' | 'msg' | 'domain', string> = {
  tx: 'transaction',
  msg: 'sign-message',
  domain: 'domain',
};

export function InspectorPanel({ verdict }: { verdict: VerdictView | null }) {
  return (
    <aside
      aria-label="verdict inspector"
      className="hidden lg:flex flex-col w-[300px] shrink-0 border-l border-neon-green/15 bg-panel/30 px-3 py-3 overflow-y-auto font-mono text-[11px] leading-snug"
    >
      <header className="mb-2 text-neon-cyan text-[10px] tracking-[0.2em] uppercase font-bold">
        // verdict inspector
      </header>
      {verdict ? <VerdictReport key={verdict.startedAt} v={verdict} /> : <EmptyState />}
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col flex-1 gap-3">
      <div className="border border-dashed border-neon-cyan/30 bg-bg/30 px-3 py-5">
        <p className="text-neon-cyan text-[11px] font-bold tracking-[0.2em] uppercase mb-2">
          ← click a demo
        </p>
        <p className="text-fg text-[11px] mb-2">
          your verdict will appear right here:
        </p>
        <pre className="text-neon-green/30 leading-tight text-[9px]">
{`   ┌──────────────┐
   │  SCORE  __   │
   │  ▒▒▒▒▒▒▒▒▒▒  │
   │  VERDICT __  │
   │  · finding 1 │
   │  · finding 2 │
   └──────────────┘`}
        </pre>
        <p className="text-mute mt-2 text-[10px]">
          big score · severity badges · why each finding matters.
        </p>
      </div>

      <section className="border border-neon-amber/30 bg-bg/40 px-2.5 py-2">
        <div className="flex items-center gap-2 mb-1.5">
          <ClaudeMark />
          <span className="text-neon-amber text-[10px] tracking-[0.2em] uppercase font-bold">
            powered by claude
          </span>
        </div>
        <p className="text-mute text-[10px]">
          every scan goes through{' '}
          <span className="text-neon-amber font-bold">claude haiku 4.5</span> (fast triage).
          ambiguous cases auto-escalate to{' '}
          <span className="text-neon-amber font-bold">opus 4.7</span> for deep analysis.
        </p>
      </section>

      <section className="border border-neon-green/15 bg-bg/40 px-2.5 py-2">
        <header className="text-neon-cyan text-[10px] tracking-[0.2em] uppercase font-bold mb-1.5">
          // pipeline
        </header>
        <ol className="text-mute text-[10px] space-y-1 list-decimal list-inside">
          <li>decode wire format · 15 static rules</li>
          <li>simulate via helius rpc</li>
          <li>claude haiku 4.5 · triage</li>
          <li>claude opus 4.7 · deep analysis</li>
          <li>verdict · score · findings · why</li>
        </ol>
      </section>
    </div>
  );
}

function VerdictReport({ v }: { v: VerdictView }) {
  const meta = VERDICT_META[v.verdict];
  return (
    <div className="flex flex-col gap-3 animate-fade-in">
      {/* verdict header */}
      <section className={`border ring-1 ${meta.ring} border-transparent ${meta.bg} px-3 py-3`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-dim text-[10px] tracking-[0.2em] uppercase">
            {KIND_LABEL[v.kind]}
          </span>
          {v.elapsedMs !== undefined && (
            <span className="text-dim text-[10px] tabular-nums">{v.elapsedMs}ms</span>
          )}
        </div>
        <div className={`text-3xl font-bold ${meta.color} flex items-baseline gap-2`}>
          <span>{meta.ascii}</span>
          <span className="tabular-nums">{v.score}</span>
          <span className="text-dim text-sm font-normal">/100</span>
        </div>
        <ScoreBar score={v.score} verdict={v.verdict} />
        <p className={`mt-2 text-[11px] font-bold tracking-[0.15em] uppercase ${meta.color}`}>
          {meta.label}
        </p>
      </section>

      {/* summary */}
      <section className="border border-neon-green/15 bg-bg/40 px-2.5 py-2">
        <header className="text-neon-cyan text-[10px] tracking-[0.2em] uppercase font-bold mb-1">
          // summary
        </header>
        <p className="text-fg text-[11px]">{v.summary}</p>
      </section>

      {/* findings */}
      {v.findings.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <header className="text-neon-cyan text-[10px] tracking-[0.2em] uppercase font-bold">
            // findings · {v.findings.length}
          </header>
          {v.findings.map((f, i) => {
            const sm = SEVERITY_META[f.severity];
            const plain = PLAIN_LANGUAGE[f.ruleId];
            return (
              <div key={i} className={`border px-2 py-1.5 ${sm.bg}`}>
                <div className="flex items-center gap-2">
                  <span className={`${sm.color} text-base leading-none`}>{sm.icon}</span>
                  <span className={`text-[10px] tracking-[0.15em] font-bold ${sm.color}`}>
                    {sm.label}
                  </span>
                  <span className="text-dim text-[10px] ml-auto truncate" title={f.ruleId}>
                    {f.ruleId}
                  </span>
                </div>
                {plain && (
                  <p className="text-neon-green/90 text-[11px] mt-1 leading-snug font-bold">
                    → {plain}
                  </p>
                )}
                <p className="text-mute text-[10px] mt-1 leading-snug">{f.message}</p>
              </div>
            );
          })}
        </section>
      )}

      {/* claude footer */}
      <section className="border border-neon-amber/30 bg-bg/40 px-2.5 py-2 mt-auto">
        <div className="flex items-center gap-2">
          <ClaudeMark />
          <span className="text-neon-amber text-[10px] tracking-[0.2em] uppercase font-bold">
            analyzed by claude
          </span>
        </div>
        <p className="text-mute text-[10px] mt-1">
          {v.models.length === 0
            ? 'static rules only · no AI required for domain checks'
            : v.models.map((m) => `claude ${m}`).join(' → ')}
        </p>
        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-neon-amber/15">
          <span className="text-dim text-[10px]">built by</span>
          <a
            href="https://github.com/0xnullpavel"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neon-amber/90 hover:text-neon-amber text-[10px] font-bold tracking-wider"
          >
            0xnullpavel ↗
          </a>
        </div>
      </section>
    </div>
  );
}

function ScoreBar({ score, verdict }: { score: number; verdict: VerdictView['verdict'] }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    // animate fill on mount
    const id = requestAnimationFrame(() => setWidth(score));
    return () => cancelAnimationFrame(id);
  }, [score]);
  const fill =
    verdict === 'safe' ? 'bg-neon-green' : verdict === 'suspicious' ? 'bg-neon-amber' : 'bg-neon-red';
  return (
    <div className="mt-2 w-full h-1.5 bg-bg/60 border border-neon-green/10 overflow-hidden">
      <div
        className={`h-full ${fill} transition-[width] duration-700 ease-out`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function ClaudeMark({ size = 12 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{ color: CLAUDE_AMBER, fontSize: size, lineHeight: 1 }}
      className="inline-block"
    >
      ✦
    </span>
  );
}
