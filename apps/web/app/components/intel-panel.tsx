'use client';

import { useEffect, useState } from 'react';
import { TermHelp } from './term-help';

const CLAUDE_AMBER = '#ffab00'; // anthropic-ish amber. swap to /public/claude.svg if/when added.

interface ChipDef {
  label: string;
  cmd: string;
  tone: 'red' | 'cyan' | 'amber' | 'green';
  hint: string;
}

const CHIPS: ChipDef[] = [
  { label: 'drainer tx', cmd: 'demo drainer', tone: 'red', hint: 'classic wallet-emptying pattern' },
  {
    label: 'phishing url',
    cmd: 'domain jupitor.ag',
    tone: 'red',
    hint: 'fake jupiter typo-squat',
  },
  {
    label: 'siws spoof',
    cmd: 'msg jup.ag wants you to sign in with your Solana account:\n\nNonce: a1b2',
    tone: 'amber',
    hint: 'sign-in message with mismatched origin',
  },
  { label: 'safe tx', cmd: 'demo safe', tone: 'green', hint: 'baseline · jupiter v6 swap' },
];

const CHIP_TONE: Record<ChipDef['tone'], string> = {
  red: 'border-neon-red/40 text-neon-red hover:bg-neon-red/15',
  cyan: 'border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/15',
  amber: 'border-neon-amber/40 text-neon-amber hover:bg-neon-amber/15',
  green: 'border-neon-green/40 text-neon-green hover:bg-neon-green/15',
};

const FEED_SEED: Array<{ ageS: number; tag: 'BLOCK' | 'WARN' | 'SAFE'; rule: string }> = [
  { ageS: 3, tag: 'BLOCK', rule: 'unlimited-spl-approval' },
  { ageS: 11, tag: 'BLOCK', rule: 'mass-token-drain' },
  { ageS: 27, tag: 'WARN', rule: 'mint-authority-transfer' },
  { ageS: 44, tag: 'SAFE', rule: 'jupiter-v6-swap' },
  { ageS: 71, tag: 'BLOCK', rule: 'simulated-signer-drain' },
];

const TAG_COLOR: Record<'BLOCK' | 'WARN' | 'SAFE', string> = {
  BLOCK: 'text-neon-red',
  WARN: 'text-neon-amber',
  SAFE: 'text-neon-green',
};

