'use client';

import { useState } from 'react';
import Link from 'next/link';

const CLAUDE_AMBER = '#ffab00';

type Scenario = 'drainer' | 'suspicious' | 'safe';
type Phase = 'idle' | 'overlay' | 'rejected' | 'bypassed';

interface ScenarioData {
  title: string;
  dapp: string;
  dappUrl: string;
  rows: Array<{ label: string; value: string; tone?: 'danger' | 'warning' | 'normal' }>;
  verdict: 'danger' | 'suspicious' | 'safe';
  score: number;
  findings: Array<{ severity: 'critical' | 'high' | 'medium' | 'low'; text: string }>;
  estimatedLoss?: string;
}

const SCENARIOS: Record<Scenario, ScenarioData> = {
  drainer: {
    title: 'Approve token spend',
    dapp: 'airdrop-jupiter.claim',
    dappUrl: 'jupitor-claim.io',
    rows: [
      { label: 'From', value: 'Your wallet' },
      { label: 'To', value: '7xKX…Jjng', tone: 'danger' },
      { label: 'Spend', value: 'UNLIMITED USDC', tone: 'danger' },
      { label: 'Transfer', value: '4.2 SOL', tone: 'danger' },
      { label: 'Memo', value: 'airdrop_claim_v3', tone: 'warning' },
    ],
    verdict: 'danger',
    score: 94,
    findings: [
      { severity: 'critical', text: 'they want permission to take ALL your USDC, not just one transfer' },
      { severity: 'high', text: '4.2 SOL going to a wallet that is not yours' },
      { severity: 'medium', text: 'memo string matches a known drainer signature' },
    ],
    estimatedLoss: '~$1,840 (4.2 SOL + USDC wallet balance)',
  },
  suspicious: {
    title: 'Sign message to sign in',
    dapp: 'jup.ag sign-in',
    dappUrl: 'phishy-jup.xyz',
    rows: [
      { label: 'Message', value: '"jup.ag wants you to sign in with your Solana account"' },
      { label: 'Claimed domain', value: 'jup.ag' },
      { label: 'Real origin', value: 'phishy-jup.xyz', tone: 'warning' },
    ],
    verdict: 'suspicious',
    score: 58,
    findings: [
      { severity: 'critical', text: 'message claims jup.ag but the real site is phishy-jup.xyz — spoofed sign-in' },
    ],
  },
  safe: {
    title: 'Swap tokens',
    dapp: 'Jupiter',
    dappUrl: 'jup.ag',
    rows: [
      { label: 'From', value: 'Your wallet' },
      { label: 'To', value: 'Jupiter v6 router' },
      { label: 'Swap', value: '0.1 SOL → 15.42 USDC' },
      { label: 'Slippage', value: '0.5%' },
    ],
    verdict: 'safe',
    score: 5,
    findings: [],
  },
};

export default function ExtensionPreview() {
  const [scenario, setScenario] = useState<Scenario>('drainer');
  const [phase, setPhase] = useState<Phase>('idle');

  const data = SCENARIOS[scenario];

  const clickApprove = () => {
    // In a real extension, this is where signTransaction would be intercepted.
    if (data.verdict === 'safe') {
      // Safe: small success toast, no overlay.
      setPhase('bypassed');
      return;
    }
    setPhase('overlay');
  };

  const reset = (next?: Scenario) => {
    if (next) setScenario(next);
    setPhase('idle');
  };

  return (
    <div className="relative min-h-screen bg-bg text-fg font-mono">
      <Header />

      <main className="max-w-5xl mx-auto px-4 py-8 sm:py-12">
        <Hero />
        <ScenarioPicker current={scenario} onPick={(s) => reset(s)} />

        <div className="relative mt-6">
          {/* mock Phantom popup */}
          <PhantomPopup
            data={data}
            phase={phase}
            onApprove={clickApprove}
            onReject={() => setPhase('rejected')}
          />

          {/* SolShield overlay */}
          {phase === 'overlay' && (
            <SolShieldOverlay
              data={data}
              onReject={() => setPhase('rejected')}
              onProceed={() => setPhase('bypassed')}
            />
          )}
        </div>

        <ResultNarration phase={phase} data={data} onReset={() => reset()} />

        <HowItWorks />
        <NoCooperationNote />
        <WaitlistCTA />
      </main>

      <footer className="border-t border-neon-green/15 bg-bg/60 px-4 py-4 text-center text-[11px] text-dim">
        this is a preview — the real extension is in development.{' '}
        <Link href="/" className="text-neon-cyan hover:text-neon-cyan/80">
          ← back to solshield
        </Link>
      </footer>
    </div>
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
          / EXTENSION · preview
        </span>
      </Link>
      <Link
        href="/"
        className="text-mute hover:text-neon-cyan transition-colors text-[11px] tracking-[0.2em] uppercase"
      >
        [ home ]
      </Link>
    </nav>
  );
}

