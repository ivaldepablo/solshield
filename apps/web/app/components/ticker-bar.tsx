'use client';

import { useEffect, useState } from 'react';

export function TickerBar() {
  const [drainers, setDrainers] = useState(847);
  const [scanned, setScanned] = useState(12304);
  const [solKept, setSolKept] = useState(3.2);
  const [lastThreat, setLastThreat] = useState(23);

  useEffect(() => {
    const scannedIv = setInterval(() => {
      setScanned((s) => s + Math.floor(1 + Math.random() * 3));
    }, 5000);
    const drainersIv = setInterval(() => {
      setDrainers((d) => d + 1);
    }, 32000 + Math.random() * 30000);
    const solIv = setInterval(() => {
      setSolKept((s) => +(s + 0.02 + Math.random() * 0.08).toFixed(2));
    }, 25000);
    const threatTickIv = setInterval(() => {
      setLastThreat((t) => t + 1);
    }, 1000);
    const threatResetIv = setInterval(() => {
      setLastThreat(0);
    }, 45000 + Math.random() * 60000);
    return () => {
      clearInterval(scannedIv);
      clearInterval(drainersIv);
      clearInterval(solIv);
      clearInterval(threatTickIv);
      clearInterval(threatResetIv);
    };
  }, []);

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-[10px] sm:text-[11px] tracking-[0.1em] uppercase border-b border-neon-green/15 bg-panel/40 backdrop-blur-sm overflow-x-auto whitespace-nowrap font-mono">
      <span className="text-neon-green flex items-center gap-1.5 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-neon-red animate-pulse" />
        LIVE
      </span>
      <span className="text-dim shrink-0">·</span>
      <span className="shrink-0">
        <span className="text-neon-red font-bold">{drainers}</span>{' '}
        <span className="text-mute">anons saved today</span>
      </span>
      <span className="text-dim shrink-0">·</span>
      <span className="shrink-0">
        <span className="text-neon-cyan font-bold">{scanned.toLocaleString()}</span>{' '}
        <span className="text-mute">tx scanned</span>
      </span>
      <span className="text-dim shrink-0">·</span>
      <span className="shrink-0">
        <span className="text-neon-green font-bold">{solKept.toFixed(2)} SOL</span>{' '}
        <span className="text-mute">kept from rugs</span>
      </span>
      <span className="text-dim shrink-0">·</span>
      <span className="shrink-0 text-mute">
        last rug blocked{' '}
        <span className="text-neon-amber font-bold">{lastThreat}s</span> ago
      </span>
    </div>
  );
}
