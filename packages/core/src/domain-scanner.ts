import scamDomainsData from './data/scam-domains.json';
import legitDappsData from './data/legit-dapps.json';

export interface DomainCheckResult {
  verdict: 'safe' | 'suspicious' | 'danger';
  score: number;
  url: string;
  hostname: string;
  reasons: DomainReason[];
}

export interface DomainReason {
  code: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details?: Record<string, unknown>;
}

const SEVERITY_WEIGHT: Record<DomainReason['severity'], number> = {
  low: 10,
  medium: 25,
  high: 55,
  critical: 90,
};

const SUSPICIOUS_TLDS: ReadonlySet<string> = new Set(['tk', 'ml', 'ga', 'cf', 'gq']);

const SCAM_KEYWORDS = [
  'login',
  'connect',
  'claim',
  'airdrop',
  'free',
  'rewards',
] as const;

// Brand tokens derived from the legit dapps list (plus a few aliases the
// legit domains don't spell out directly, like "jupiter").
const LEGIT_BRANDS = [
  'jupiter',
  'jup',
  'raydium',
  'solana',
  'sol',
  'phantom',
  'solflare',
  'magiceden',
  'magic-eden',
  'tensor',
  'orca',
  'backpack',
  'mango',
  'kamino',
  'pyth',
  'wormhole',
  'jito',
  'drift',
  'meteora',
  'helius',
  'solscan',
  'marinade',
  'anchor',
  'quicknode',
] as const;

const scamDomains: ReadonlySet<string> = new Set(
  (scamDomainsData as string[]).map((d) => d.toLowerCase()),
);
const legitDapps: ReadonlyArray<string> = (legitDappsData as string[]).map((d) => d.toLowerCase());
const legitDappsSet: ReadonlySet<string> = new Set(legitDapps);

/**
 * Standard iterative DP Levenshtein distance. Handles empty strings.
 * O(n*m) time, O(min(n,m)) extra space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // Ensure `a` is the shorter one to minimise memory.
  let s1 = a;
  let s2 = b;
  if (s1.length > s2.length) {
    const tmp = s1;
    s1 = s2;
    s2 = tmp;
  }

  const n = s1.length;
  const m = s2.length;
  let prev: number[] = new Array(n + 1);
  let curr: number[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) prev[i] = i;

  for (let j = 1; j <= m; j++) {
    curr[0] = j;
    const cj = s2.charCodeAt(j - 1);
    for (let i = 1; i <= n; i++) {
      const cost = s1.charCodeAt(i - 1) === cj ? 0 : 1;
      const del = (prev[i] ?? 0) + 1;
      const ins = (curr[i - 1] ?? 0) + 1;
      const sub = (prev[i - 1] ?? 0) + cost;
      let best = del;
      if (ins < best) best = ins;
      if (sub < best) best = sub;
      curr[i] = best;
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n] ?? 0;
}

function stripWww(hostname: string): string {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

function getTld(hostname: string): string | null {
  const i = hostname.lastIndexOf('.');
  if (i < 0 || i === hostname.length - 1) return null;
  return hostname.slice(i + 1);
}

function verdictFrom(score: number): DomainCheckResult['verdict'] {
  if (score >= 70) return 'danger';
  if (score >= 30) return 'suspicious';
  return 'safe';
}

function scoreFrom(reasons: DomainReason[]): number {
  let total = 0;
  for (const r of reasons) total += SEVERITY_WEIGHT[r.severity];
  return Math.min(100, total);
}

/**
 * Try to parse an arbitrary user-supplied string as a URL. If it looks like
 * a bare hostname (e.g. "jup.ag" or "jupitor.ag/swap"), prepend https:// so
 * the URL parser will accept it.
 */
function parseUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const candidates: string[] = [];
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    candidates.push(trimmed);
  } else {
    candidates.push(`https://${trimmed}`);
  }
  for (const c of candidates) {
    try {
      const u = new URL(c);
      if (!u.hostname) continue;
      return u;
    } catch {
      // keep trying
    }
  }
  return null;
}