function Hero() {
  return (
    <div className="text-center mb-10">
      <p className="text-neon-cyan/80 text-[10px] tracking-[0.3em] uppercase mb-2">
        // interactive preview
      </p>
      <h1 className="text-2xl sm:text-4xl font-bold text-fg leading-tight">
        see the extension <span className="text-neon-red">catch a drainer</span>{' '}
        <span className="text-neon-green">live</span>
      </h1>
      <p className="mt-3 text-mute text-sm sm:text-base max-w-xl mx-auto">
        this is a working mockup of what SolShield would show on top of your wallet popup.
        click <span className="text-neon-red font-bold">approve</span> and watch what happens.
      </p>
    </div>
  );
}

function ScenarioPicker({
  current,
  onPick,
}: {
  current: Scenario;
  onPick: (s: Scenario) => void;
}) {
  const buttons: Array<{ key: Scenario; label: string; tone: string; desc: string }> = [
    { key: 'drainer', label: 'DRAINER TX', tone: 'red', desc: 'steals 4.2 SOL + all USDC' },
    { key: 'suspicious', label: 'SIGN-IN SPOOF', tone: 'amber', desc: 'fake jup.ag login' },
    { key: 'safe', label: 'LEGIT SWAP', tone: 'green', desc: 'jupiter swap 0.1 SOL' },
  ];
  const tones = {
    red: 'border-neon-red text-neon-red bg-neon-red/10',
    amber: 'border-neon-amber text-neon-amber bg-neon-amber/10',
    green: 'border-neon-green text-neon-green bg-neon-green/10',
  };
  const inactiveTones = {
    red: 'border-neon-red/20 text-neon-red/50 hover:border-neon-red/50 hover:text-neon-red',
    amber: 'border-neon-amber/20 text-neon-amber/50 hover:border-neon-amber/50 hover:text-neon-amber',
    green: 'border-neon-green/20 text-neon-green/50 hover:border-neon-green/50 hover:text-neon-green',
  };
  return (
    <div className="flex flex-col sm:flex-row gap-2 max-w-2xl mx-auto">
      {buttons.map((b) => {
        const active = current === b.key;
        return (
          <button
            key={b.key}
            onClick={() => onPick(b.key)}
            className={`flex-1 text-left px-4 py-3 border-2 transition-all ${
              active ? tones[b.tone as keyof typeof tones] : inactiveTones[b.tone as keyof typeof inactiveTones]
            }`}
          >
            <div className="text-[11px] tracking-[0.2em] font-bold">[ {b.label} ]</div>
            <div className="text-[10px] text-mute mt-1 normal-case tracking-normal">{b.desc}</div>
          </button>
        );
      })}
    </div>
  );
}

