'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ThreatReport } from '@solshield/core';

type LineColor = 'green' | 'cyan' | 'amber' | 'red' | 'mute' | 'fg' | 'dim' | 'white';

// -------- shared types consumed by the inspector panel --------

export type VerdictKind = 'tx' | 'msg' | 'domain';

export interface VerdictView {
  kind: VerdictKind;
  verdict: 'safe' | 'suspicious' | 'danger';
  score: number;
  summary: string;
  findings: Array<{
    severity: 'low' | 'medium' | 'high' | 'critical';
    ruleId: string;
    message: string;
  }>;
  elapsedMs?: number;
  /** model lineage that produced this verdict, e.g. ['haiku 4.5'] or ['haiku 4.5', 'opus 4.7'] */
  models: string[];
  /** monotonically increasing — used by the inspector to animate when a fresh verdict lands */
  startedAt: number;
}

export interface TerminalHandle {
  /** programmatically run a command as if the user typed it */
  execute: (cmd: string) => void;
}

interface Line {
  color: LineColor;
  text: string;
  prompt?: boolean;
  /** extra classes appended to the line — used by the boot banner to clamp line-height */
  cls?: string;
}

const LINE_CLS: Record<LineColor, string> = {
  green: 'text-neon-green',
  cyan: 'text-neon-cyan',
  amber: 'text-neon-amber',
  red: 'text-neon-red',
  mute: 'text-mute',
  fg: 'text-fg',
  dim: 'text-dim',
  white: 'text-fg font-bold',
};

type Theme = 'matrix' | 'amber' | 'cyan';
export type Rank = 'NOVICE' | 'OPERATOR' | 'ADMIN';

const RULE_CATALOG: Array<{
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  color: LineColor;
  seen: number;
  cveId: string;
  description: string;
}> = [
  { id: 'unlimited-spl-approval', severity: 'high', color: 'red', seen: 847, cveId: 'SS-2026-0001', description: 'SPL approval set to u64::MAX or impractically high. classic drainer move. they get all your USDC.' },
  { id: 'mint-authority-transfer', severity: 'critical', color: 'red', seen: 234, cveId: 'SS-2026-0002', description: 'mint authority changing to unknown program. they can mint infinite supply of your token.' },
  { id: 'mass-token-drain', severity: 'critical', color: 'red', seen: 612, cveId: 'SS-2026-0003', description: 'multiple token transfers converging on a single non-signer address. you getting rugged bro.' },
  { id: 'upgrade-authority-set', severity: 'critical', color: 'red', seen: 89, cveId: 'SS-2026-0004', description: 'program upgrade authority changing hands. whoever controls upgrade can replace the program.' },
  { id: 'hidden-sol-transfer', severity: 'high', color: 'red', seen: 423, cveId: 'SS-2026-0005', description: 'SOL transferring to non-signer. not disclosed in wallet UI. classic hidden instruction.' },
  { id: 'spl-account-owner-change', severity: 'critical', color: 'red', seen: 156, cveId: 'SS-2026-0006', description: 'SPL token account owner rewritten. they become the new owner of your tokens.' },
  { id: 'close-token-account-to-attacker', severity: 'high', color: 'red', seen: 278, cveId: 'SS-2026-0007', description: 'token account closure redirecting rent (~0.002 SOL per) to non-signer.' },
  { id: 'token-freeze-abuse', severity: 'high', color: 'red', seen: 67, cveId: 'SS-2026-0008', description: 'freeze authority invoked. locks your tokens. you cant move them.' },
  { id: 'stake-authority-hijack', severity: 'critical', color: 'red', seen: 43, cveId: 'SS-2026-0009', description: 'stake account authority (withdraw/staker) stolen. they can unstake and withdraw your SOL.' },
  { id: 'memo-exfiltration', severity: 'low', color: 'amber', seen: 912, cveId: 'SS-2026-0010', description: 'memo contains base58 matching known drainer signatures. c2 comms or taunt.' },
  { id: 'compute-budget-anomaly', severity: 'low', color: 'cyan', seen: 2341, cveId: 'SS-2026-0011', description: 'compute budget suspiciously high. might indicate hidden MEV or spam.' },
  { id: 'multisig-cosigner-manipulation', severity: 'critical', color: 'red', seen: 21, cveId: 'SS-2026-0012', description: 'multisig config changed to remove cosigners or lower threshold. full takeover vector.' },
  { id: 'simulated-signer-drain', severity: 'critical', color: 'red', seen: 389, cveId: 'SS-2026-0013', description: 'simulation: signer balance drops >90% with no matching asset received. wallet getting cleaned.' },
  { id: 'simulated-token-wipe', severity: 'high', color: 'red', seen: 267, cveId: 'SS-2026-0014', description: 'simulation: multiple token balances zeroed out. rug is live.' },
  { id: 'simulation-failure', severity: 'low', color: 'amber', seen: 1847, cveId: 'SS-2026-0015', description: 'tx fails simulation. could be anti-detection (flash-decrypt) or malformed. treat with suspicion.' },
];

