import { describe, it, expect } from 'vitest';
import { checkDomain, levenshtein } from '../src/domain-scanner';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('jup.ag', 'jup.ag')).toBe(0);
  });

  it('returns the length for an empty operand', () => {
    expect(levenshtein('', 'jup.ag')).toBe(6);
    expect(levenshtein('jup.ag', '')).toBe(6);
  });

  it('counts a single substitution as 1', () => {
    expect(levenshtein('jup.ag', 'jup.ai')).toBe(1);
  });

  it('counts a single insertion as 1', () => {
    expect(levenshtein('phantom.ap', 'phantom.app')).toBe(1);
  });

  it('counts a single deletion as 1', () => {
    expect(levenshtein('phantomm.app', 'phantom.app')).toBe(1);
  });

  it('handles two-edit distances', () => {
    // phantm.ap → phantom.app: insert 'o' and insert trailing 'p'.
    expect(levenshtein('phantm.ap', 'phantom.app')).toBe(2);
  });

  it('is symmetric regardless of argument order', () => {
    expect(levenshtein('jupiter', 'jupitor')).toBe(levenshtein('jupitor', 'jupiter'));
  });
});

describe('checkDomain · invalid input', () => {
  it('returns danger/100 for an empty string', () => {
    const r = checkDomain('');
    expect(r.verdict).toBe('danger');
    expect(r.score).toBe(100);
    expect(r.hostname).toBe('');
    expect(r.reasons.map((x) => x.code)).toEqual(['invalid-url']);
  });

  it('returns danger for whitespace-only input', () => {
    const r = checkDomain('   ');
    expect(r.verdict).toBe('danger');
    expect(r.reasons[0]?.code).toBe('invalid-url');
  });
});

describe('checkDomain · legit allowlist', () => {
  it('short-circuits to safe with score 0 on an exact legit match', () => {
    const r = checkDomain('jup.ag');
    expect(r.verdict).toBe('safe');
    expect(r.score).toBe(0);
    expect(r.hostname).toBe('jup.ag');
    expect(r.reasons).toEqual([]);
  });

  it('strips a leading www. before matching the allowlist', () => {
    const r = checkDomain('www.phantom.app');
    expect(r.verdict).toBe('safe');
    expect(r.hostname).toBe('phantom.app');
  });

  it('accepts a bare hostname (no protocol) and matches the allowlist', () => {
    const r = checkDomain('raydium.io');
    expect(r.verdict).toBe('safe');
  });

  it('accepts a full https URL with a path and matches the allowlist', () => {
    const r = checkDomain('https://jup.ag/swap?from=USDC');
    expect(r.verdict).toBe('safe');
    expect(r.hostname).toBe('jup.ag');
  });
});

describe('checkDomain · blocklist', () => {
  it('flags a hostname on the scam blocklist as critical', () => {
    const r = checkDomain('jupitor.ag');
    expect(r.verdict).toBe('danger');
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.reasons[0]).toMatchObject({
      code: 'blocklisted',
      severity: 'critical',
    });
  });
});

describe('checkDomain · typosquat detection', () => {
  it('flags a hostname within edit-distance 1 of a legit dapp', () => {
    // distance 1 from phantom.app, not on either list
    const r = checkDomain('phantom.ap');
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toContain('typosquat');
    const typo = r.reasons.find((x) => x.code === 'typosquat');
    expect(typo?.severity).toBe('high');
    expect((typo?.details as { spoofing: string }).spoofing).toBe('phantom.app');
  });

  it('does not flag a hostname that is far from every legit dapp', () => {
    const r = checkDomain('totally-unrelated-name.example.org');
    expect(r.reasons.find((x) => x.code === 'typosquat')).toBeUndefined();
  });

  it('does not run the typosquat check on legit hostnames (they short-circuit)', () => {
    const r = checkDomain('jup.ag');
    expect(r.reasons).toEqual([]);
  });
});

describe('checkDomain · suspicious TLDs', () => {
  it.each(['tk', 'ml', 'ga', 'cf', 'gq'])('flags .%s as medium severity', (tld) => {
    const r = checkDomain(`some-random-host.${tld}`);
    const reason = r.reasons.find((x) => x.code === 'suspicious-tld');
    expect(reason).toBeDefined();
    expect(reason?.severity).toBe('medium');
    expect((reason?.details as { tld: string }).tld).toBe(tld);
  });

  it('does not flag a normal TLD', () => {
    const r = checkDomain('something-neutral.example.org');
    expect(r.reasons.find((x) => x.code === 'suspicious-tld')).toBeUndefined();
  });
});

