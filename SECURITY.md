# Security policy

## Reporting a vulnerability

If you believe you have found a vulnerability in SolShield, please do not open a public issue, tweet about it, or drop it in a Discord. Send a report to:

**security@solshield.dev** (PGP key to be published alongside the 0.1 release)

Please include:

- A description of the issue
- Reproduction steps — code, transaction signatures, or a testcase that demonstrates the problem
- Impact assessment: who is affected and how
- Mitigations you have already considered

Expect an acknowledgment within **72 hours** and a first substantive response within **7 days**. For issues actively being exploited, flag the email subject with `[ACTIVE EXPLOIT]` and we will move faster.

## Coordinated disclosure

We ask for a **90-day** coordinated disclosure window from the acknowledgment date, extendable by mutual agreement if the fix is non-trivial. After the window closes, or once a fix has shipped, you are free to publish. We will credit you in the advisory unless you prefer to stay anonymous.

If the vulnerability affects a third-party dependency rather than SolShield itself, we will route the report upstream and keep you in the loop.

## Scope

**In scope**

- Bypasses in the rule engine that let a malicious transaction through as `safe`
- False negatives on drainer patterns explicitly listed in `packages/core/rules/`
- Prompt injection that causes the AI layer to misclassify a known-malicious transaction
- Supply-chain concerns in any published `@solshield/*` package
- Authentication, authorization, or data-exposure issues in the public API surface
- Integrity issues in the signed threat feed

**Out of scope**

- Vulnerabilities in third-party dependencies already reported upstream (link the upstream advisory)
- Issues that require a fully compromised host, physical access, or pre-existing root
- Denial of service on the public API — rate limiting is an expected behavior, not a defect
- Clickjacking or missing security headers on marketing pages
- Reports produced by automated scanners without a working proof of concept

## Safe harbor

Good-faith security research is welcome and will not be pursued legally. To stay within safe harbor:

- Do not test against live user data or third-party wallets
- Do not exfiltrate data beyond what is required for proof of concept
- Do not disrupt the public service — local reproduction and testnets are fine
- Notify us before any research that could be perceived as an intrusion

## Advisory log

Published advisories will be listed here in reverse chronological order as they land. Empty until the first disclosure.