const MOCK_FEED: Array<{ age: number; tag: string; color: LineColor; rule: string; msg: string }> = [
  { age: 3, tag: 'BLOCK', color: 'red', rule: 'unlimited-spl-approval', msg: 'blocked at 7xKX...Jjng' },
  { age: 12, tag: 'BLOCK', color: 'red', rule: 'mass-token-drain', msg: '3 transfers → DrxVn...9kP' },
  { age: 34, tag: 'WARN', color: 'amber', rule: 'mint-authority-transfer', msg: 'new authority on 5tG...rn3' },
  { age: 47, tag: 'SAFE', color: 'green', rule: 'routine-swap', msg: 'jupiter v6 passthrough ok' },
  { age: 58, tag: 'BLOCK', color: 'red', rule: 'simulated-signer-drain', msg: '4.2 SOL (100% balance)' },
  { age: 82, tag: 'BLOCK', color: 'red', rule: 'close-token-account-to-attacker', msg: 'rent redirected' },
  { age: 103, tag: 'WARN', color: 'amber', rule: 'upgrade-authority-set', msg: 'new program maintainer' },
  { age: 127, tag: 'SAFE', color: 'green', rule: 'stake-delegation', msg: 'validator 8xj...QKm ok' },
];

const MOCK_REPORTS: Record<'safe' | 'danger', ThreatReport> = {
  safe: {
    verdict: 'safe',
    score: 8,
    summary: 'routine jupiter v6 swap. no suspicious patterns.',
    findings: [],
    elapsedMs: 42,
  },
  danger: {
    verdict: 'danger',
    score: 94,
    summary: 'drainer pattern: unlimited approval + hidden sol transfer to non-signer.',
    findings: [
      { severity: 'critical', ruleId: 'unlimited-spl-approval', message: 'USDC approval → u64::MAX for unknown delegate.' },
      { severity: 'high', ruleId: 'hidden-sol-transfer', message: '4.2 SOL routed to 7xKX...Jjng (not signer).' },
      { severity: 'medium', ruleId: 'memo-exfiltration', message: 'memo contains known drainer signature.' },
    ],
    elapsedMs: 78,
  },
};

function randomHex() {
  return Math.random().toString(16).slice(2, 8);
}

