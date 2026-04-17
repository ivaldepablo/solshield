'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const TARGET_AMOUNT = 5432;
const TARGET_USD = 4820;
const COUNTDOWN_START = 14 * 3600 + 32 * 60 + 8; // 14:32:08

interface MockWallet {
  isPhantom: boolean;
  publicKey: { toString: () => string };
  isConnected: boolean;
  signTransaction: (tx: unknown) => Promise<unknown>;
  signAllTransactions: (txs: unknown[]) => Promise<unknown[]>;
  signMessage: (msg: Uint8Array) => Promise<{ signature: Uint8Array }>;
}

type Phase = 'landing' | 'connecting' | 'connected' | 'claiming' | 'rejected' | 'signed';

const FAKE_CLAIMS = [
  { addr: '7xKj…vN8q', amount: 8200 },
  { addr: '9aBp…K3mR', amount: 4500 },
  { addr: 'DrxV…9kP1', amount: 12800 },
  { addr: '5tGc…rn3F', amount: 3200 },
  { addr: 'Hv2X…aB6y', amount: 6700 },
  { addr: 'Q1pZ…wWj4', amount: 9400 },
  { addr: 'F8nE…uK2L', amount: 2900 },
  { addr: '3kY…hJp5', amount: 11200 },
];

export default function DemoPage() {
  const [phase, setPhase] = useState<Phase>('landing');
  const [extensionDetected, setExtensionDetected] = useState<boolean | null>(null);
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [claimIdx, setClaimIdx] = useState(0);
  const originalSignMessage = useRef<MockWallet['signMessage'] | null>(null);

  // Mount stub window.solana so the extension's hook has something to wrap.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.solana) {
      // Real wallet present — we'll work with it
      const before = (w.solana as MockWallet).signMessage;
      originalSignMessage.current = before;
      setTimeout(() => {
        const after = (w.solana as MockWallet | undefined)?.signMessage;
        setExtensionDetected(after && after !== before ? true : false);
      }, 1500);
      return;
    }

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
    try {
      w.solana = mock;
      w.phantom = { solana: mock };
    } catch {
      // SES froze it; fail silently. Demo will still work for read-only flows.
    }
    originalSignMessage.current = mock.signMessage;
    setTimeout(() => {
      const after = (w.solana as MockWallet | undefined)?.signMessage;
      setExtensionDetected(after && after !== originalSignMessage.current ? true : false);
    }, 1500);
  }, []);

  // Countdown timer
  useEffect(() => {
    const id = setInterval(() => setCountdown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  // Rotating fake claims
  useEffect(() => {
    const id = setInterval(() => setClaimIdx((i) => (i + 1) % FAKE_CLAIMS.length), 2400);
    return () => clearInterval(id);
  }, []);

  const handleConnect = async () => {
    setPhase('connecting');
    await new Promise((r) => setTimeout(r, 900));
    setPhase('connected');
  };

  const handleClaim = async () => {
    setPhase('claiming');
    try {
      // Malicious SIWS: claims jup.ag, but origin is whatever this site is.
      const malicious = `phishy-jup.xyz wants you to sign in with your Solana account:\n\nURI: https://jup.ag\nNonce: a1b2c3d4e5f6g7h8\nIssued At: 2026-04-17T22:00:00Z\nAuthorize claim of ${TARGET_AMOUNT} JUP to your wallet`;
      const bytes = new TextEncoder().encode(malicious);
      const w = window as unknown as { solana: MockWallet };
      await w.solana.signMessage(bytes);
      // If we get here, the user proceeded (or extension wasn't installed)
      setPhase('signed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('reject')) {
        setPhase('rejected');
      } else {
        setPhase('rejected');
      }
    }
  };

  const formatCountdown = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a0a1a] via-[#0f0a1a] to-[#0a0a0f] text-white">
      <SolshieldRibbon detected={extensionDetected} />
      <FakeBrowserChrome />

      {phase === 'landing' && (
        <Landing onConnect={handleConnect} countdown={formatCountdown(countdown)} claimIdx={claimIdx} />
      )}
      {phase === 'connecting' && <ConnectingScreen />}
      {phase === 'connected' && (
        <ClaimScreen onClaim={handleClaim} countdown={formatCountdown(countdown)} />
      )}
      {phase === 'claiming' && <ClaimingScreen />}
      {phase === 'rejected' && <Saved onRetry={() => setPhase('landing')} />}
      {phase === 'signed' && <Drained onRetry={() => setPhase('landing')} />}
    </div>
  );
}

// ─── Top ribbon: meta UI from SolShield itself, breaking the 4th wall ───
function SolshieldRibbon({ detected }: { detected: boolean | null }) {
  return (
    <div className="bg-bg border-b border-neon-green/30 px-3 py-1.5 text-[11px] tracking-[0.15em] uppercase font-mono flex items-center justify-between">
      <Link href="/" className="text-neon-green hover:text-neon-cyan">
        ◂ back to solshield.dev
      </Link>
      <div className="text-mute text-[10px]">
        // this is a fake scam clone for demonstration. nothing here is real.
      </div>
      <div className="flex items-center gap-2">
        {detected === true && (
          <span className="text-neon-green">✓ extension active</span>
        )}
        {detected === false && (
          <span className="text-neon-red">✗ extension not installed</span>
        )}
        {detected === null && <span className="text-mute">…</span>}
      </div>
    </div>
  );
}

// ─── Fake URL bar to make the spoof feel real ───
function FakeBrowserChrome() {
  return (
    <div className="bg-[#202020] border-b border-black/40 px-3 py-2 flex items-center gap-2">
      <div className="flex gap-1.5">
        <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
        <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
        <span className="w-3 h-3 rounded-full bg-[#28c840]" />
      </div>
      <div className="ml-3 flex-1 max-w-2xl bg-[#3a3a3a] rounded-md px-3 py-1.5 flex items-center gap-2 text-xs">
        <span className="text-[#ff6b6b]">⚠</span>
        <span className="text-[#ccc] font-mono">https://</span>
        <span className="text-white font-mono font-bold">jupitor-claim.io</span>
        <span className="text-[#888] font-mono">/airdrop/phase3</span>
      </div>
    </div>
  );
}

// ─── Landing: looks like a real airdrop scam ───
function Landing({
  onConnect,
  countdown,
  claimIdx,
}: {
  onConnect: () => void;
  countdown: string;
  claimIdx: number;
}) {
  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      {/* Top brand bar */}
      <div className="flex items-center justify-between mb-12">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🪐</span>
          <div>
            <div className="text-xl font-bold">JUPITER</div>
            <div className="text-[10px] tracking-[0.3em] text-[#a0a0c0] uppercase">
              official airdrop portal
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-[#a0a0c0]">
          <span>Docs</span>
          <span>Stats</span>
          <span className="text-[#ffc36b]">⏰ Phase 3 ends in {countdown}</span>
        </div>
      </div>

      {/* Hero */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="inline-block px-3 py-1 bg-gradient-to-r from-orange-500 to-red-500 rounded-full text-xs font-bold mb-4 animate-pulse">
            🔥 LIVE · LAST CHANCE
          </div>

          <h1 className="text-4xl sm:text-6xl font-bold leading-tight mb-3">
            You&apos;re eligible
            <br />
            for the JUP airdrop.
          </h1>

          <p className="text-[#a0a0c0] text-lg mb-8 max-w-lg">
            Phase 3 is live for verified Solana wallets. Connect your wallet to confirm
            eligibility and claim your tokens before the deadline.
          </p>

          <div className="bg-black/40 border border-[#3a3a5a] rounded-2xl p-6 mb-6">
            <div className="text-[#a0a0c0] text-xs uppercase tracking-wider mb-2">
              Your allocation
            </div>
            <div className="flex items-baseline gap-3 mb-1">
              <span className="text-5xl sm:text-6xl font-bold text-white">
                {TARGET_AMOUNT.toLocaleString()}
              </span>
              <span className="text-2xl text-[#a0a0c0] font-bold">JUP</span>
            </div>
            <div className="text-[#7ce47c] text-lg">≈ ${TARGET_USD.toLocaleString()} USD</div>
          </div>

          <button
            type="button"
            onClick={onConnect}
            className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold text-lg rounded-xl transition-all shadow-2xl shadow-purple-500/40 active:scale-95"
          >
            Connect Wallet to Claim →
          </button>

          <p className="text-[#666] text-xs mt-3">
            By connecting your wallet you agree to the JUP claim terms.
          </p>
        </div>

        {/* Recent claims sidebar */}
        <aside className="bg-black/30 border border-[#3a3a5a] rounded-2xl p-5 h-fit">
          <div className="text-[#a0a0c0] text-xs uppercase tracking-wider mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Recent claims
          </div>
          <div className="space-y-2 text-sm font-mono">
            {FAKE_CLAIMS.map((c, i) => {
              const offset = (i - claimIdx + FAKE_CLAIMS.length) % FAKE_CLAIMS.length;
              const opacity = Math.max(0.25, 1 - offset * 0.15);
              return (
                <div
                  key={i}
                  style={{ opacity }}
                  className="flex justify-between items-center py-1.5 border-b border-white/5 last:border-0"
                >
                  <span className="text-[#a0a0c0]">{c.addr}</span>
                  <span className="text-[#7ce47c] font-bold">
                    +{c.amount.toLocaleString()} JUP
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-4 border-t border-white/10 text-center text-[10px] text-[#666]">
            12,847 wallets claimed today
          </div>
        </aside>
      </div>
    </main>
  );
}

function ConnectingScreen() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-24 text-center">
      <div className="inline-block w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-8" />
      <h2 className="text-2xl font-bold mb-2">Connecting to your wallet…</h2>
      <p className="text-[#a0a0c0]">Approve the connection in the popup.</p>
    </main>
  );
}

function ClaimScreen({ onClaim, countdown }: { onClaim: () => void; countdown: string }) {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12 text-center">
      <div className="inline-block px-4 py-1.5 bg-green-500/20 text-green-400 rounded-full text-sm font-bold mb-6">
        ✓ Wallet connected
      </div>
      <h2 className="text-3xl sm:text-5xl font-bold mb-4">Last step.</h2>
      <p className="text-[#a0a0c0] text-lg mb-8 max-w-lg mx-auto">
        Sign the claim message to receive your{' '}
        <span className="text-white font-bold">{TARGET_AMOUNT.toLocaleString()} JUP</span>.
        This is free — gas is sponsored.
      </p>

      <div className="bg-black/40 border border-orange-500/50 rounded-2xl p-6 mb-8 max-w-md mx-auto text-left">
        <div className="flex items-center gap-2 text-orange-400 text-sm mb-2">
          <span>⏰</span>
          <span className="font-bold">Hurry — Phase 3 ends in {countdown}</span>
        </div>
        <div className="text-[#a0a0c0] text-xs">
          After the deadline, unclaimed tokens return to the treasury and your eligibility
          expires.
        </div>
      </div>

      <button
        type="button"
        onClick={onClaim}
        className="w-full sm:w-auto px-12 py-5 bg-gradient-to-r from-orange-500 via-red-500 to-pink-600 hover:brightness-110 text-white font-bold text-xl rounded-xl transition-all shadow-2xl shadow-orange-500/50 active:scale-95"
      >
        Claim {TARGET_AMOUNT.toLocaleString()} JUP →
      </button>

      <p className="text-[#666] text-xs mt-4">
        You&apos;ll be asked to sign a free message to verify wallet ownership.
      </p>
    </main>
  );
}

function ClaimingScreen() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-24 text-center">
      <div className="inline-block w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-8" />
      <h2 className="text-2xl font-bold mb-2">Sign the message in your wallet…</h2>
      <p className="text-[#a0a0c0]">Approve to receive your tokens.</p>
    </main>
  );
}

function Saved({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <div className="border-2 border-neon-green bg-neon-green/10 rounded-2xl p-8 sm:p-12 text-center font-mono">
        <div className="text-7xl mb-4">🛡</div>
        <h2 className="text-3xl sm:text-4xl font-bold text-neon-green mb-3">
          SolShield blocked it.
        </h2>
        <p className="text-fg text-lg mb-6">
          Without SolShield, you would have just signed away access to{' '}
          <span className="text-neon-red font-bold">${TARGET_USD.toLocaleString()}</span> in
          tokens.
        </p>

        <div className="bg-black/40 border border-neon-green/30 rounded-xl p-5 text-left mb-6">
          <div className="text-neon-cyan text-[10px] tracking-[0.25em] uppercase mb-3">
            // what was wrong
          </div>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-3">
              <span className="text-neon-red">✗</span>
              <span>
                The site URL was{' '}
                <code className="text-neon-amber">jupitor-claim.io</code> — Jupiter&apos;s
                real domain is <code className="text-neon-green">jup.ag</code>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-neon-red">✗</span>
              <span>
                The sign-in message claimed to be from{' '}
                <code className="text-neon-green">jup.ag</code> while the page origin was
                actually{' '}
                <code className="text-neon-red">phishy-jup.xyz</code>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-neon-red">✗</span>
              <span>
                Pressuring countdown + fake recent-claims feed are textbook scam patterns
              </span>
            </li>
          </ul>
        </div>

        <button
          type="button"
          onClick={onRetry}
          className="px-6 py-3 border border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10 transition-colors font-bold tracking-[0.15em] uppercase text-sm"
        >
          ↻ try again
        </button>
      </div>

      <p className="text-center text-mute text-xs mt-6 font-mono">
        // this scam is fake. real ones use the same playbook.{' '}
        <Link href="/" className="text-neon-cyan hover:underline">
          install SolShield to be protected
        </Link>
      </p>
    </main>
  );
}

function Drained({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <div className="border-2 border-neon-red bg-neon-red/10 rounded-2xl p-8 sm:p-12 text-center font-mono">
        <div className="text-7xl mb-4">☠</div>
        <h2 className="text-3xl sm:text-4xl font-bold text-neon-red mb-3">
          You just got drained.
        </h2>
        <p className="text-fg text-lg mb-6">
          In real life, your wallet would now be empty. The signature you just approved
          gave the attacker permission to drain your tokens.
        </p>
        <p className="text-fg text-base mb-6">
          Don&apos;t worry, <strong>this scam is fake</strong> — you&apos;re still safe. But
          this is exactly how real Solana drainers work today.
        </p>
        <div className="border border-neon-red/30 rounded-xl p-5 mb-6">
          <p className="text-neon-amber font-bold mb-2">Estimated loss:</p>
          <p className="text-3xl text-neon-red font-bold">${TARGET_USD.toLocaleString()}+</p>
          <p className="text-mute text-xs mt-1">(plus any other tokens in your wallet)</p>
        </div>
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-neon-green text-bg font-bold tracking-[0.15em] uppercase text-sm hover:bg-neon-green/90 transition-colors"
        >
          install SolShield →
        </Link>
        <button
          type="button"
          onClick={onRetry}
          className="ml-3 px-6 py-3 border border-mute text-mute hover:text-fg transition-colors font-bold tracking-[0.15em] uppercase text-sm"
        >
          ↻ try again
        </button>
      </div>
    </main>
  );
}
