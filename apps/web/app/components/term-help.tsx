'use client';

/**
 * Plain-language definitions of jargon that shows up across the UI.
 * Wrap any technical term in <TermHelp term="…">…</TermHelp> and a small
 * `(?)` indicator appears next to it; hovering reveals a one-sentence
 * explanation written for someone who's never opened a wallet.
 *
 * Keys are lowercase. Add new entries here — components don't need to
 * know about specific terms, they just pass the term and we look it up.
 */
const GLOSSARY: Record<string, string> = {
  drainer: 'a transaction designed to empty your wallet by tricking you into approving it.',
  siws: "sign-in with solana — a message a dapp asks you to sign to prove it's you. easy to fake if the wallet doesn't check.",
  permit:
    'a hidden token approval baked into a message — signing it lets someone take your tokens later without a real on-chain transaction.',
  base64:
    'a way of encoding raw bytes as text. solana transactions look like long base64 strings when you copy them.',
  spl: 'solana program library — the standard for tokens on solana (USDC, BONK, JUP, etc).',
  phishing: 'a fake site or message dressed up to look real, designed to steal your wallet or keys.',
  typosquat:
    'a domain name with a 1–2 letter typo of a real project — like jupitor.ag instead of jup.ag.',
  mainnet:
    'the real solana network where real money moves. (devnet is the fake-money version for testing.)',
  haiku:
    "anthropic's fast claude model — handles the first triage in ~200ms.",
  opus:
    "anthropic's most powerful claude model — does the deep analysis when haiku flags something as ambiguous.",
  claude: 'anthropic\'s AI model. solshield uses two of them: haiku (fast) and opus (deep).',
  rug: 'when a project or transaction takes your money and disappears.',
};

export function TermHelp({ term, children }: { term: string; children: React.ReactNode }) {
  const help = GLOSSARY[term.toLowerCase()];
  if (!help) return <>{children}</>;
  return (
    <span className="relative group inline-block">
      {children}
      <span
        className="text-neon-cyan/60 ml-0.5 cursor-help text-[0.85em] select-none"
        aria-hidden
      >
        (?)
      </span>
      <span className="sr-only">{help}</span>
      <span
        role="tooltip"
        className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 max-w-[80vw] z-50 pointer-events-none"
      >
        <span className="block bg-panel border border-neon-cyan/40 px-3 py-2 text-[11px] text-fg font-mono leading-snug shadow-lg shadow-neon-cyan/10 normal-case tracking-normal">
          {help}
        </span>
      </span>
    </span>
  );
}
