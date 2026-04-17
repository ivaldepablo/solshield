import type { JSX } from 'react';

type Wallet = {
  name: string;
  src: string;
  /** Extra classes applied to the <img> (e.g. invert for black-on-white logos). */
  filter?: string;
};

// Curated set actually dropped in /public/wallets. If we ever add more PNGs/SVGs,
// append them here — they'll slot into the marquee in order.
const WALLETS: Wallet[] = [
  { name: 'Phantom', src: '/wallets/phantom.svg' },
  { name: 'Solflare', src: '/wallets/solflare.svg' },
  { name: 'Backpack', src: '/wallets/backpack.svg' },
  { name: 'Glow', src: '/wallets/glow.svg' },
  { name: 'Nightly', src: '/wallets/nightly.svg' },
  { name: 'Ledger', src: '/wallets/ledger.svg' },
  { name: 'MetaMask', src: '/wallets/metamask.svg' },
  { name: 'Brave', src: '/wallets/brave.svg' },
  { name: 'WalletConnect', src: '/wallets/walletconnect.svg' },
  { name: 'Exodus', src: '/wallets/exodus.svg' },
  { name: 'Coinbase Wallet', src: '/wallets/coinbase-wallet.svg' },
  { name: 'Trust', src: '/wallets/trust.svg' },
];

export function WalletCarousel({ speed = 40 }: { speed?: number }): JSX.Element {
  // Duplicate the list so a translateX(-50%) loop produces a seamless marquee.
  const loop = [...WALLETS, ...WALLETS];

  return (
    <section
      aria-labelledby="wallet-carousel-label"
      className="relative w-full border-y border-neon-cyan/10 bg-panel/30 py-2 font-mono"
    >
      <div className="flex items-center gap-4 px-4">
        <p
          id="wallet-carousel-label"
          className="shrink-0 text-[10px] tracking-[0.2em] text-neon-cyan/70 uppercase hidden md:block"
        >
          {'// integrates with'}
        </p>

        <div
          className="carousel group relative flex-1 overflow-hidden"
          style={{
            WebkitMaskImage:
              'linear-gradient(to right, transparent 0, black 6%, black 94%, transparent 100%)',
            maskImage:
              'linear-gradient(to right, transparent 0, black 6%, black 94%, transparent 100%)',
          }}
        >
          <div
            className="flex w-max items-center gap-8 wallet-marquee-track"
            style={{ animationDuration: `${speed}s` }}
          >
            {loop.map((w, i) => (
              <div
                key={`${w.name}-${i}`}
                className="shrink-0 flex items-center justify-center h-7 w-[64px]"
                title={w.name}
                aria-label={w.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={w.src}
                  alt={w.name}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className={[
                    'max-h-6 w-auto max-w-[56px] select-none',
                    'grayscale opacity-40 transition duration-300 ease-out',
                    'group-hover:grayscale-0 hover:!grayscale-0 hover:!opacity-100',
                    w.filter ?? '',
                  ]
                    .join(' ')
                    .trim()}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Scoped styles: keyframe + pause-on-hover. Lives here so globals.css stays clean. */}
      <style>{`
        @keyframes wallet-marquee-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .wallet-marquee-track {
          animation-name: wallet-marquee-scroll;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
          will-change: transform;
        }
        .carousel:hover .wallet-marquee-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .wallet-marquee-track { animation: none !important; transform: none !important; }
        }
      `}</style>
    </section>
  );
}
