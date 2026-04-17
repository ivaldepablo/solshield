import type { Finding, Verdict } from './types';
import type { MessageRule, SignMessageInspection } from './message-types';

// -------- severity weights (same as rules.ts) --------

const SEVERITY_WEIGHT: Record<Finding['severity'], number> = {
  low: 10,
  medium: 25,
  high: 55,
  critical: 90,
};

/**
 * Score a set of findings the same way tx rules do: take the maximum
 * severity weight across all findings, cap at 100.
 */
export function scoreFromFindings(findings: Finding[]): number {
  let score = 0;
  for (const f of findings) {
    const w = SEVERITY_WEIGHT[f.severity];
    if (w > score) score = w;
  }
  return Math.min(100, score);
}

/**
 * Map a score into a Verdict using the same thresholds as tx rules.
 */
export function verdictFromScore(score: number): Verdict {
  if (score >= 60) return 'danger';
  if (score >= 25) return 'suspicious';
  return 'safe';
}

// -------- helpers --------

const WHITESPACE_RE = /^\s*$/;
const URL_RE = /\bhttps?:\/\//i;

// U+202A LRE, U+202B RLE, U+202D LRO, U+202E RLO, U+2066 LRI, U+2067 RLI, U+2068 FSI
const RTL_OVERRIDE_CHARS = ['\u202A', '\u202B', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068'];
const RTL_OVERRIDE_CODEPOINTS = RTL_OVERRIDE_CHARS.map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));

// ERC-4361-style SIWS line 1: "<domain> wants you to sign in with your Solana account:"
// We match permissively because many dapps vary wording slightly.
const SIWS_LINE1_RE = /^([^\s]+)\s+wants you to sign in/i;

// Permit / approval vocabulary (case-insensitive, whole-word).
const PERMIT_KEYWORDS = ['permit', 'approve', 'approval', 'allow', 'authorize', 'authorization'];
// A "number-like pattern" — amount with optional decimals/underscores/grouping or a large integer.
// We want to catch "1000", "1,000,000", "1_000_000", "10.5", "0.05", etc.
const AMOUNT_RE = /(?<!\w)(?:\d{1,3}(?:[,_]\d{3})+|\d+)(?:\.\d+)?(?!\w)/;

function hostnameOf(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function containsAny(haystack: string, needles: string[]): string | null {
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    if (lower.includes(n)) return n;
  }
  return null;
}

// -------- rule 1: empty-message-sign --------

export const emptyMessageSign: MessageRule = {
  id: 'empty-message-sign',
  severity: 'high',
  description:
    'Signable message is empty or whitespace-only. An attacker can replay such a signature anywhere.',

  evaluate(msg) {
    const tooShort = msg.rawBytes.length < 4;
    const onlyWhitespace = msg.decodedText !== undefined && WHITESPACE_RE.test(msg.decodedText);
    if (!tooShort && !onlyWhitespace) return [];
    return [
      {
        ruleId: 'empty-message-sign',
        severity: 'high',
        message:
          'Message to sign is empty or whitespace-only. Signatures over empty payloads can be replayed on other apps.',
        details: {
          byteLength: msg.rawBytes.length,
          whitespaceOnly: onlyWhitespace,
        },
      },
    ];
  },
};

// -------- rule 2: opaque-binary-sign --------

export const opaqueBinarySign: MessageRule = {
  id: 'opaque-binary-sign',
  severity: 'medium',
  description:
    'Message is not valid UTF-8 and no claimedPurpose was provided — looks like an opaque binary structure.',

  evaluate(msg) {
    if (msg.decodedText !== undefined) return [];
    if (msg.claimedPurpose && msg.claimedPurpose.trim().length > 0) return [];
    return [
      {
        ruleId: 'opaque-binary-sign',
        severity: 'medium',
        message:
          'Binary message with no stated purpose. Structured payloads like permits/authorizations are often invisible to the user.',
        details: { byteLength: msg.rawBytes.length },
      },
    ];
  },
};

// -------- rule 3: url-in-message --------

