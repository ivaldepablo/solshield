import { describe, it, expect } from 'vitest';
import {
  emptyMessageSign,
  opaqueBinarySign,
  urlInMessage,
  rtlOverrideAttack,
  spoofedSiwsDomain,
  permitStyleApproval,
  runMessageRules,
  scoreFromFindings,
  verdictFromScore,
} from '../src/message-rules';
import type { SignMessageInspection } from '../src/message-types';
import type { Finding } from '../src/types';

const NOW = new Date('2026-04-17T00:00:00Z');

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function ctx(partial: Partial<SignMessageInspection> & { rawBytes: Uint8Array }): SignMessageInspection {
  let decodedText = partial.decodedText;
  if (decodedText === undefined) {
    try {
      decodedText = new TextDecoder('utf-8', { fatal: true }).decode(partial.rawBytes);
    } catch {
      decodedText = undefined;
    }
  }
  return {
    rawBytes: partial.rawBytes,
    decodedText,
    claimedPurpose: partial.claimedPurpose,
    origin: partial.origin,
    now: partial.now ?? NOW,
  };
}

describe('emptyMessageSign', () => {
  it('flags a zero-byte message', async () => {
    const findings = await emptyMessageSign.evaluate(ctx({ rawBytes: new Uint8Array(0) }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'empty-message-sign',
      severity: 'high',
    });
  });

  it('flags a 3-byte message (under threshold)', async () => {
    const findings = await emptyMessageSign.evaluate(ctx({ rawBytes: utf8('hi!') }));
    expect(findings).toHaveLength(1);
  });

  it('flags whitespace-only text', async () => {
    const findings = await emptyMessageSign.evaluate(ctx({ rawBytes: utf8('     \n\t  ') }));
    expect(findings).toHaveLength(1);
    const details = findings[0]?.details as { whitespaceOnly: boolean };
    expect(details.whitespaceOnly).toBe(true);
  });

  it('does not flag a normal message', async () => {
    const findings = await emptyMessageSign.evaluate(
      ctx({ rawBytes: utf8('Sign in to Jupiter') }),
    );
    expect(findings).toHaveLength(0);
  });
});

describe('opaqueBinarySign', () => {
  it('flags non-utf8 bytes with no claimedPurpose', async () => {
    // Invalid UTF-8 sequence (lone continuation byte).
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa]);
    const findings = await opaqueBinarySign.evaluate(ctx({ rawBytes: bytes }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'opaque-binary-sign',
      severity: 'medium',
    });
  });

  it('does not flag binary if a claimedPurpose is provided', async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa]);
    const findings = await opaqueBinarySign.evaluate(
      ctx({ rawBytes: bytes, claimedPurpose: 'Phantom session token' }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does not flag valid utf8', async () => {
    const findings = await opaqueBinarySign.evaluate(
      ctx({ rawBytes: utf8('Sign in to Jupiter') }),
    );
    expect(findings).toHaveLength(0);
  });
});