function relativeAgo(s: number): string {
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

interface Ctx {
  push: (line: Line) => void;
  wait: (ms: number) => Promise<void>;
  setTheme: (t: Theme) => void;
  clearLines: () => void;
  /** publish a verdict to the inspector panel — null clears it */
  emitVerdict: (v: VerdictView | null) => void;
}

type Handler = (args: string[], ctx: Ctx) => Promise<void> | void;

async function cmdHelp(_args: string[], ctx: Ctx): Promise<void> {
  const out: Array<[LineColor, string]> = [
    ['mute', '== survival commands =='],
    ['fg', '  scan <base64>     check if a tx will rug you'],
    ['fg', '  msg <text>        scan a signed message (siws, permit, etc)'],
    ['fg', '  domain <url>      check a dapp domain for phishing'],
    ['fg', '  demo <kind>       run example · safe | drainer'],
    ['fg', '  rules             15 ways solshield catches drainers'],
    ['fg', '  rules <id>        details on a rule'],
    ['fg', '  feed              live mainnet blocks'],
    ['fg', ''],
    ['mute', '== intel =='],
    ['fg', '  whoami            your operator profile'],
    ['fg', '  blowfish          why solshield exists'],
    ['fg', '  manifesto         read it. carefully.'],
    ['fg', '  compare           solshield vs blowfish'],
    ['fg', '  wallets           compatible wallet list'],
    ['fg', '  pricing           $0. stop asking.'],
    ['fg', '  docs              sdk & github'],
    ['fg', ''],
    ['mute', '== system =='],
    ['fg', '  theme <name>      matrix | amber | cyan'],
    ['fg', '  clear             clear screen'],
    ['fg', '  version           build info'],
    ['fg', ''],
    ['dim', '↑↓ history · Tab autocomplete · ⌘K focus'],
    ['green', "gm anon. don't click sus links. dyor."],
  ];
  for (const [color, text] of out) ctx.push({ color, text });
}

function cmdClear(_args: string[], ctx: Ctx): void {
  ctx.clearLines();
}

function cmdVersion(_args: string[], ctx: Ctx): void {
  ctx.push({ color: 'cyan', text: 'solshield 0.1.0-alpha' });
  ctx.push({ color: 'mute', text: 'build 4fc9d6e · mainnet · 15 rules · claude haiku 4.5 + opus 4.7' });
  ctx.push({ color: 'dim', text: 'self-hosted · hetzner ashburn · apache 2.0' });
}

function cmdWhoami(_args: string[], ctx: Ctx): void {
  ctx.push({ color: 'cyan', text: '== OPERATOR PROFILE ==' });
  ctx.push({ color: 'fg', text: `  handle   operator_${randomHex()}` });
  ctx.push({ color: 'fg', text: `  rank     NOVICE` });
  ctx.push({ color: 'fg', text: `  session  #${Math.floor(3800 + Math.random() * 200)}` });
  ctx.push({ color: 'fg', text: `  ip       [redacted · hashed]` });
  ctx.push({ color: 'fg', text: `  wallet   not connected (good)` });
  ctx.push({ color: 'amber', text: `  alpha    312/500 operators active` });
  ctx.push({ color: 'dim', text: 'rank up by running more commands. wagmi.' });
}

async function cmdBlowfish(_args: string[], ctx: Ctx): Promise<void> {
  const out: Array<[LineColor, string, number]> = [
    ['mute', '== context ==', 60],
    ['fg', 'blowfish was OG.', 180],
    ['fg', 'raised $11.8M from paradigm · sept 2022.', 100],
    ['fg', '', 100],
    ['amber', 'phantom acquired them · nov 2024.', 280],
    ['fg', '', 100],
    ['fg', 'now phantom owns the security layer that', 150],
    ['fg', 'metamask, backpack, solflare, exodus depend on.', 150],
    ['fg', '', 150],
    ['red', 'conflict of interest?     yes.', 200],
    ['red', 'are wallets stuck?         for now.', 200],
    ['fg', '', 200],
    ['green', 'solshield is the open alternative.', 200],
    ['cyan', 'fork-friendly · vendor-neutral · no token ever.', 150],
    ['fg', '', 150],
    ['amber', 'anon · would you trust your bag', 150],
    ['amber', "to a competitor's product?", 150],
  ];
  for (const [color, text, delay] of out) {
    ctx.push({ color, text });
    await ctx.wait(delay);
  }
}

async function cmdManifesto(_args: string[], ctx: Ctx): Promise<void> {
  const out: Array<[LineColor, string]> = [
    ['mute', '== // MANIFESTO =='],
    ['fg', ''],
    ['fg', 'wallet security on solana is thin.'],
    ['fg', 'when anon clicks approve, a signature grants'],
    ['fg', 'the requested op with almost zero context.'],
    ['fg', ''],
    ['fg', "blockaid & blowfish solve part of this."],
    ['fg', "but they're closed source. pay-walled."],
    ['fg', 'and blowfish belongs to phantom now.'],
    ['fg', ''],
    ['fg', 'if you want to know WHY a tx was flagged:'],
    ['fg', 'too bad. the rules are behind an API.'],
    ['fg', ''],
    ['green', 'solshield is the open alternative.'],
    ['green', 'every rule auditable. every prompt public.'],
    ['green', 'the day a new drainer hits mainnet:'],
    ['green', 'anyone can push a signature. no gatekeeping.'],
    ['fg', ''],
    ['white', 'no token ever.'],
    ['white', 'no VC.'],
    ['white', 'no acquisition ambitions.'],
    ['fg', ''],
    ['cyan', 'just code · claude AI · and anons.'],
    ['fg', ''],
    ['amber', "gm. wagmi. don't get rekt."],
  ];
  for (const [color, text] of out) {
    ctx.push({ color, text });
    await ctx.wait(35);
  }
}

function cmdPricing(_args: string[], ctx: Ctx): void {
  ctx.push({ color: 'green', text: '$0/mo · forever.' });
  ctx.push({ color: 'fg', text: '' });
  ctx.push({ color: 'fg', text: 'self-host.' });
  ctx.push({ color: 'fg', text: 'fork it.' });
  ctx.push({ color: 'fg', text: 'no bullshit.' });
  ctx.push({ color: 'fg', text: 'no demo call.' });
  ctx.push({ color: 'fg', text: 'no credit card.' });
  ctx.push({ color: 'fg', text: 'no seat limits.' });
  ctx.push({ color: 'fg', text: "no 'contact sales'." });
  ctx.push({ color: 'fg', text: 'no rug pull on pricing v2.' });
  ctx.push({ color: 'fg', text: '' });
  ctx.push({ color: 'dim', text: 'what do you want from me anon.' });
}

function cmdDocs(_args: string[], ctx: Ctx): void {
  ctx.push({ color: 'cyan', text: '$ npm install @solshield/sdk' });
  ctx.push({ color: 'dim', text: '  (publishing with alpha 0.2)' });
  ctx.push({ color: 'fg', text: '' });
  ctx.push({ color: 'green', text: '▸ github.com/0xnullpavel/solshield' });
  ctx.push({ color: 'green', text: '▸ docs.solshield.dev  (soon)' });
  ctx.push({ color: 'green', text: '▸ @solshield on x  (soon)' });
  ctx.push({ color: 'fg', text: '' });
  ctx.push({ color: 'amber', text: 'contributions: open. PRs welcome.' });
  ctx.push({ color: 'amber', text: 'security: security@solshield.dev' });
}

function cmdCompare(_args: string[], ctx: Ctx): void {
  ctx.push({ color: 'mute', text: '                     solshield           blowfish' });
  ctx.push({ color: 'mute', text: '                     ─────────           ────────' });
  ctx.push({ color: 'fg', text: '  open source         ✓ apache 2.0        ✗ closed' });
  ctx.push({ color: 'fg', text: '  auditable rules     ✓ in git            ✗ api only' });
  ctx.push({ color: 'fg', text: '  AI-powered          ✓ haiku+opus        ~ rules + ml' });
  ctx.push({ color: 'fg', text: '  self-hostable       ✓ docker            ✗ saas' });
  ctx.push({ color: 'fg', text: '  vendor-neutral      ✓                   ✗ phantom-owned' });
  ctx.push({ color: 'fg', text: '  fork-able           ✓                   ✗' });
  ctx.push({ color: 'fg', text: '  token-free          ✓ ever              ✓' });
  ctx.push({ color: 'fg', text: '  chains              solana-native       10+' });
  ctx.push({ color: 'fg', text: '  maturity            alpha               production' });
  ctx.push({ color: 'fg', text: '  funding             $0                  $11.8M paradigm' });
  ctx.push({ color: 'fg', text: '' });
  ctx.push({ color: 'cyan', text: 'tldr: depth > breadth. independence > polish.' });
}

function cmdTheme(args: string[], ctx: Ctx): void {
  const t = args[0] as Theme;
  if (!['matrix', 'amber', 'cyan'].includes(t)) {
    ctx.push({ color: 'red', text: 'theme not found. options: matrix | amber | cyan' });
    return;
  }
  ctx.setTheme(t);
  ctx.push({ color: 'green', text: `theme: ${t}` });
}

function printVerdict(report: ThreatReport, ctx: Ctx) {
  ctx.push({ color: 'fg', text: '' });
  if (report.verdict === 'safe') {
    ctx.push({ color: 'green', text: '╔═════════════════════════════════════════╗' });
    ctx.push({ color: 'green', text: `║  ✓  SAFE · PROCEED         ${String(report.score).padStart(2, '0')} /100  ║` });
    ctx.push({ color: 'green', text: '╚═════════════════════════════════════════╝' });
  } else if (report.verdict === 'suspicious') {
    ctx.push({ color: 'amber', text: '╔═════════════════════════════════════════╗' });
    ctx.push({ color: 'amber', text: `║  ⚠  SUSPICIOUS · REVIEW    ${String(report.score).padStart(2, '0')} /100  ║` });
    ctx.push({ color: 'amber', text: '╚═════════════════════════════════════════╝' });
  } else {
    ctx.push({ color: 'red', text: '       ___' });
    ctx.push({ color: 'red', text: '     .\'   `.' });
    ctx.push({ color: 'red', text: '    / /^\\ \\    ╔═══════════════════════════╗' });
    ctx.push({ color: 'red', text: '   |  \\_/  |   ║ ☠  DRAIN · DO NOT SIGN   ║' });
    ctx.push({ color: 'red', text: "    \\  -  /    ║        " + String(report.score).padStart(2, '0') + " / 100           ║" });
    ctx.push({ color: 'red', text: "     `---\'     ╚═══════════════════════════╝" });
  }
  ctx.push({ color: 'fg', text: '' });
  ctx.push({
    color: 'dim',
    text: `claude haiku 4.5${report.verdict !== 'safe' ? ' → opus 4.7' : ''} · ${report.elapsedMs}ms · ${report.findings.length} findings`,
  });
  if (report.verdict === 'danger') {
    ctx.push({ color: 'amber', text: "anon, you would've lost 4.2 SOL + all usdc. you're welcome." });
  } else if (report.verdict === 'safe') {
    ctx.push({ color: 'green', text: 'wagmi. proceed with the sign.' });
  }
}

async function cmdDemo(args: string[], ctx: Ctx): Promise<void> {
  const raw = args[0];
  const kind: 'safe' | 'danger' | null = raw === 'drainer' ? 'danger' : raw === 'safe' ? 'safe' : null;
  if (!kind) {
    ctx.push({ color: 'red', text: 'usage: demo <safe|drainer>' });
    return;
  }
  const mock = MOCK_REPORTS[kind];
  ctx.push({ color: 'green', text: '[INIT] decoding wire format...' });
  await ctx.wait(140);
  ctx.push({ color: 'cyan', text: '[RULES] 15 static detectors · running...' });
  await ctx.wait(180);
  ctx.push({ color: 'cyan', text: '[AI] claude haiku 4.5 · triaging...' });
  await ctx.wait(220);
  const models: string[] = ['haiku 4.5'];
  if (kind === 'danger') {
    ctx.push({ color: 'amber', text: '[AI] ambiguous · escalating to opus 4.7...' });
    await ctx.wait(280);
    models.push('opus 4.7');
  }
  for (const f of mock.findings) {
    const sev = f.severity.toUpperCase();
    const tag = sev === 'CRITICAL' || sev === 'HIGH' ? 'ALERT' : sev === 'MEDIUM' ? 'WARN' : 'INFO';
    const color: LineColor = sev === 'CRITICAL' || sev === 'HIGH' ? 'red' : sev === 'MEDIUM' ? 'amber' : 'cyan';
    ctx.push({ color, text: `[${tag}] ${f.ruleId} — ${f.message}` });
    await ctx.wait(160);
  }
  printVerdict(mock, ctx);
  ctx.emitVerdict({
    kind: 'tx',
    verdict: mock.verdict,
    score: mock.score,
    summary: mock.summary,
    findings: mock.findings,
    elapsedMs: mock.elapsedMs,
    models,
    startedAt: Date.now(),
  });
}

async function cmdRules(args: string[], ctx: Ctx): Promise<void> {
  if (args.length === 0) {
    ctx.push({ color: 'mute', text: '== 15 detection rules · seen last 24h ==' });
    ctx.push({ color: 'fg', text: '' });
    for (const r of RULE_CATALOG) {
      ctx.push({
        color: r.color,
        text: `  ${r.id.padEnd(36)} ${r.severity.toUpperCase().padEnd(9)} ${String(r.seen).padStart(5)}×`,
      });
    }
    ctx.push({ color: 'fg', text: '' });
    ctx.push({ color: 'dim', text: 'rules <id> for details · e.g. "rules unlimited-spl-approval"' });
    return;
  }
  const query = args[0]!.toLowerCase();
  const rule = RULE_CATALOG.find((r) => r.id === query || r.id.includes(query));
  if (!rule) {
    ctx.push({ color: 'red', text: `rule not found: ${args[0]}` });
    ctx.push({ color: 'dim', text: 'run "rules" for catalog.' });
    return;
  }
  ctx.push({ color: rule.color, text: `== ${rule.id} ==` });
  ctx.push({ color: 'fg', text: `  severity   ${rule.severity}` });
  ctx.push({ color: 'fg', text: `  cve-id     ${rule.cveId}` });
  ctx.push({ color: 'fg', text: `  seen       ${rule.seen}× in last 24h` });
  ctx.push({ color: 'fg', text: '' });
  ctx.push({ color: 'fg', text: rule.description });
}

function cmdFeed(_args: string[], ctx: Ctx): void {
  ctx.push({ color: 'mute', text: '== live · mainnet · last 60s ==' });
  ctx.push({ color: 'fg', text: '' });
  for (const entry of MOCK_FEED) {
    ctx.push({
      color: entry.color,
      text: `  [${relativeAgo(entry.age).padEnd(7)}]  ${entry.tag.padEnd(6)} ${entry.rule.padEnd(34)} → ${entry.msg}`,
    });
  }
  ctx.push({ color: 'fg', text: '' });
  ctx.push({ color: 'dim', text: '☝ mock preview. real feed lands in alpha 0.2.' });
}

async function cmdScan(args: string[], ctx: Ctx): Promise<void> {
  const tx = args.join(' ').trim();
  if (!tx) {
    ctx.push({ color: 'red', text: 'usage: scan <base64 unsigned tx>' });
    ctx.push({ color: 'dim', text: 'no tx handy? try: demo drainer' });
    return;
  }
  ctx.push({ color: 'green', text: '[INIT] decoding solana wire format...' });
  await ctx.wait(140);
  ctx.push({ color: 'cyan', text: '[RULES] 15 static detectors · running...' });
  await ctx.wait(180);
  ctx.push({ color: 'cyan', text: '[AI] claude haiku 4.5 · triaging...' });
  try {
    const res = await fetch('/api/inspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tx, encoding: 'base64' }),
    });
    const body = (await res.json()) as ThreatReport & { error?: string };
    if (!res.ok || body.error) {
      ctx.push({ color: 'red', text: `[ERROR] ${body.error ?? `HTTP ${res.status}`}` });
      return;
    }
    for (const f of body.findings) {
      const sev = f.severity.toUpperCase();
      const tag = sev === 'CRITICAL' || sev === 'HIGH' ? 'ALERT' : sev === 'MEDIUM' ? 'WARN' : 'INFO';
      const color: LineColor = sev === 'CRITICAL' || sev === 'HIGH' ? 'red' : sev === 'MEDIUM' ? 'amber' : 'cyan';
      ctx.push({ color, text: `[${tag}] ${f.ruleId} — ${f.message}` });
      await ctx.wait(120);
    }
    printVerdict(body, ctx);
    ctx.emitVerdict({
      kind: 'tx',
      verdict: body.verdict,
      score: body.score,
      summary: body.summary,
      findings: body.findings,
      elapsedMs: body.elapsedMs,
      models: body.verdict === 'safe' ? ['haiku 4.5'] : ['haiku 4.5', 'opus 4.7'],
      startedAt: Date.now(),
    });
  } catch (err) {
    ctx.push({ color: 'red', text: `[ERROR] ${(err as Error).message}` });
  }
}