function ago(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function IntelPanel({ onChip }: { onChip: (cmd: string) => void }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const feed = FEED_SEED.map((f) => ({ ...f, ageS: f.ageS + tick }));

  return (
    <aside
      aria-label="intel sidebar"
      className="hidden lg:flex flex-col gap-3 w-[260px] shrink-0 border-r border-neon-green/15 bg-panel/30 px-3 py-3 overflow-y-auto font-mono text-[11px] leading-snug"
    >
      <PanelCard title="// scan before you sign" tone="cyan">
        <p className="text-fg">
          a <span className="text-neon-green font-bold">firewall</span> for solana wallets.
        </p>
        <p className="text-mute mt-1">
          blocks <TermHelp term="drainer"><span className="text-neon-red">drainers</span></TermHelp>,{' '}
          <TermHelp term="phishing"><span className="text-neon-red">phishing</span></TermHelp> &amp;{' '}
          <TermHelp term="permit"><span className="text-neon-amber">fake permits</span></TermHelp>{' '}
          before you sign.
        </p>
        <p className="text-dim mt-1">open source · self-hostable · zero fees.</p>
      </PanelCard>

      <PanelCard title="// how to use · 3 steps" tone="green" highlight="green">
        <ol className="space-y-1.5 text-[11px]">
          <li className="flex gap-2">
            <span className="text-neon-green font-bold shrink-0">1.</span>
            <span className="text-fg">
              click any <span className="text-neon-green font-bold">demo</span> below ↓
              <br />
              <span className="text-dim text-[10px]">(or type your own command)</span>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-neon-amber font-bold shrink-0">2.</span>
            <span className="text-fg">
              <span className="text-neon-amber font-bold">claude</span> analyzes it
              <br />
              <span className="text-dim text-[10px]">(haiku 4.5 → opus 4.7)</span>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-neon-cyan font-bold shrink-0">3.</span>
            <span className="text-fg">
              verdict appears <span className="text-neon-cyan font-bold">on the right →</span>
              <br />
              <span className="text-dim text-[10px]">score · findings · why it&apos;s bad</span>
            </span>
          </li>
        </ol>
      </PanelCard>

      <PanelCard title="// pick a demo  ↓" tone="cyan">
        <div className="flex flex-col gap-1.5">
          {CHIPS.map((c) => (
            <button
              key={c.label}
              onClick={() => onChip(c.cmd)}
              className={`text-left px-2 py-1.5 border transition-all ${CHIP_TONE[c.tone]}`}
              title={c.hint}
            >
              <div className="text-[11px] tracking-[0.15em] uppercase font-bold">[ {c.label} ]</div>
              <div className="text-[10px] text-mute mt-0.5 normal-case tracking-normal">
                {c.hint}
              </div>
            </button>
          ))}
        </div>
      </PanelCard>

      <PanelCard title="// claude ai · inside" tone="amber" highlight="amber">
        <div className="flex items-center gap-2 mb-2">
          <ClaudeMark />
          <span className="text-neon-amber font-bold tracking-[0.15em]">EVERY SCAN USES AI</span>
        </div>
        <p className="text-fg mb-2 text-[11px]">
          there&apos;s no &quot;optional AI mode&quot;. every transaction, message and domain you check
          here goes through{' '}
          <a
            href="https://anthropic.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neon-amber underline decoration-dotted hover:text-neon-amber/80"
          >
            anthropic
          </a>{' '}
          claude.
        </p>
        <ModelRow name="haiku 4.5" role="fast triage" latency="~200ms" />
        <ModelRow name="opus 4.7" role="deep analysis" latency="~1.2s" />
        <p className="text-dim mt-2 text-[10px]">
          ambiguous cases auto-escalate haiku → opus.
          <br />
          all prompts public on github.
        </p>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-neon-amber/20">
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
      </PanelCard>

      <PanelCard title="// live · mainnet" tone="cyan">
        <div className="flex flex-col gap-1">
          {feed.map((f, i) => (
            <div key={i} className="flex items-baseline gap-2 text-[10px]">
              <span className="text-dim w-9 shrink-0">{ago(f.ageS).padStart(3)} ago</span>
              <span className={`${TAG_COLOR[f.tag]} font-bold w-10 shrink-0`}>{f.tag}</span>
              <span className="text-mute truncate" title={f.rule}>
                {f.rule}
              </span>
            </div>
          ))}
        </div>
        <p className="text-dim mt-2 text-[10px]">mock preview · real feed lands in 0.2.</p>
      </PanelCard>
    </aside>
  );
}

function PanelCard({
  title,
  tone,
  highlight,
  children,
}: {
  title: string;
  tone: 'cyan' | 'amber' | 'green' | 'red';
  highlight?: 'amber' | 'green';
  children: React.ReactNode;
}) {
  const titleColor = {
    cyan: 'text-neon-cyan',
    amber: 'text-neon-amber',
    green: 'text-neon-green',
    red: 'text-neon-red',
  }[tone];
  const borderColor =
    highlight === 'amber'
      ? 'border-neon-amber/40 shadow-[0_0_12px_-4px_rgba(255,171,0,0.4)]'
      : highlight === 'green'
        ? 'border-neon-green/40 shadow-[0_0_12px_-4px_rgba(0,255,65,0.4)]'
        : 'border-neon-green/15';
  return (
    <section className={`border ${borderColor} bg-bg/40 px-2.5 py-2`}>
      <header className={`mb-1.5 ${titleColor} text-[10px] tracking-[0.2em] uppercase font-bold`}>
        {title}
      </header>
      {children}
    </section>
  );
}

function ModelRow({ name, role, latency }: { name: string; role: string; latency: string }) {
  // Pull the bare model name (haiku/opus) for the tooltip lookup.
  const tooltipKey = name.split(/\s+/)[0] ?? name;
  return (
    <div className="flex items-baseline gap-2">
      <TermHelp term={tooltipKey}>
        <span className="text-neon-amber/80 text-[11px] font-bold tracking-wide">▸ {name}</span>
      </TermHelp>
      <span className="text-mute text-[10px]">— {role}</span>
      <span className="text-dim text-[10px] ml-auto">{latency}</span>
    </div>
  );
}

/**
 * Claude "spark" mark. Tiny ✦ glyph in Anthropic-amber.
 * If `/public/claude.svg` exists, drop an <img> here instead — left as a comment for clarity.
 */
function ClaudeMark({ size = 14 }: { size?: number }) {
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