describe('urlInMessage', () => {
  it('flags a single URL inside the message', async () => {
    const findings = await urlInMessage.evaluate(
      ctx({ rawBytes: utf8('Welcome anon, visit https://phishy.tld/win') }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'url-in-message',
      severity: 'medium',
    });
    const details = findings[0]?.details as { urls: string[] };
    expect(details.urls).toContain('https://phishy.tld/win');
  });

  it('captures multiple URLs (capped at 5)', async () => {
    const text = Array.from({ length: 8 }, (_, i) => `https://h${i}.tld`).join(' ');
    const findings = await urlInMessage.evaluate(ctx({ rawBytes: utf8(text) }));
    const details = findings[0]?.details as { urls: string[] };
    expect(details.urls).toHaveLength(5);
  });

  it('does not flag a message without a URL', async () => {
    const findings = await urlInMessage.evaluate(
      ctx({ rawBytes: utf8('jup.ag wants you to sign in with your Solana account') }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does not flag binary messages (no decodedText)', async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
    const findings = await urlInMessage.evaluate(ctx({ rawBytes: bytes }));
    expect(findings).toHaveLength(0);
  });
});

describe('rtlOverrideAttack', () => {
  const overrides: Array<[string, string]> = [
    ['LRE', '\u202A'],
    ['RLE', '\u202B'],
    ['LRO', '\u202D'],
    ['RLO', '\u202E'],
    ['LRI', '\u2066'],
    ['RLI', '\u2067'],
    ['FSI', '\u2068'],
  ];

  it.each(overrides)('flags a message containing %s (%s)', async (_label, ch) => {
    const findings = await rtlOverrideAttack.evaluate(
      ctx({ rawBytes: utf8(`Sign in${ch}sneaky`) }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'rtl-override-attack',
      severity: 'high',
    });
  });

  it('does not flag normal latin text', async () => {
    const findings = await rtlOverrideAttack.evaluate(
      ctx({ rawBytes: utf8('Sign in to Jupiter — nonce 1234') }),
    );
    expect(findings).toHaveLength(0);
  });

  it('lists multiple codepoints when several overrides appear', async () => {
    const findings = await rtlOverrideAttack.evaluate(
      ctx({ rawBytes: utf8(`a\u202Eb\u202Dc`) }),
    );
    const details = findings[0]?.details as { codepoints: string[] };
    expect(details.codepoints).toEqual(expect.arrayContaining(['U+202E', 'U+202D']));
  });
});

describe('spoofedSiwsDomain', () => {
  const siws = (claim: string) =>
    `${claim} wants you to sign in with your Solana account:\n\nNonce: abc`;

  it('flags when the claimed SIWS domain does not match the requesting origin', async () => {
    const findings = await spoofedSiwsDomain.evaluate(
      ctx({ rawBytes: utf8(siws('jup.ag')), origin: 'https://phishy.tld' }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'spoofed-siws-domain',
      severity: 'critical',
    });
    const details = findings[0]?.details as { claimedDomain: string; originHost: string };
    expect(details.claimedDomain).toBe('jup.ag');
    expect(details.originHost).toBe('phishy.tld');
  });

  it('does not flag when claim matches origin exactly', async () => {
    const findings = await spoofedSiwsDomain.evaluate(
      ctx({ rawBytes: utf8(siws('jup.ag')), origin: 'https://jup.ag' }),
    );
    expect(findings).toHaveLength(0);
  });

  it('treats subdomains as same-root (no flag)', async () => {
    const findings = await spoofedSiwsDomain.evaluate(
      ctx({ rawBytes: utf8(siws('jup.ag')), origin: 'https://app.jup.ag/route' }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does not flag a non-SIWS message', async () => {
    const findings = await spoofedSiwsDomain.evaluate(
      ctx({ rawBytes: utf8('Just say hi'), origin: 'https://jup.ag' }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does not flag when origin is missing', async () => {
    const findings = await spoofedSiwsDomain.evaluate(ctx({ rawBytes: utf8(siws('jup.ag')) }));
    expect(findings).toHaveLength(0);
  });
});

describe('permitStyleApproval', () => {
  it('flags messages with approval keyword + amount', async () => {
    const findings = await permitStyleApproval.evaluate(
      ctx({ rawBytes: utf8('Authorize transfer of 1,000,000 USDC to 9aB...') }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'permit-style-approval',
      severity: 'high',
    });
    const details = findings[0]?.details as { keyword: string; amount: string };
    expect(details.keyword).toBe('authorize');
    expect(details.amount).toBe('1,000,000');
  });

  it('flags decimal amounts', async () => {
    const findings = await permitStyleApproval.evaluate(
      ctx({ rawBytes: utf8('Permit 10.5 SOL transfer') }),
    );
    expect(findings).toHaveLength(1);
    const details = findings[0]?.details as { amount: string };
    expect(details.amount).toBe('10.5');
  });

  it('does not flag a keyword without an amount', async () => {
    const findings = await permitStyleApproval.evaluate(
      ctx({ rawBytes: utf8('Please approve this signature request') }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does not flag an amount without a keyword', async () => {
    const findings = await permitStyleApproval.evaluate(
      ctx({ rawBytes: utf8('Block height 12345 — proof of work') }),
    );
    expect(findings).toHaveLength(0);
  });
});

describe('scoreFromFindings + verdictFromScore', () => {
  const f = (severity: Finding['severity']): Finding => ({
    ruleId: 'x',
    severity,
    message: 'm',
  });

  it('returns 0 for an empty list', () => {
    expect(scoreFromFindings([])).toBe(0);
    expect(verdictFromScore(0)).toBe('safe');
  });

  it('uses the maximum severity weight (not a sum)', () => {
    // Two highs (55 each) should not stack — picks the max single weight.
    expect(scoreFromFindings([f('high'), f('high')])).toBe(55);
    expect(scoreFromFindings([f('low'), f('critical'), f('medium')])).toBe(90);
  });

  it('caps at 100', () => {
    expect(scoreFromFindings([f('critical'), f('critical')])).toBe(90);
    expect(verdictFromScore(95)).toBe('danger');
  });

  it('maps thresholds: <25 safe, 25–59 suspicious, ≥60 danger', () => {
    expect(verdictFromScore(0)).toBe('safe');
    expect(verdictFromScore(24)).toBe('safe');
    expect(verdictFromScore(25)).toBe('suspicious');
    expect(verdictFromScore(59)).toBe('suspicious');
    expect(verdictFromScore(60)).toBe('danger');
    expect(verdictFromScore(100)).toBe('danger');
  });
});

describe('runMessageRules', () => {
  it('returns no findings for a benign message with valid origin/claim', async () => {
    const findings = await runMessageRules(
      ctx({
        rawBytes: utf8(
          'jup.ag wants you to sign in with your Solana account:\n\nNonce: a1b2c3',
        ),
        origin: 'https://jup.ag',
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('aggregates several rule hits in one call', async () => {
    const text =
      'phishy.tld wants you to sign in with your Solana account:\n\n' +
      'Authorize 1,000,000 USDC. Visit https://phishy.tld/win\u202Eevil';
    const findings = await runMessageRules(
      ctx({ rawBytes: utf8(text), origin: 'https://jup.ag' }),
    );
    const ids = findings.map((x) => x.ruleId);
    expect(ids).toContain('spoofed-siws-domain');
    expect(ids).toContain('permit-style-approval');
    expect(ids).toContain('url-in-message');
    expect(ids).toContain('rtl-override-attack');
  });
});
