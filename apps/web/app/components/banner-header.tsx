'use client';

/**
 * SOLSHIELD wordmark — hand-drawn SVG outline letters.
 *
 * Each letter occupies a 50 × 60 unit cell with a 20-unit gap between letters.
 * Strokes are 2px, square-capped, fill-none — wireframe look. Drop-shadow gives
 * the green CRT glow. Everything renders as `<line>` elements in one <g> so
 * connections are pixel-perfect (the box-drawing characters in monospace fonts
 * never connect because `─` sits at cell-center while `│` runs cell-edge to
 * cell-edge — gap is unavoidable in text. SVG sidesteps the whole problem.)
 *
 * viewBox is intentionally 610 × 70 so the whole thing scales to any column
 * width via CSS — `w-full max-w-[640px]` keeps it readable on mobile.
 */
export function BannerHeader() {
  return (
    <div className="border-b border-neon-green/15 bg-bg/40 px-4 py-3 sm:py-4">
      <svg
        viewBox="0 0 610 70"
        className="block w-full max-w-[640px] mx-auto h-auto"
        style={{ filter: 'drop-shadow(0 0 6px rgba(0, 255, 65, 0.45))' }}
        role="img"
        aria-label="SolShield"
      >
        <g stroke="#00ff41" strokeWidth={2} fill="none" strokeLinecap="square">
          {/* S */}
          <line x1={0} y1={5} x2={50} y2={5} />
          <line x1={0} y1={5} x2={0} y2={35} />
          <line x1={0} y1={35} x2={50} y2={35} />
          <line x1={50} y1={35} x2={50} y2={65} />
          <line x1={0} y1={65} x2={50} y2={65} />

          {/* O */}
          <line x1={70} y1={5} x2={120} y2={5} />
          <line x1={70} y1={5} x2={70} y2={65} />
          <line x1={120} y1={5} x2={120} y2={65} />
          <line x1={70} y1={65} x2={120} y2={65} />

          {/* L */}
          <line x1={140} y1={5} x2={140} y2={65} />
          <line x1={140} y1={65} x2={190} y2={65} />

          {/* S */}
          <line x1={210} y1={5} x2={260} y2={5} />
          <line x1={210} y1={5} x2={210} y2={35} />
          <line x1={210} y1={35} x2={260} y2={35} />
          <line x1={260} y1={35} x2={260} y2={65} />
          <line x1={210} y1={65} x2={260} y2={65} />

          {/* H */}
          <line x1={280} y1={5} x2={280} y2={65} />
          <line x1={330} y1={5} x2={330} y2={65} />
          <line x1={280} y1={35} x2={330} y2={35} />

          {/* I — slightly inset top/bottom caps so it doesn't blur with H */}
          <line x1={355} y1={5} x2={395} y2={5} />
          <line x1={375} y1={5} x2={375} y2={65} />
          <line x1={355} y1={65} x2={395} y2={65} />

          {/* E — middle bar shorter than top/bottom for the classic E silhouette */}
          <line x1={420} y1={5} x2={420} y2={65} />
          <line x1={420} y1={5} x2={470} y2={5} />
          <line x1={420} y1={35} x2={460} y2={35} />
          <line x1={420} y1={65} x2={470} y2={65} />

          {/* L */}
          <line x1={490} y1={5} x2={490} y2={65} />
          <line x1={490} y1={65} x2={540} y2={65} />

          {/* D — flat left, chamfered right corners so it doesn't look like O */}
          <line x1={560} y1={5} x2={560} y2={65} />
          <line x1={560} y1={5} x2={600} y2={5} />
          <line x1={600} y1={5} x2={610} y2={15} />
          <line x1={610} y1={15} x2={610} y2={55} />
          <line x1={610} y1={55} x2={600} y2={65} />
          <line x1={560} y1={65} x2={600} y2={65} />
        </g>
      </svg>

      <p className="mt-2 sm:mt-3 text-center text-[10px] sm:text-xs tracking-[0.25em] text-neon-cyan/80 uppercase font-mono">
        // the solana firewall · paste anything · get a verdict in 200ms
      </p>
    </div>
  );
}