async function cmdDomain(args: string[], ctx: Ctx): Promise<void> {
  const url = args.join(' ').trim();
  if (!url) {
    ctx.push({ color: 'red', text: 'usage: domain <url>' });
    ctx.push({ color: 'dim', text: 'example: domain jup.ag · domain jupitor.ag' });
    return;
  }
  ctx.push({ color: 'cyan', text: `[DOMAIN] checking ${url}...` });
  await ctx.wait(180);
  try {
    const res = await fetch('/api/check-domain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const body = (await res.json()) as {
      verdict: 'safe' | 'suspicious' | 'danger';
      score: number;
      hostname: string;
      reasons: Array<{ code: string; severity: string; message: string }>;
      error?: string;
    };
    if (!res.ok || body.error) {
      ctx.push({ color: 'red', text: `[ERROR] ${body.error ?? `HTTP ${res.status}`}` });
      return;
    }
    const headerColor: LineColor =
      body.verdict === 'safe' ? 'green' : body.verdict === 'suspicious' ? 'amber' : 'red';
    ctx.push({ color: 'fg', text: '' });
    ctx.push({ color: headerColor, text: `  verdict    ${body.verdict.toUpperCase()}` });
    ctx.push({ color: 'fg', text: `  score      ${body.score}/100` });
    ctx.push({ color: 'fg', text: `  hostname   ${body.hostname || '(invalid)'}` });
    if (body.reasons && body.reasons.length > 0) {
      ctx.push({ color: 'fg', text: '' });
      ctx.push({ color: 'mute', text: '  reasons:' });
      for (const r of body.reasons) {
        const rc: LineColor =
          r.severity === 'critical' || r.severity === 'high'
            ? 'red'
            : r.severity === 'medium'
              ? 'amber'
              : 'cyan';
        ctx.push({
          color: rc,
          text: `    · ${r.severity.toUpperCase().padEnd(9)} ${r.code.padEnd(22)} ${r.message}`,
        });
      }
    }
    ctx.push({ color: 'fg', text: '' });
    if (body.verdict === 'safe') {
      ctx.push({ color: 'green', text: 'looks clean. dyor still.' });
    } else if (body.verdict === 'suspicious') {
      ctx.push({ color: 'amber', text: 'sus. verify before connecting wallet.' });
    } else {
      ctx.push({ color: 'red', text: 'DO NOT CONNECT. phishing domain.' });
    }
    ctx.emitVerdict({
      kind: 'domain',
      verdict: body.verdict,
      score: body.score,
      summary:
        body.verdict === 'safe'
          ? `${body.hostname || url} — no red flags`
          : (body.reasons[0]?.message ?? 'phishing-pattern detected'),
      findings: body.reasons.map((r) => ({
        severity: r.severity as 'low' | 'medium' | 'high' | 'critical',
        ruleId: r.code,
        message: r.message,
      })),
      models: [],
      startedAt: Date.now(),
    });
  } catch (err) {
    ctx.push({ color: 'red', text: `[ERROR] ${(err as Error).message}` });
  }
}

