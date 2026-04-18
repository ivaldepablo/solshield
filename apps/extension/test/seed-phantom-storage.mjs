/**
 * Phantom storage seeding for E2E tests.
 *
 * METHOD A (DIRECT STORAGE WRITE) — abandoned.
 *   Phantom's vault uses a custom envelope (PBKDF2 with variable iteration
 *   count + AES-GCM, salt buried in chunk-JWTAN66J.js across multiple
 *   `salt:t/o/a/s/pR/P/f/n` references; no clean public schema). Even after
 *   reverse-engineering the cipher we still need to seed many adjacent
 *   bookkeeping keys (account derivation paths, default chain, terms-of-
 *   service ack, network selection, anti-phishing token, …) before Phantom
 *   considers itself "onboarded and unlocked". A misformed write triggers
 *   the corruption modal (chunk Sha256SeedCorruptionModal-2PCZQ3O6) and the
 *   wallet disables itself. Not feasible in scope.
 *
 * METHOD B (PERSISTENT PROFILE) — what this script does.
 *   1. Launch a headed Chromium with a persistent user-data-dir.
 *   2. Open chrome-extension://<phantomId>/onboarding.html.
 *   3. Drive the React onboarding UI:
 *        "I already have a wallet" → "Recovery Phrase" → 12-word entry
 *        → password → confirm → finish.
 *   4. Close. The user-data-dir now contains a fully-onboarded, unlocked
 *      Phantom that can be re-loaded by subsequent tests with
 *      `chromium.launchPersistentContext(profileDir, …)`.
 *
 * Re-running with --reset wipes the profile.
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const PHANTOM = resolve(__dirname, 'real-wallets', 'phantom');
const PROFILE_DIR = resolve(__dirname, '.seeded-phantom-profile');
const SCREENSHOTS = resolve(__dirname, 'screenshots');
const PHANTOM_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';
const PASSWORD = 'TestPwd123!TestPwd123!';
const WALLET = JSON.parse(readFileSync(resolve(__dirname, 'wallet.json'), 'utf8'));

const log = (...m) => process.stdout.write('[seed] ' + m.join(' ') + '\n');

if (process.argv.includes('--reset') && existsSync(PROFILE_DIR)) {
  log('reset: removing', PROFILE_DIR);
  rmSync(PROFILE_DIR, { recursive: true, force: true });
}
mkdirSync(PROFILE_DIR, { recursive: true });
mkdirSync(SCREENSHOTS, { recursive: true });

async function waitForExtensionReady(context, extId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sw = context.serviceWorkers().find((w) => w.url().includes(extId));
    if (sw) return sw;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`SW for ${extId} did not start in ${timeoutMs}ms`);
}

async function dump(page, label) {
  const path = resolve(SCREENSHOTS, `seed-${label}.png`);
  try {
    await page.screenshot({ path });
    log('  screenshot', label, '→', path);
  } catch (e) {
    log('  screenshot failed', label, e.message);
  }
}

async function main() {
  log('SolShield  :', SOLSHIELD);
  log('Phantom    :', PHANTOM);
  log('Profile dir:', PROFILE_DIR);
  log('Password   :', PASSWORD);
  log('Mnemonic   :', WALLET.mnemonic);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    locale: 'en-US',
    args: [
      `--disable-extensions-except=${SOLSHIELD},${PHANTOM}`,
      `--load-extension=${SOLSHIELD},${PHANTOM}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--lang=en-US',
    ],
    viewport: { width: 1280, height: 900 },
  });

  log('waiting for Phantom SW…');
  let sw;
  try {
    sw = await waitForExtensionReady(context, PHANTOM_ID, 20000);
    log('Phantom SW up:', sw.url());
  } catch (e) {
    log('Phantom SW did not start:', e.message);
    log('listing all SWs found:');
    for (const w of context.serviceWorkers()) log('  -', w.url());
  }

  // Open onboarding page directly.
  const page = await context.newPage();
  const onboardingUrl = `chrome-extension://${PHANTOM_ID}/onboarding.html`;
  log('navigating to', onboardingUrl);
  await page.goto(onboardingUrl, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);
  await dump(page, 't0-loaded');

  // Phantom React onboarding flow.
  // We try multiple selector strategies because the build has both i18n keys
  // and data-testid attributes. We click whatever we can find.

  const tryClickByText = async (regex, timeout = 8000) => {
    log(`  click text /${regex.source}/i`);
    try {
      const loc = page.getByText(regex).first();
      await loc.waitFor({ state: 'visible', timeout });
      await loc.click({ timeout: 3000 });
      return true;
    } catch (e) {
      log(`    not found: ${e.message.split('\n')[0]}`);
      return false;
    }
  };

  const tryClickByTestId = async (id, timeout = 5000) => {
    log(`  click testid=${id}`);
    try {
      const loc = page.getByTestId(id).first();
      await loc.waitFor({ state: 'visible', timeout });
      await loc.click({ timeout: 3000 });
      return true;
    } catch (e) {
      log(`    not found: ${e.message.split('\n')[0]}`);
      return false;
    }
  };

  // Step 1 — pick "I already have a wallet" / "Import an existing wallet"
  await dump(page, 't1-landing');
  const step1 =
    (await tryClickByText(/i already have a wallet/i, 8000)) ||
    (await tryClickByText(/import.*existing wallet/i, 5000)) ||
    (await tryClickByTestId('import-wallet-option', 5000)) ||
    (await tryClickByText(/import wallet/i, 5000));
  if (!step1) {
    log('FAIL: could not find import-wallet entry point');
    await dump(page, 'fail-step1');
    await context.close();
    process.exit(2);
  }
  await page.waitForTimeout(1500);
  await dump(page, 't2-after-import-clicked');

  // Step 2 — pick "Import Recovery Phrase" card.
  // Use exact-text role-based match to avoid hitting the page description copy.
  log('  click "Import Recovery Phrase" card');
  let step2 = false;
  try {
    const card = page.getByText(/^Import Recovery Phrase$/).first();
    await card.waitFor({ state: 'visible', timeout: 6000 });
    await card.click({ timeout: 3000 });
    step2 = true;
  } catch (e) {
    log('    exact match failed:', e.message.split('\n')[0]);
  }
  if (!step2) {
    // Fallback: locate row by aria/role
    try {
      const row = page.locator('div,button,a').filter({ hasText: /^Import Recovery Phrase$/ }).first();
      await row.click({ timeout: 4000 });
      step2 = true;
    } catch (e) {
      log('    locator-filter failed:', e.message.split('\n')[0]);
    }
  }
  await page.waitForTimeout(1500);
  await dump(page, 't3-after-recovery-phrase');

  // Step 3 — enter the 12 words. Phantom typically renders 12 separate inputs.
  const words = WALLET.mnemonic.trim().split(/\s+/);
  log(`  entering ${words.length} mnemonic words`);
  // Try contenteditable / input strategy: tab-focus then type each word.
  // Strategy 1: find inputs by aria role.
  let entered = false;
  try {
    const inputs = page.locator('input[type="password"], input[type="text"]');
    const count = await inputs.count();
    log(`    found ${count} input candidates`);
    if (count >= words.length) {
      for (let i = 0; i < words.length; i++) {
        await inputs.nth(i).fill(words[i]);
      }
      entered = true;
    }
  } catch (e) {
    log('    strategy 1 failed:', e.message.split('\n')[0]);
  }
  // Strategy 2: paste into first input.
  if (!entered) {
    log('    fallback: paste full phrase into focused element');
    try {
      await page.keyboard.press('Tab');
      await page.keyboard.type(WALLET.mnemonic, { delay: 30 });
      entered = true;
    } catch (e) {
      log('    strategy 2 failed:', e.message.split('\n')[0]);
    }
  }
  await dump(page, 't4-words-entered');

  // Step 4 — click Import / Continue.
  await page.waitForTimeout(800);
  const stepImport =
    (await tryClickByTestId('onboarding-form-submit-button', 4000)) ||
    (await tryClickByText(/^import secret recovery phrase$/i, 3000)) ||
    (await tryClickByText(/^import$/i, 3000)) ||
    (await tryClickByText(/continue/i, 3000));
  if (!stepImport) log('  warn: could not click submit after seed entry');
  await page.waitForTimeout(2500);
  await dump(page, 't5-after-import-submit');

  // Step 5 — wallet selection (Phantom enumerates accounts derived from the
  // seed). Click "Import" or "Continue".
  await tryClickByText(/^continue$/i, 4000);
  await page.waitForTimeout(1500);
  await dump(page, 't6-after-account-select');

  // Step 6 — password creation.
  log('  filling password');
  try {
    const pwd = page.getByTestId('onboarding-form-password-input').first();
    await pwd.waitFor({ state: 'visible', timeout: 8000 });
    await pwd.fill(PASSWORD);
    const cnf = page.getByTestId('onboarding-form-confirm-password-input').first();
    await cnf.fill(PASSWORD);
  } catch (e) {
    log('    password input not found via testid:', e.message.split('\n')[0]);
    // fallback: type into password type inputs
    const pwds = page.locator('input[type="password"]');
    const c = await pwds.count();
    if (c >= 2) {
      await pwds.nth(0).fill(PASSWORD);
      await pwds.nth(1).fill(PASSWORD);
    }
  }
  // Tick TOS
  try {
    await page.getByTestId('onboarding-form-terms-of-service-checkbox').click({ timeout: 3000 });
  } catch {}
  await dump(page, 't7-password-filled');

  // Click submit.
  await tryClickByTestId('onboarding-form-submit-button', 4000);
  await page.waitForTimeout(3000);
  await dump(page, 't8-after-password-submit');

  // Step 7 — "You're all ready" → "Get Started".
  await tryClickByText(/get started|finish|continue|done/i, 8000);
  await page.waitForTimeout(2000);
  await dump(page, 't9-final');

  // Step 8 — Create Username screen (auto-suggested) → just hit Continue.
  await tryClickByText(/^continue$/i, 5000);
  await page.waitForTimeout(2000);
  await dump(page, 't10-after-username');

  // Step 9 — sometimes a "Set as default" / additional perms → skip / continue.
  await tryClickByText(/skip|not now|continue|done/i, 4000);
  await page.waitForTimeout(1500);
  await dump(page, 't11-after-perms');

  log('onboarding done — verifying via popup');

  // Verify by opening popup.html — if unlocked, it shouldn't ask for password.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${PHANTOM_ID}/popup.html`, { waitUntil: 'load' });
  await popup.waitForTimeout(2500);
  await popup.screenshot({ path: resolve(SCREENSHOTS, 'seed-popup-after-onboarding.png') });

  // Click any "Continue" / "Agree" / "Got it" button on first popup open.
  for (const re of [/continue/i, /agree/i, /got it/i, /accept/i]) {
    try {
      const b = popup.getByRole('button', { name: re }).first();
      if (await b.isVisible({ timeout: 1500 })) {
        await b.click({ timeout: 2000 });
        await popup.waitForTimeout(800);
      }
    } catch {}
  }
  await popup.screenshot({ path: resolve(SCREENSHOTS, 'seed-popup-after-tos.png') });

  // Check if there's a password prompt visible (means we're locked).
  const lockedHint = await popup.locator('input[type="password"]').count();
  log('popup: input[type=password] count =', lockedHint);
  if (lockedHint > 0) {
    log('popup is locked — entering password');
    await popup.locator('input[type="password"]').first().fill(PASSWORD);
    const submitBtn = popup.locator('button[type="submit"], button:has-text("Unlock"), button:has-text("Continue")').first();
    await submitBtn.click({ timeout: 3000 }).catch(() => {});
    await popup.waitForTimeout(2500);
  }
  await popup.screenshot({ path: resolve(SCREENSHOTS, 'seed-popup-unlocked.png') });

  log('persistent profile saved at:', PROFILE_DIR);
  log('done. close the browser when ready (10s grace…)');
  await new Promise((r) => setTimeout(r, 10000));
  await context.close();
  process.exit(0);
}

main().catch(async (e) => {
  log('FATAL:', e.message);
  console.error(e);
  process.exit(1);
});
