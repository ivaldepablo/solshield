'use client';

import { useState } from 'react';

type DetectedKind = 'tx' | 'domain' | 'msg' | null;

const KIND_LABEL: Record<Exclude<DetectedKind, null>, string> = {
  tx: 'solana transaction (base64)',
  domain: 'dapp domain / url',
  msg: 'sign-in / signable message',
};

/**
 * Best-effort detection of what the user pasted.
 * Order matters — http(s) wins over the bare-domain rule, base64 wins over msg.
 */
function detect(input: string): DetectedKind {
  const t = input.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return 'domain';
  // Pure base64-ish payload of meaningful length, no spaces.
  if (/^[A-Za-z0-9+/=]{30,}$/.test(t) && !t.includes(' ')) return 'tx';
  // Bare hostname (no spaces, contains a dot, ends in a TLD).
  if (!/\s/.test(t) && /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(t)) return 'domain';
  // Anything else with text is probably a message.
  return 'msg';
}

function commandFor(kind: Exclude<DetectedKind, null>, value: string): string {
  if (kind === 'tx') return `scan ${value.trim()}`;
  if (kind === 'domain') return `domain ${value.trim()}`;
  return `msg ${value.trim()}`;
}

export function PasteBar({ onAnalyze }: { onAnalyze: (cmd: string) => void }) {
  const [value, setValue] = useState('');
  const detected = detect(value);

  const submit = () => {
    if (!detected) return;
    onAnalyze(commandFor(detected, value));
    setValue('');
  };

  return (
    <div className="border-b border-neon-green/15 bg-bg/40 px-4 py-3">
      <div className="max-w-3xl mx-auto space-y-2">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.25em] text-neon-cyan/70 uppercase font-mono">
          <span>// paste anything · we figure out what it is</span>
          {detected && (
            <span className="text-neon-amber normal-case tracking-normal">
              → detected: {KIND_LABEL[detected]}
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="paste a transaction, sign-in message, or dapp link…"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-bg/80 border border-neon-green/30 px-3 py-2 text-fg font-mono text-[12px] sm:text-sm focus:border-neon-green focus:outline-none placeholder:text-dim transition-colors"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!detected}
            className="shrink-0 px-5 py-2 border border-neon-green text-neon-green font-bold tracking-[0.2em] uppercase text-[11px] sm:text-xs bg-neon-green/5 hover:bg-neon-green/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-neon-green/5"
          >
            analyze →
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-dim text-[10px] tracking-wide font-mono uppercase">
            no input handy?
          </span>
          <ChipButton onClick={() => onAnalyze('demo drainer')} tone="red">
            try a drainer tx
          </ChipButton>
          <ChipButton onClick={() => onAnalyze('domain jupitor.ag')} tone="red">
            try phishing url
          </ChipButton>
          <ChipButton
            onClick={() =>
              onAnalyze('msg jup.ag wants you to sign in with your Solana account:\n\nNonce: a1b2')
            }
            tone="amber"
          >
            try sign-in spoof
          </ChipButton>
          <ChipButton onClick={() => onAnalyze('demo safe')} tone="green">
            try a safe tx
          </ChipButton>
        </div>
      </div>
    </div>
  );
}

function ChipButton({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone: 'red' | 'amber' | 'green' | 'cyan';
}) {
  const cls = {
    red: 'border-neon-red/40 text-neon-red hover:bg-neon-red/15',
    amber: 'border-neon-amber/40 text-neon-amber hover:bg-neon-amber/15',
    green: 'border-neon-green/40 text-neon-green hover:bg-neon-green/15',
    cyan: 'border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/15',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 border text-[10px] tracking-wider uppercase font-mono transition-colors ${cls}`}
    >
      [ {children} ]
    </button>
  );
}