function PhantomPopup({
  data,
  phase,
  onApprove,
  onReject,
}: {
  data: ScenarioData;
  phase: Phase;
  onApprove: () => void;
  onReject: () => void;
}) {
  const dimmed = phase === 'overlay';
  return (
    <div
      className={`max-w-md mx-auto transition-all ${dimmed ? 'blur-[2px] opacity-60' : ''}`}
      aria-hidden={dimmed}
    >
      <div className="bg-[#1a1a2e] border border-[#2d2d4a] rounded-2xl shadow-2xl overflow-hidden font-sans">
        {/* Phantom header */}
        <div className="px-5 py-3 bg-gradient-to-b from-[#2a2a3e] to-[#1a1a2e] border-b border-[#2d2d4a] flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#ab9ff2] to-[#7858eb] flex items-center justify-center text-white text-sm">
            👻
          </div>
          <span className="text-white text-sm font-semibold">Phantom</span>
          <span className="ml-auto text-[10px] text-[#6b6b85] uppercase tracking-wider">
            {data.dappUrl}
          </span>
        </div>

        {/* body */}
        <div className="px-5 py-4">
          <h3 className="text-white text-lg font-semibold mb-1">{data.title}</h3>
          <p className="text-[#a0a0b8] text-xs mb-4">Requested by {data.dapp}</p>

          <div className="space-y-2 text-sm">
            {data.rows.map((row, i) => (
              <div key={i} className="flex items-start justify-between gap-3 py-1.5 border-b border-[#2d2d4a] last:border-0">
                <span className="text-[#6b6b85] text-xs uppercase tracking-wider shrink-0">
                  {row.label}
                </span>
                <span
                  className={`text-right font-mono text-xs ${
                    row.tone === 'danger'
                      ? 'text-[#ff6b6b] font-bold'
                      : row.tone === 'warning'
                        ? 'text-[#ffc36b]'
                        : 'text-white'
                  }`}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          {data.verdict === 'safe' && (
            <div className="mt-4 flex items-center gap-2 text-[11px] text-[#4ade80]">
              <span style={{ color: CLAUDE_AMBER }}>✦</span>
              <span>SolShield: safe · checked by claude haiku 4.5</span>
            </div>
          )}

          {/* buttons */}
          <div className="flex gap-2 mt-5">
            <button
              type="button"
              onClick={onReject}
              className="flex-1 py-3 rounded-lg bg-[#2d2d4a] text-white text-sm font-semibold hover:bg-[#3d3d5a] transition-colors"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={onApprove}
              className="flex-1 py-3 rounded-lg bg-gradient-to-b from-[#9945ff] to-[#7858eb] text-white text-sm font-semibold hover:brightness-110 transition-all"
            >
              Approve
            </button>
          </div>
        </div>
      </div>
      <p className="text-center text-dim text-[10px] mt-3 tracking-wider uppercase">
        ↑ mock Phantom popup
      </p>
    </div>
  );
}

function SolShieldOverlay({
  data,
  onReject,
  onProceed,
}: {
  data: ScenarioData;
  onReject: () => void;
  onProceed: () => void;
}) {
  const isDrainer = data.verdict === 'danger';
  const tone = isDrainer ? 'red' : 'amber';
  const colors = {
    red: {
      border: 'border-neon-red',
      bg: 'bg-gradient-to-b from-neon-red/30 to-bg',
      text: 'text-neon-red',
      icon: '☠',
      label: 'DRAINER DETECTED',
      headline: "this tx will drain your wallet. don't sign it.",
      glow: 'shadow-[0_0_40px_-5px_rgba(255,0,60,0.6)]',
    },
    amber: {
      border: 'border-neon-amber',
      bg: 'bg-gradient-to-b from-neon-amber/25 to-bg',
      text: 'text-neon-amber',
      icon: '⚠',
      label: 'SUSPICIOUS',
      headline: "something's off. verify before signing.",
      glow: 'shadow-[0_0_40px_-5px_rgba(255,171,0,0.5)]',
    },
  }[tone];

  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-4 z-10 animate-fade-in"
      role="alertdialog"
      aria-label="SolShield warning"
    >
      <div
        className={`max-w-md w-full border-2 ${colors.border} ${colors.bg} ${colors.glow} p-5 sm:p-6 font-mono animate-fade-in`}
        style={{ animationDuration: '200ms' }}
      >
        {/* header */}
        <div className="flex items-center gap-2 mb-3">
          <span style={{ color: CLAUDE_AMBER }} className="text-sm">
            ✦
          </span>
          <span className="text-neon-amber text-[10px] tracking-[0.25em] uppercase font-bold">
            SolShield
          </span>
          <span className="text-dim text-[10px] ml-auto">200ms analysis</span>
        </div>

        {/* headline */}
        <div className={`flex items-baseline gap-3 ${colors.text}`}>
          <span className="text-5xl leading-none">{colors.icon}</span>
          <div>
            <div className="text-lg font-bold tracking-[0.1em]">{colors.label}</div>
            <div className="text-xs font-bold tracking-wider">{data.score}/100</div>
          </div>
        </div>
        <p className="mt-3 text-fg text-sm font-semibold">{colors.headline}</p>

        {/* findings */}
        <div className="mt-4 space-y-1.5">
          {data.findings.map((f, i) => (
            <div key={i} className="flex gap-2 text-[13px] leading-snug">
              <span className={colors.text}>→</span>
              <span className="text-fg">{f.text}</span>
            </div>
          ))}
        </div>

        {/* estimated loss */}
        {data.estimatedLoss && (
          <div className="mt-3 pt-3 border-t border-neon-red/20 text-xs">
            <span className="text-dim uppercase tracking-wider">estimated loss: </span>
            <span className="text-neon-red font-bold">{data.estimatedLoss}</span>
          </div>
        )}

        {/* buttons */}
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onReject}
            className="w-full py-3 bg-neon-green/15 border border-neon-green text-neon-green font-bold tracking-[0.15em] uppercase text-sm hover:bg-neon-green/25 transition-colors"
          >
            ✓ reject &amp; close
          </button>
          <button
            type="button"
            onClick={onProceed}
            className={`w-full py-2 border ${colors.border}/40 ${colors.text} text-[11px] tracking-wider uppercase hover:bg-bg/50 transition-colors`}
          >
            i understand · proceed anyway
          </button>
        </div>

        {/* claude footer */}
        <p className="mt-3 text-center text-dim text-[10px]">
          analyzed by claude haiku 4.5 → opus 4.7 · by 0xnullpavel
        </p>
      </div>
    </div>
  );
}

function ResultNarration({
  phase,
  data,
  onReset,
}: {
  phase: Phase;
  data: ScenarioData;
  onReset: () => void;
}) {
  if (phase === 'idle' || phase === 'overlay') return null;

  if (phase === 'rejected') {
    const isSafe = data.verdict === 'safe';
    return (
      <div className="max-w-md mx-auto mt-6 border-2 border-neon-green/40 bg-neon-green/5 p-5 text-center">
        <div className="text-neon-green text-3xl mb-2">✓</div>
        <p className="text-neon-green font-bold tracking-[0.1em] uppercase text-sm">
          {isSafe ? 'rejected · no harm done' : 'you just saved yourself'}
        </p>
        {data.estimatedLoss && (
          <p className="text-fg text-sm mt-2">
            you would have lost <span className="text-neon-red font-bold">{data.estimatedLoss}</span>.
          </p>
        )}
        <button
          onClick={onReset}
          className="mt-4 px-4 py-2 border border-neon-cyan/50 text-neon-cyan text-[11px] tracking-wider uppercase hover:bg-neon-cyan/10"
        >
          ↻ try again
        </button>
      </div>
    );
  }

  if (phase === 'bypassed') {
    const isSafe = data.verdict === 'safe';
    if (isSafe) {
      return (
        <div className="max-w-md mx-auto mt-6 border border-neon-green/30 bg-neon-green/5 p-4 text-center">
          <p className="text-neon-green text-sm">
            ✓ transaction approved. SolShield didn&apos;t intervene because this is legitimate.
          </p>
          <button
            onClick={onReset}
            className="mt-3 px-4 py-1.5 border border-neon-cyan/50 text-neon-cyan text-[11px] tracking-wider uppercase hover:bg-neon-cyan/10"
          >
            ↻ try another
          </button>
        </div>
      );
    }
    return (
      <div className="max-w-md mx-auto mt-6 border-2 border-neon-red/40 bg-neon-red/5 p-5 text-center">
        <div className="text-neon-red text-3xl mb-2">✗</div>
        <p className="text-neon-red font-bold tracking-[0.1em] uppercase text-sm">
          you were warned
        </p>
        <p className="text-fg text-sm mt-2">
          in the real extension, you would have just lost{' '}
          <span className="text-neon-red font-bold">{data.estimatedLoss}</span>.
        </p>
        <p className="text-mute text-xs mt-2">
          SolShield can warn you, but it can&apos;t force you. free will included.
        </p>
        <button
          onClick={onReset}
          className="mt-4 px-4 py-2 border border-neon-cyan/50 text-neon-cyan text-[11px] tracking-wider uppercase hover:bg-neon-cyan/10"
        >
          ↻ try again
        </button>
      </div>
    );
  }

  return null;
}

function HowItWorks() {
  return (
    <section className="mt-16 border border-neon-green/15 bg-panel/20 p-5 sm:p-6">
      <h2 className="text-neon-cyan text-[10px] tracking-[0.3em] uppercase font-bold mb-3">
        // how the real extension works
      </h2>
      <ol className="space-y-3 text-sm text-fg">
        <li className="flex gap-3">
          <span className="text-neon-green font-bold shrink-0 w-6">1.</span>
          <span>
            user installs <span className="text-neon-green">SolShield</span> from Chrome Web Store — 1 click
          </span>
        </li>
        <li className="flex gap-3">
          <span className="text-neon-green font-bold shrink-0 w-6">2.</span>
          <span>
            extension hooks into <code className="text-neon-cyan text-xs">window.solana</code> — the standard
            api every Solana wallet exposes (Phantom, Solflare, Backpack, ...)
          </span>
        </li>
        <li className="flex gap-3">
          <span className="text-neon-green font-bold shrink-0 w-6">3.</span>
          <span>
            when a dapp calls <code className="text-neon-cyan text-xs">signTransaction</code>, extension
            sends the tx to <code className="text-neon-cyan text-xs">solshield.dev/api/inspect</code>
          </span>
        </li>
        <li className="flex gap-3">
          <span className="text-neon-green font-bold shrink-0 w-6">4.</span>
          <span>
            <span style={{ color: CLAUDE_AMBER }}>✦</span>{' '}
            <span className="text-neon-amber">claude</span> returns verdict in ~200ms
          </span>
        </li>
        <li className="flex gap-3">
          <span className="text-neon-green font-bold shrink-0 w-6">5.</span>
          <span>
            if danger → overlay above the wallet popup (what you just saw). if safe → tiny green checkmark
          </span>
        </li>
        <li className="flex gap-3">
          <span className="text-neon-green font-bold shrink-0 w-6">6.</span>
          <span>
            user decides. the wallet signs the original tx only if user says OK. the extension NEVER sees
            keys.
          </span>
        </li>
      </ol>
    </section>
  );
}

function NoCooperationNote() {
  return (
    <section className="mt-4 border border-neon-amber/30 bg-neon-amber/5 p-5 sm:p-6">
      <h2 className="text-neon-amber text-[10px] tracking-[0.3em] uppercase font-bold mb-3">
        // zero cooperation needed from wallets
      </h2>
      <p className="text-fg text-sm leading-relaxed">
        <span className="text-neon-amber font-bold">Phantom, Solflare, Backpack — none of them need to
        know SolShield exists.</span> Browser extensions share the page context with every wallet; hooking
        into the <code className="text-neon-cyan text-xs">window.solana</code> provider is a standard,
        documented web3 pattern. Same technique used by <span className="text-fg font-semibold">Pocket Universe</span>,{' '}
        <span className="text-fg font-semibold">ScamSniffer</span>,{' '}
        <span className="text-fg font-semibold">WalletGuard</span>,{' '}
        <span className="text-fg font-semibold">Stelo</span> — all running without cooperation from MetaMask
        or Phantom.
      </p>
      <p className="text-mute text-xs mt-3 leading-relaxed">
        wallet partnerships are nice-to-have (co-marketing, native integration inside the popup), but they
        are not required to ship and protect users. publish the extension → users install → users protected.
      </p>
    </section>
  );
}

function WaitlistCTA() {
  return (
    <section className="mt-4 border border-neon-green/30 bg-neon-green/5 p-5 sm:p-6 text-center">
      <h2 className="text-neon-green text-[10px] tracking-[0.3em] uppercase font-bold mb-2">
        // extension · coming soon
      </h2>
      <p className="text-fg text-sm sm:text-base">
        the real SolShield browser extension is in development.
      </p>
      <p className="text-mute text-xs mt-2">
        follow{' '}
        <a
          href="https://github.com/0xnullpavel/solshield"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neon-cyan hover:text-neon-cyan/80 underline"
        >
          github.com/0xnullpavel/solshield
        </a>{' '}
        for updates.
      </p>
    </section>
  );
}