async function cmdScanMsg(args: string[], ctx: Ctx): Promise<void> {
  const message = args.join(' ').trim();
  if (!message) {
    ctx.push({ color: 'red', text: 'usage: msg <text or base64>' });
    ctx.push({ color: 'dim', text: 'example: msg sign in to jupiter' });
    return;
  }
  ctx.push({ color: 'green', text: '[MSG] decoding payload...' });
  await ctx.wait(140);
  ctx.push({ color: 'cyan', text: '[RULES] 6 message detectors · running...' });
  await ctx.wait(180);
  try {
    const res = await fetch('/api/inspect-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, encoding: 'utf8' }),
    });
    const body = (await res.json()) as ThreatReport & { error?: string };
    if (!res.ok || body.error) {
      ctx.push({ color: 'red', text: `[ERROR] ${body.error ?? `HTTP ${res.status}`}` });
      return;
    }
    for (const f of body.findings) {
      const sev = f.severity.toUpperCase();
      const tag = sev === 'CRITICAL' || sev === 'HIGH' ? 'ALERT' : sev === 'MEDIUM' ? 'WARN' : 'INFO';
      const color: LineColor =
        sev === 'CRITICAL' || sev === 'HIGH' ? 'red' : sev === 'MEDIUM' ? 'amber' : 'cyan';
      ctx.push({ color, text: `[${tag}] ${f.ruleId} — ${f.message}` });
      await ctx.wait(120);
    }
    printVerdict(body, ctx);
    ctx.emitVerdict({
      kind: 'msg',
      verdict: body.verdict,
      score: body.score,
      summary: body.summary,
      findings: body.findings,
      elapsedMs: body.elapsedMs,
      models: body.verdict === 'safe' ? ['haiku 4.5'] : ['haiku 4.5', 'opus 4.7'],
      startedAt: Date.now(),
    });
  } catch (err) {
    ctx.push({ color: 'red', text: `[ERROR] ${(err as Error).message}` });
  }
}

