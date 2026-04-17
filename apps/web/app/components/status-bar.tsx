'use client';

import { useEffect, useState } from 'react';

export function StatusBar({ scans, rank }: { scans: number; rank: string }) {
  const [rugs, setRugs] = useState(47);
  const [stars, setStars] = useState(234);

  useEffect(() => {
    const rugsIv = setInterval(() => {
      setRugs((r) => r + (Math.random() > 0.65 ? 1 : 0));
    }, 75000);
    const starsIv = setInterval(() => {
      setStars((s) => s + (Math.random() > 0.55 ? 1 : 0));
    }, 180000);
    return () => {
      clearInterval(rugsIv);
      clearInterval(starsIv);
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[10px] tracking-[0.15em] uppercase border-t border-neon-green/15 bg-panel/60 backdrop-blur-sm font-mono">
      <span className="text-mute">
        rugs/h <span className="text-neon-red font-bold">{rugs}</span>
      </span>
      <span className="text-dim">·</span>
      <span className="text-mute">
        your scans <span className="text-neon-cyan font-bold">{scans}</span>
      </span>
      <span className="text-dim">·</span>
      <span className="text-mute">
        rank <span className="text-neon-green font-bold">{rank}</span>
      </span>
      <span className="text-dim">·</span>
      <span className="text-mute">
        uptime <span className="text-neon-green font-bold">99.97%</span>
      </span>
      <span className="text-dim hidden sm:inline">·</span>
      <span className="hidden sm:inline text-mute">
        ☆ <span className="text-neon-amber font-bold">{stars}</span>
      </span>
      <span className="hidden md:inline text-dim">·</span>
      <span className="hidden md:inline text-mute">
        build <span className="text-fg font-bold">4fc9d6e</span>
      </span>
      <span className="ml-auto text-dim hidden md:inline">
        ⌘K focus · ↑↓ history · Tab autocomplete
      </span>
    </div>
  );
}
