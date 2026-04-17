'use client';

import { useEffect, useState } from 'react';
import type { VerdictView } from './terminal';

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
  { color: string; bg: string; label: string; ascii: string; headline: string }
> = {
  safe: {
    color: 'text-neon-green',
    bg: 'bg-neon-green/10',
    label: 'SAFE · looks clean',
    ascii: '✓',
    headline: "nothing sketchy here — but always DYOR.",
  },
  suspicious: {
    color: 'text-neon-amber',
    bg: 'bg-neon-amber/10',
    label: 'SUSPICIOUS · be careful',
    ascii: '⚠',
    headline: "something's off. verify before you sign or connect.",
  },
  danger: {
    color: 'text-neon-red',
    bg: 'bg-neon-red/10',
    label: 'DO NOT SIGN · do not connect',
    ascii: '☠',
    headline: "this looks like a scam. don't click it. don't sign it.",
  },
};

const KIND_LABEL: Record<'tx' | 'msg' | 'domain', string> = {
  tx: 'transaction',
  msg: 'sign-message',
  domain: 'domain',
};

/** ruleId → one-liner in plain language so non-tech users grok severity. */
export const PLAIN_LANGUAGE: Record<string, string> = {
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
  'empty-message-sign': "blank message — your signature could be replayed elsewhere.",
  'opaque-binary-sign': "signing binary data with no explanation — risky.",
  'url-in-message': "message contains a link — verify before clicking.",
  'rtl-override-attack': "message hides text using unicode tricks.",
  'spoofed-siws-domain': "message claims a different site than the one asking.",
  'permit-style-approval': "message looks like an off-chain token approval.",
  blocklisted: "this domain is on our scam blocklist.",
  typosquat: "name looks like a 1–2 letter typo of a real dapp.",
  'suspicious-tld': "uses a free TLD popular with scammers.",
  'punycode-idn': "punycode hostname — could impersonate a real brand.",
  'phishing-keyword': "name combines a real brand with a scam keyword.",
  'suspicious-structure': "hostname shape is unusual for legit dapps.",
  'invalid-url': "couldn't parse this as a valid URL.",
};

/**
 * Big verdict card, used inline on the simple home page.
 * Wider / splashier than the sidebar inspector — this is the ONLY thing
 * on screen when a result arrives, so it can breathe.
 */
export function VerdictCard({ verdict: v }: { verdict: VerdictView }) {
  const meta = VERDICT_META[v.verdict];
  return (
    <div
      key={v.startedAt}
      className={`w-full max-w-xl border-2 ${meta.color.replace('text-', 'border-')}/40 ${meta.bg} p-5 sm:p-6 font-mono animate-fade-in`}
    >
      {/* header: kind + elapsed */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-dim text-[10px] tracking-[0.25em] uppercase">
          {KIND_LABEL[v.kind]} verdict
        </span>
        {v.elapsedMs !== undefined && (
          <span className="text-dim text-[10px] tabular-nums">{v.elapsedMs}ms</span>
        )}
      </div>

      {/* big score + verdict */}
      <div className={`flex items-baseline gap-3 ${meta.color}`}>
        <span className="text-4xl sm:text-5xl leading-none">{meta.ascii}</span>
        <span className="text-4xl sm:text-5xl font-bold tabular-nums leading-none">{v.score}</span>
        <span className="text-dim text-base font-normal">/100</span>
      </div>
      <ScoreBar score={v.score} verdict={v.verdict} />
      <p className={`mt-3 text-sm sm:text-base font-bold tracking-[0.1em] uppercase ${meta.color}`}>
        {meta.label}
      </p>
      <p className="text-fg mt-2 text-sm">{meta.headline}</p>

      {/* summary */}
      {v.summary && (
        <p className="mt-4 pt-4 border-t border-dim/30 text-fg text-sm leading-relaxed">
          <span className="text-neon-cyan text-[10px] tracking-[0.25em] uppercase block mb-1">
            // summary
          </span>
          {v.summary}
        </p>
      )}

      {/* findings */}
      {v.findings.length > 0 && (
        <div className="mt-4 pt-4 border-t border-dim/30">
          <p className="text-neon-cyan text-[10px] tracking-[0.25em] uppercase mb-2">
            // what we found · {v.findings.length}
          </p>
          <div className="flex flex-col gap-2">
            {v.findings.map((f, i) => {
              const sm = SEVERITY_META[f.severity];
              const plain = PLAIN_LANGUAGE[f.ruleId];
              return (
                <div key={i} className={`border px-3 py-2 ${sm.bg}`}>
                  <div className="flex items-center gap-2">
                    <span className={`${sm.color} text-lg leading-none`}>{sm.icon}</span>
                    <span className={`text-[10px] tracking-[0.15em] font-bold ${sm.color}`}>
                      {sm.label}
                    </span>
                    <span className="text-dim text-[10px] ml-auto truncate" title={f.ruleId}>
                      {f.ruleId}
                    </span>
                  </div>
                  {plain && (
                    <p className="text-neon-green/90 text-[13px] mt-1.5 leading-snug font-bold">
                      → {plain}
                    </p>
                  )}
                  <p className="text-mute text-[11px] mt-1 leading-snug">{f.message}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* claude footer */}
      <div className="mt-4 pt-4 border-t border-neon-amber/25 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span style={{ color: CLAUDE_AMBER }} aria-hidden>
            ✦
          </span>
          <span className="text-neon-amber text-[10px] tracking-[0.2em] uppercase font-bold">
            {v.models.length === 0 ? 'static rules' : 'analyzed by claude'}
          </span>
          {v.models.length > 0 && (
            <span className="text-mute text-[10px]">
              · {v.models.join(' → ')}
            </span>
          )}
        </div>
        <a
          href="https://github.com/0xnullpavel"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neon-amber/90 hover:text-neon-amber text-[10px] font-bold tracking-wider"
        >
          by 0xnullpavel ↗
        </a>
      </div>
    </div>
  );
}

function ScoreBar({ score, verdict }: { score: number; verdict: VerdictView['verdict'] }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(score));
    return () => cancelAnimationFrame(id);
  }, [score]);
  const fill =
    verdict === 'safe' ? 'bg-neon-green' : verdict === 'suspicious' ? 'bg-neon-amber' : 'bg-neon-red';
  return (
    <div className="mt-3 w-full h-2 bg-bg/60 border border-dim/30 overflow-hidden">
      <div
        className={`h-full ${fill} transition-[width] duration-700 ease-out`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