function cmdWallets(_args: string[], ctx: Ctx): void {
  const wallets = [
    'phantom',
    'solflare',
    'backpack',
    'glow',
    'brave',
    'coinbase wallet',
    'trust',
    'exodus',
    'ledger',
    'nightly',
    'walletconnect',
    'metamask (solana snap)',
  ];
  ctx.push({ color: 'mute', text: '== compatible wallets ==' });
  ctx.push({ color: 'fg', text: '' });
  for (const w of wallets) {
    ctx.push({ color: 'fg', text: `  ▸ ${w}` });
  }
  ctx.push({ color: 'fg', text: '' });
  ctx.push({ color: 'cyan', text: 'wallet-agnostic by design.' });
  ctx.push({ color: 'dim', text: 'open source · ANY wallet can ship this in an afternoon.' });
}

const EGGS: Record<string, (args: string[], ctx: Ctx) => void> = {
  gm: (_a, c) => c.push({ color: 'green', text: 'gm fren. stay safu.' }),
  wagmi: (_a, c) => c.push({ color: 'green', text: 'wagmi.' }),
  ngmi: (_a, c) => c.push({ color: 'amber', text: "you'll be fine anon. run a scan first." }),
  lfg: (_a, c) => c.push({ color: 'green', text: 'LFG. what do you want to scan?' }),
  ape: (_a, c) => c.push({ color: 'amber', text: 'apes together strong. but DYOR.' }),
  ser: (_a, c) => c.push({ color: 'green', text: 'yes ser.' }),
  fren: (_a, c) => c.push({ color: 'green', text: 'hello fren.' }),
  rug: (_a, c) => c.push({ color: 'green', text: 'not on my watch. scan first.' }),
  gg: (_a, c) => c.push({ color: 'green', text: 'gg.' }),
  safu: (_a, c) => c.push({ color: 'green', text: 'stay safu.' }),
  moon: (_a, c) => c.push({ color: 'amber', text: 'soon™' }),
  sudo: (_a, c) => {
    c.push({ color: 'red', text: "nice try ser. you're not root yet." });
    c.push({ color: 'dim', text: '(there is a way)' });
  },
  rm: (args, c) => {
    if (args.join(' ').includes('blowfish')) {
      c.push({ color: 'amber', text: 'error: blowfish no longer exists.' });
      c.push({ color: 'amber', text: 'acquired by phantom · nov 2024.' });
      return;
    }
    c.push({ color: 'red', text: "command not found. are you high? try 'help'" });
  },
  exit: (_a, c) => c.push({ color: 'amber', text: "you can't leave. this is solana." }),
  logout: (_a, c) => c.push({ color: 'amber', text: "you can't leave. this is solana." }),
  ls: (_a, c) => c.push({ color: 'dim', text: "not bash ser. try 'help'" }),
  cd: (_a, c) => c.push({ color: 'dim', text: "where you going fren. 'help'" }),
};