export const urlInMessage: MessageRule = {
  id: 'url-in-message',
  severity: 'medium',
  description: 'Signable message contains an http(s) URL — possible phishing link hidden in greeting text.',

  evaluate(msg) {
    if (!msg.decodedText) return [];
    if (!URL_RE.test(msg.decodedText)) return [];
    // collect all URLs for context
    const urls = msg.decodedText.match(/\bhttps?:\/\/[^\s"'<>]+/gi) ?? [];
    return [
      {
        ruleId: 'url-in-message',
        severity: 'medium',
        message:
          'Message contains one or more URLs. Verify every link carefully — phishing often disguises links as sign-in greetings.',
        details: { urls: urls.slice(0, 5) },
      },
    ];
  },
};

// -------- rule 4: rtl-override-attack --------

export const rtlOverrideAttack: MessageRule = {
  id: 'rtl-override-attack',
  severity: 'high',
  description:
    'Message contains Unicode bidi/RTL override characters that reorder visible text.',

  evaluate(msg) {
    if (!msg.decodedText) return [];
    const seen: string[] = [];
    for (const c of RTL_OVERRIDE_CHARS) {
      if (msg.decodedText.includes(c)) {
        seen.push(c);
      }
    }
    if (seen.length === 0) return [];
    const codepoints = seen.map((c) => 'U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
    return [
      {
        ruleId: 'rtl-override-attack',
        severity: 'high',
        message:
          'Message contains Unicode RTL / bidi override characters that can hide malicious text behind visible safe text.',
        details: { codepoints, knownOverrides: RTL_OVERRIDE_CODEPOINTS },
      },
    ];
  },
};

// -------- rule 5: spoofed-siws-domain --------

export const spoofedSiwsDomain: MessageRule = {
  id: 'spoofed-siws-domain',
  severity: 'critical',
  description:
    'SIWS-formatted message whose stated domain does not match the origin of the requesting dapp.',

  evaluate(msg) {
    if (!msg.decodedText || !msg.origin) return [];
    const firstLine = msg.decodedText.split(/\r?\n/, 1)[0] ?? '';
    const m = SIWS_LINE1_RE.exec(firstLine.trim());
    if (!m) return [];
    const claimedDomainRaw = (m[1] ?? '').toLowerCase();
    if (!claimedDomainRaw) return [];
    // strip protocol / trailing punctuation if present
    const claimedDomain = claimedDomainRaw.replace(/^https?:\/\//, '').replace(/[\/:].*$/, '').replace(/[.,;:]+$/, '');
    const originHost = hostnameOf(msg.origin);
    if (!originHost || !claimedDomain) return [];
    if (claimedDomain === originHost) return [];
    // also accept subdomain relationship (origin = app.foo.com, claim = foo.com or vice-versa)
    const sameRoot =
      originHost.endsWith('.' + claimedDomain) || claimedDomain.endsWith('.' + originHost);
    if (sameRoot) return [];
    return [
      {
        ruleId: 'spoofed-siws-domain',
        severity: 'critical',
        message: `SIWS message claims domain "${claimedDomain}" but signature is being requested from "${originHost}".`,
        details: { claimedDomain, originHost, origin: msg.origin },
      },
    ];
  },
};

// -------- rule 6: permit-style-approval --------

export const permitStyleApproval: MessageRule = {
  id: 'permit-style-approval',
  severity: 'high',
  description:
    'Message text looks like an off-chain token approval (permit / allow / authorize) with an amount.',

  evaluate(msg) {
    if (!msg.decodedText) return [];
    const hit = containsAny(msg.decodedText, PERMIT_KEYWORDS);
    if (!hit) return [];
    const amountMatch = AMOUNT_RE.exec(msg.decodedText);
    if (!amountMatch) return [];
    return [
      {
        ruleId: 'permit-style-approval',
        severity: 'high',
        message:
          'Message looks like an off-chain approval / permit with an amount. Signing may authorize a token transfer without a visible on-chain transaction.',
        details: {
          keyword: hit,
          amount: amountMatch[0],
        },
      },
    ];
  },
};

// -------- registry + runner --------

export const MESSAGE_RULES: MessageRule[] = [
  emptyMessageSign,
  opaqueBinarySign,
  urlInMessage,
  rtlOverrideAttack,
  spoofedSiwsDomain,
  permitStyleApproval,
];

/**
 * Run every message rule against the inspection context and return the
 * concatenated findings.
 */
export async function runMessageRules(msg: SignMessageInspection): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const rule of MESSAGE_RULES) {
    const out = await rule.evaluate(msg);
    findings.push(...out);
  }
  return findings;
}