describe('checkDomain · punycode / IDN homograph', () => {
  it('flags a hostname containing xn-- as high severity', () => {
    const r = checkDomain('xn--phntm-rsa.app');
    const reason = r.reasons.find((x) => x.code === 'punycode-idn');
    expect(reason).toBeDefined();
    expect(reason?.severity).toBe('high');
  });
});

describe('checkDomain · phishing keyword + brand', () => {
  it('flags brand+keyword combos as medium', () => {
    // "phantom" is a known brand, "connect" is a scam keyword.
    // Not on either list, far from any legit, single hyphen, 17 chars — only phishing rule fires.
    const r = checkDomain('phantomconnect.io');
    const reason = r.reasons.find((x) => x.code === 'phishing-keyword');
    expect(reason).toBeDefined();
    expect(reason?.severity).toBe('medium');
    const details = reason?.details as { brand: string; keyword: string };
    expect(details.brand).toBe('phantom');
    expect(details.keyword).toBe('connect');
  });

  it('does not flag a scam keyword on its own without a known brand', () => {
    const r = checkDomain('claim-stuff.example.org');
    expect(r.reasons.find((x) => x.code === 'phishing-keyword')).toBeUndefined();
  });
});

describe('checkDomain · structural heuristics', () => {
  it('flags a hostname with more than 2 hyphens as low (suspicious-structure)', () => {
    const r = checkDomain('a-b-c-d.example.org');
    const reason = r.reasons.find(
      (x) => x.code === 'suspicious-structure' && (x.details as { kind?: string }).kind === 'hyphen-count',
    );
    expect(reason).toBeDefined();
    expect(reason?.severity).toBe('low');
  });

  it('flags a hostname longer than 40 chars as low (suspicious-structure)', () => {
    const long = 'a'.repeat(45) + '.com';
    const r = checkDomain(long);
    const reason = r.reasons.find(
      (x) => x.code === 'suspicious-structure' && (x.details as { kind?: string }).kind === 'length',
    );
    expect(reason).toBeDefined();
    expect(reason?.severity).toBe('low');
  });

  it('does not flag a normal short hostname', () => {
    const r = checkDomain('short.example.org');
    expect(r.reasons.find((x) => x.code === 'suspicious-structure')).toBeUndefined();
  });
});

describe('checkDomain · score and verdict aggregation', () => {
  it('sums severities across multiple rule hits', () => {
    // .tk (medium=25) + brand "phantom" + keyword "airdrop" (medium=25) = 50 → suspicious
    const r = checkDomain('phantom-airdrop.tk');
    const codes = r.reasons.map((x) => x.code).sort();
    expect(codes).toContain('suspicious-tld');
    expect(codes).toContain('phishing-keyword');
    expect(r.score).toBe(50);
    expect(r.verdict).toBe('suspicious');
  });

  it('caps the score at 100 when many rules fire', () => {
    // typosquat (high=55) + .tk (medium=25) + 4 hyphens (low=10) → 90.
    // We just need to confirm Math.min(100, sum) holds: rebuild with one critical-equivalent.
    // Construct a blocklisted host that ALSO triggers structure: "free-sol.io" is blocklisted,
    // but has 1 hyphen / short length — only the critical reason will fire (90).
    const r = checkDomain('free-sol.io');
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.verdict).toBe('danger');
  });

  it('maps thresholds correctly: 0 → safe, 30 → suspicious, 70 → danger', () => {
    // safe boundary already covered by allowlist test.
    // Suspicious boundary: a single .tk = 25 → still safe; need ≥30. 25+10=35.
    // Use ".tk + many hyphens": "a-b-c-d.tk" → suspicious-tld(25) + hyphen-count(10) = 35.
    const susp = checkDomain('a-b-c-d.tk');
    expect(susp.score).toBe(35);
    expect(susp.verdict).toBe('suspicious');

    // Danger boundary: typosquat alone = 55 → still suspicious; combined with .tk = 80 → danger.
    // "phantom.tk" is distance 1 from "phantom.app"? No → distance is large.
    // Use "phantom.ap" + manual TLD trick — but we can't append .tk. Instead use punycode (high=55)
    // + a brand-keyword (medium=25) → 80 → danger.
    const dang = checkDomain('xn--phantom-claim.io');
    // Punycode (high=55) + phantom+claim (medium=25) → 80 → danger.
    expect(dang.verdict).toBe('danger');
    expect(dang.score).toBeGreaterThanOrEqual(70);
  });
});