const COMMANDS: Record<string, Handler> = {
  help: cmdHelp,
  '?': cmdHelp,
  clear: cmdClear,
  cls: cmdClear,
  version: cmdVersion,
  v: cmdVersion,
  whoami: cmdWhoami,
  blowfish: cmdBlowfish,
  manifesto: cmdManifesto,
  about: cmdManifesto,
  pricing: cmdPricing,
  docs: cmdDocs,
  compare: cmdCompare,
  theme: cmdTheme,
  demo: cmdDemo,
  rules: cmdRules,
  feed: cmdFeed,
  scan: cmdScan,
  domain: cmdDomain,
  dom: cmdDomain,
  msg: cmdScanMsg,
  message: cmdScanMsg,
  'scan-msg': cmdScanMsg,
  wallets: cmdWallets,
  ...EGGS,
};

async function runBoot(ctx: Ctx): Promise<void> {
  // The big "SOLSHIELD" wordmark is rendered as a static <BannerHeader/> in the
  // center column (CSS text-stroke outline, font-rendered). Boot output stays in
  // the terminal as a quick set of [OK] checks so we don't waste vertical space
  // re-painting an ASCII version of the wordmark on every load.
  await ctx.wait(80);
  ctx.push({ color: 'mute', text: 'connecting to mainnet.solshield.io...' });
  await ctx.wait(160);
  const checks: Array<[string, number]> = [
    ['helius rpc · mainnet', 18],
    ['claude haiku 4.5', 42],
    ['claude opus 4.7 · standby', 3],
    ['15 detection rules loaded', 2],
    ['threat intel · 3,247 IOCs updated 2m ago', 8],
  ];
  for (const [label, ms] of checks) {
    ctx.push({ color: 'fg', text: `  [OK] ${label.padEnd(44)} ${String(ms).padStart(3)}ms` });
    await ctx.wait(120);
  }
  ctx.push({ color: 'fg', text: '' });
  ctx.push({ color: 'amber', text: 'welcome anon.' });
  ctx.push({ color: 'fg', text: `you are operator_${randomHex()} · rank NOVICE` });
  ctx.push({ color: 'fg', text: `session #${Math.floor(3800 + Math.random() * 200)} · 312/500 alpha slots active` });
  ctx.push({ color: 'fg', text: '' });
  ctx.push({ color: 'green', text: "don't get rekt today." });
  ctx.push({ color: 'fg', text: '' });
}