export function checkDomain(url: string): DomainCheckResult {
  const originalInput = typeof url === 'string' ? url : '';
  const parsed = parseUrl(originalInput);

  if (!parsed) {
    const reasons: DomainReason[] = [
      {
        code: 'invalid-url',
        severity: 'critical',
        message: 'not a valid URL',
      },
    ];
    return {
      verdict: 'danger',
      score: 100,
      url: originalInput,
      hostname: '',
      reasons,
    };
  }

  const hostnameRaw = parsed.hostname.toLowerCase();
  const hostname = stripWww(hostnameRaw);
  const reasons: DomainReason[] = [];

  // 3. Blocklist exact match.
  if (scamDomains.has(hostname)) {
    reasons.push({
      code: 'blocklisted',
      severity: 'critical',
      message: `${hostname} is on the SolShield scam blocklist.`,
    });
  }

  // 4. Legit allowlist exact match — short circuit to safe.
  if (legitDappsSet.has(hostname)) {
    return {
      verdict: 'safe',
      score: 0,
      url: originalInput,
      hostname,
      reasons: [],
    };
  }

  // 5. Typosquat detection via Levenshtein distance against legit dapps.
  if (!legitDappsSet.has(hostname)) {
    let bestLegit: string | null = null;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    for (const legit of legitDapps) {
      const d = levenshtein(hostname, legit);
      if (d < bestDistance) {
        bestDistance = d;
        bestLegit = legit;
      }
    }
    if (bestLegit && bestDistance > 0 && bestDistance <= 2) {
      reasons.push({
        code: 'typosquat',
        severity: 'high',
        message: `${hostname} looks like a typosquat of ${bestLegit} (edit distance ${bestDistance}).`,
        details: { spoofing: bestLegit, distance: bestDistance },
      });
    }
  }

  // 6. Suspicious TLDs.
  const tld = getTld(hostname);
  if (tld && SUSPICIOUS_TLDS.has(tld)) {
    reasons.push({
      code: 'suspicious-tld',
      severity: 'medium',
      message: `.${tld} is a free/abuse-prone TLD commonly used in phishing.`,
      details: { tld },
    });
  }

  // 7. Punycode / IDN homograph attack.
  if (hostname.includes('xn--')) {
    reasons.push({
      code: 'punycode-idn',
      severity: 'high',
      message:
        'hostname uses punycode (xn--…), often a homograph attack impersonating a legit brand.',
    });
  }

  // 8. Scam keyword + legit brand combination.
  const matchedKeyword = SCAM_KEYWORDS.find((k) => hostname.includes(k));
  if (matchedKeyword) {
    const matchedBrand = LEGIT_BRANDS.find((b) => hostname.includes(b));
    if (matchedBrand) {
      reasons.push({
        code: 'phishing-keyword',
        severity: 'medium',
        message: `hostname combines brand "${matchedBrand}" with scam keyword "${matchedKeyword}".`,
        details: { brand: matchedBrand, keyword: matchedKeyword },
      });
    }
  }

  // 9. Too many hyphens.
  const hyphenCount = (hostname.match(/-/g) ?? []).length;
  if (hyphenCount > 2) {
    reasons.push({
      code: 'suspicious-structure',
      severity: 'low',
      message: `hostname has ${hyphenCount} hyphens — unusual for legitimate dapps.`,
      details: { hyphens: hyphenCount, kind: 'hyphen-count' },
    });
  }

  // 10. Very long hostname.
  if (hostname.length > 40) {
    reasons.push({
      code: 'suspicious-structure',
      severity: 'low',
      message: `hostname is ${hostname.length} characters — unusually long.`,
      details: { length: hostname.length, kind: 'length' },
    });
  }

  const score = scoreFrom(reasons);
  return {
    verdict: verdictFrom(score),
    score,
    url: originalInput,
    hostname,
    reasons,
  };
}