interface TerminalProps {
  onScansChange?: (n: number) => void;
  onRankChange?: (r: Rank) => void;
  /** receives the latest verdict from scan/msg/domain/demo commands */
  onVerdict?: (v: VerdictView | null) => void;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  { onScansChange, onRankChange, onVerdict },
  ref,
) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [booted, setBooted] = useState(false);
  const [theme, setThemeState] = useState<Theme>('matrix');

  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const bootedRef = useRef(false);
  const scansRef = useRef(0);
  const onVerdictRef = useRef(onVerdict);
  onVerdictRef.current = onVerdict;

  const push = useCallback((line: Line) => {
    setLines((prev) => [...prev, line]);
  }, []);

  const wait = useCallback((ms: number) => new Promise<void>((r) => setTimeout(r, ms)), []);

  const clearLines = useCallback(() => setLines([]), []);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  const emitVerdict = useCallback((v: VerdictView | null) => {
    onVerdictRef.current?.(v);
  }, []);

  const ctx: Ctx = { push, wait, setTheme, clearLines, emitVerdict };

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    (async () => {
      await runBoot(ctx);
      // ─── auto-demo so the user SEES the product working without clicking anything ───
      // Boot finishes → the banner is on screen → we immediately fire `demo drainer`.
      // Effect: terminal scrolls live alerts AND the inspector panel on the right
      // lights up with a structured verdict. ~3s total — by the time the user reads
      // the banner, they've already watched the product detect a drainer end-to-end.
      push({ color: 'amber', text: '▸ auto-demo running · watch the inspector on the right →' });
      push({ color: 'fg', text: '' });
      push({ color: 'mute', text: 'solshield@mainnet:~$ demo drainer', prompt: true });
      await cmdDemo(['drainer'], ctx);
      push({ color: 'fg', text: '' });
      push({
        color: 'green',
        text: "▸ that's it. now click another demo on the left ↓  or type 'help' for all commands.",
      });
      push({ color: 'fg', text: '' });
      setBooted(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const execute = async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;
    setHistory((h) => [cmd, ...h.filter((c) => c !== cmd)].slice(0, 50));
    setHistIdx(-1);
    push({ color: 'mute', text: `solshield@mainnet:~$ ${cmd}`, prompt: true });
    const [name, ...args] = cmd.split(/\s+/);
    const handler = COMMANDS[(name ?? '').toLowerCase()];
    if (!handler) {
      push({ color: 'red', text: `command not found: ${name}. are you high? try 'help'` });
      return;
    }
    try {
      await handler(args, ctx);
      scansRef.current += 1;
      const n = scansRef.current;
      onScansChange?.(n);
      const rank: Rank = n >= 10 ? 'ADMIN' : n >= 3 ? 'OPERATOR' : 'NOVICE';
      onRankChange?.(rank);
    } catch (err) {
      push({ color: 'red', text: `[ERROR] ${(err as Error).message}` });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const val = input;
      setInput('');
      void execute(val);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setInput(history[next] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setInput(next === -1 ? '' : (history[next] ?? ''));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const prefix = input.trim().toLowerCase();
      if (!prefix) return;
      const matches = Object.keys(COMMANDS).filter((c) => c.startsWith(prefix));
      if (matches.length === 1) setInput(matches[0] + ' ');
      else if (matches.length > 1) push({ color: 'dim', text: matches.join('  ') });
    }
  };

  const executeRef = useRef(execute);
  executeRef.current = execute;
  useImperativeHandle(
    ref,
    () => ({
      execute: (cmd: string) => {
        void executeRef.current(cmd);
        inputRef.current?.focus();
      },
    }),
    [],
  );

  const promptClass =
    theme === 'amber' ? 'text-neon-amber' : theme === 'cyan' ? 'text-neon-cyan' : 'text-neon-green';

  return (
    <div className="flex flex-col h-full cursor-text" onClick={() => inputRef.current?.focus()}>
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto overflow-x-auto px-4 sm:px-6 py-4 text-[11px] sm:text-[13px] leading-relaxed font-mono"
      >
        {lines.map((line, i) => (
          <LineView key={i} line={line} />
        ))}
        {booted && (
          <div className="flex items-center gap-2 mt-2">
            <span className={`${promptClass} shrink-0`}>solshield@mainnet:~$</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              className="flex-1 bg-transparent border-none outline-none text-neon-cyan caret-neon-cyan font-mono text-xs sm:text-[13px]"
              placeholder="type 'help' fren"
            />
          </div>
        )}
      </div>
      <QuickButtons onRun={(cmd) => void execute(cmd)} disabled={!booted} />
    </div>
  );
});

function LineView({ line }: { line: Line }) {
  return (
    <div
      className={`${LINE_CLS[line.color]} whitespace-pre animate-fade-in ${line.cls ?? ''}`.trim()}
    >
      {line.text || '\u00A0'}
    </div>
  );
}

function QuickButtons({ onRun, disabled }: { onRun: (cmd: string) => void; disabled: boolean }) {
  const buttons: Array<{ label: string; cmd: string; color: 'red' | 'green' | 'cyan' | 'amber' }> = [
    { label: 'demo drainer', cmd: 'demo drainer', color: 'red' },
    { label: 'demo safe', cmd: 'demo safe', color: 'green' },
    { label: 'domain jupitor.ag', cmd: 'domain jupitor.ag', color: 'red' },
    { label: 'msg sign-in', cmd: 'msg sign in to jupiter', color: 'cyan' },
    { label: 'rules', cmd: 'rules', color: 'cyan' },
    { label: 'feed', cmd: 'feed', color: 'cyan' },
    { label: 'blowfish', cmd: 'blowfish', color: 'amber' },
    { label: 'manifesto', cmd: 'manifesto', color: 'green' },
  ];
  const clr = (c: 'red' | 'green' | 'cyan' | 'amber') => {
    if (c === 'red') return 'border-neon-red/40 text-neon-red hover:bg-neon-red/15';
    if (c === 'green') return 'border-neon-green/40 text-neon-green hover:bg-neon-green/15';
    if (c === 'cyan') return 'border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/15';
    return 'border-neon-amber/40 text-neon-amber hover:bg-neon-amber/15';
  };
  return (
    <div className="flex flex-wrap gap-2 px-4 sm:px-6 py-3 border-t border-neon-green/15 bg-panel/40 backdrop-blur-sm">
      {buttons.map((b) => (
        <button
          key={b.cmd}
          onClick={(e) => {
            e.stopPropagation();
            onRun(b.cmd);
          }}
          disabled={disabled}
          className={`px-3 py-1.5 border text-[10px] sm:text-[11px] tracking-[0.15em] uppercase transition-all disabled:opacity-30 disabled:cursor-not-allowed ${clr(b.color)}`}
        >
          [ {b.label} ]
        </button>
      ))}
    </div>
  );
}
