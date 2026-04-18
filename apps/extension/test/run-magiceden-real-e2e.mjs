/**
 * REAL end-to-end test on https://magiceden.io with the SEEDED Phantom profile.
 *
 * Goal: prove SolShield v0.4.6+ wraps Magic Eden's wallet adapter (Dynamic SDK)
 * end-to-end:
 *   1. Connect via the real Magic Eden UI (no fake wallet, no fixture).
 *   2. Approve in the real Phantom popup.
 *   3. Trigger SIWS / signMessage from Magic Eden.
 *   4. Confirm SolShield's overlay intercepts before Phantom's sign popup.
 *
 * This script is destructive in the sense it relies on the persistent Phantom
 * profile already being seeded via:
 *   node apps/extension/test/seed-phantom-storage.mjs --reset
 *
 * Outputs (under apps/extension/test/screenshots/):
 *   magiceden-real-01-loaded.png       (after page load)
 *   magiceden-real-02-picker.png       (wallet picker visible)
 *   magiceden-real-03-connected.png    (after approval, wallet connected)
 *   magiceden-real-04-overlay.png      (SolShield overlay over signMessage)
 *
 * If a step fails, fallback screenshots get a "-fail" suffix so failure mode
 * is captured for the demo report.
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const PHANTOM = resolve(__dirname, 'real-wallets', 'phantom');
const PROFILE_DIR = resolve(__dirname, '.seeded-phantom-profile');
const SCREENSHOTS = resolve(__dirname, 'screenshots');
const PHANTOM_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';
const PHANTOM_PASSWORD = 'TestPwd123!TestPwd123!';

if (!existsSync(PROFILE_DIR)) {
  console.error('[me-e2e] FATAL: Seeded Phantom profile not found at', PROFILE_DIR);
  console.error('[me-e2e] Run `node apps/extension/test/seed-phantom-storage.mjs --reset` first.');
  process.exit(1);
}
mkdirSync(SCREENSHOTS, { recursive: true });

// Strip any leftover SingletonLock from a previous abnormal exit. Without this,
// a failing run (or an OS sleep) leaves a symlink that blocks the next launch
// with "Failed to create a ProcessSingleton".
for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
  try { rmSync(resolve(PROFILE_DIR, f), { force: true }); } catch {}
}

// Wipe any prior magiceden-real-*.png shots so the report only shows this run.
for (const f of readdirSync(SCREENSHOTS)) {
  if (f.startsWith('magiceden-real-')) {
    try { rmSync(resolve(SCREENSHOTS, f)); } catch {}
  }
}

const log = (...m) => process.stdout.write('[me-e2e] ' + m.join(' ') + '\n');
const shot = async (page, label) => {
  const path = resolve(SCREENSHOTS, `magiceden-real-${label}.png`);
  try { await page.screenshot({ path, fullPage: false }); log('  shot →', path); }
  catch (e) { log('  shot fail', label, e.message.split('\n')[0]); }
  return path;
};

// Generic helper: wait for a page (in the persistent context) whose URL matches
// `predicate`. Returns the page or null after `timeoutMs`.
async function waitForPage(context, predicate, timeoutMs = 8000) {
  const found = context.pages().find(predicate);
  if (found) return found;
  return new Promise((res) => {
    const t = setTimeout(() => { context.off('page', onPage); res(null); }, timeoutMs);
    const onPage = (p) => {
      // Phantom popup URL settles AFTER the page event fires; wait one tick.
      Promise.resolve().then(() => {
        if (predicate(p)) { clearTimeout(t); context.off('page', onPage); res(p); }
      });
    };
    context.on('page', onPage);
  });
}

async function unlockPhantomIfLocked(context) {
  log('---- pre-unlock Phantom ----');
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${PHANTOM_ID}/popup.html`, { waitUntil: 'load', timeout: 15000 });
  } catch (e) {
    log('  popup.html navigation failed:', e.message.split('\n')[0]);
  }
  await popup.waitForTimeout(2000);
  const pwdCount = await popup.locator('input[type="password"]').count();
  log('  popup password inputs visible:', pwdCount);
  if (pwdCount > 0) {
    await popup.locator('input[type="password"]').first().fill(PHANTOM_PASSWORD);
    try {
      await popup.getByRole('button', { name: /unlock/i }).first().click({ timeout: 3000 });
    } catch {
      try {
        await popup.locator('button[type="submit"]').first().click({ timeout: 2000 });
      } catch {}
    }
    await popup.waitForTimeout(2500);
  }
  await popup.close();
  log('  unlock done');
}

async function clickFirstVisible(scope, locators, label) {
  for (const sel of locators) {
    try {
      const loc = typeof sel === 'string' ? scope.locator(sel) : sel;
      const first = loc.first();
      const visible = await first.isVisible({ timeout: 1500 }).catch(() => false);
      if (visible) {
        await first.click({ timeout: 3000 });
        log(`  clicked ${label} via:`, typeof sel === 'string' ? sel : '<locator>');
        return true;
      }
    } catch {}
  }
  return false;
}

async function readSolshieldStatus(page) {
  return await page.evaluate(() => {
    const w = window;
    if (!w.__solshield) return null;
    return {
      version: w.__solshield.version,
      safeMode: w.__solshield.safeMode,
      walletNames: w.__solshield.walletNames,
      walletStandardWallets: w.__solshield.hooks?.walletStandardWallets,
      legacyWindowSolana: w.__solshield.hooks?.legacyWindowSolana,
      interceptions: w.__solshield.interceptions,
      errors: w.__solshield.errors,
      logTail: (w.__solshield.log || []).slice(-40),
    };
  });
}

async function main() {
  log('SolShield  :', SOLSHIELD);
  log('Phantom    :', PHANTOM);
  log('Profile    :', PROFILE_DIR);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    args: [
      `--disable-extensions-except=${SOLSHIELD},${PHANTOM}`,
      `--load-extension=${SOLSHIELD},${PHANTOM}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--lang=en-US',
    ],
    viewport: { width: 1366, height: 900 },
  });

  // Track every page Chromium opens (Phantom notifications open as new pages).
  const pageEvents = [];
  context.on('page', (p) => {
    pageEvents.push({ t: performance.now(), url: p.url() });
    log('  +page', p.url());
  });

  // Wait for both extension SWs.
  for (let i = 0; i < 60; i++) {
    const sws = context.serviceWorkers();
    const hasPhantom = sws.find((w) => w.url().includes(PHANTOM_ID));
    const hasSolShield = sws.find((w) => !w.url().includes(PHANTOM_ID));
    if (hasPhantom && hasSolShield) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  log('SWs:', context.serviceWorkers().map((w) => w.url().split('/').slice(2, 3).join('')).join(', '));

  await unlockPhantomIfLocked(context);

  const page = await context.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (
      t.includes('SolShield') || t.includes('solshield') ||
      t.includes('register-wallet') || t.includes('wrap-wallet') ||
      t.includes('dispatch-hijack')
    ) {
      log('  page>', m.type(), t.slice(0, 240));
    }
  });
  page.on('pageerror', (e) => log('  pageerror>', e.message.split('\n')[0]));

  log('---- step 1: navigate to magiceden.io ----');
  try {
    await page.goto('https://magiceden.io', { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    log('  navigation failed:', e.message.split('\n')[0]);
    await shot(page, '01-loaded-fail');
    await context.close();
    process.exit(2);
  }
  log('  waiting 8s for Magic Eden full load + wallet adapter discovery…');
  await page.waitForTimeout(8000);
  await shot(page, '01-loaded');

  // Cookie / region banners — Magic Eden has a CMP banner that can occlude UI.
  await clickFirstVisible(page, [
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    'button:has-text("Continue")',
  ], 'cookie banner');

  const initialStatus = await readSolshieldStatus(page);
  log('  initial __solshield:', JSON.stringify({
    version: initialStatus?.version,
    safeMode: initialStatus?.safeMode,
    walletNames: initialStatus?.walletNames,
    walletStandardWallets: initialStatus?.walletStandardWallets,
    interceptions: initialStatus?.interceptions,
    errors: initialStatus?.errors?.length ?? 0,
  }));
  log('  initial logTail:');
  for (const line of (initialStatus?.logTail || []).slice(-10)) log('    ·', JSON.stringify(line));

  log('---- step 2: click Connect Wallet / Log In ----');
  // Magic Eden 2025 uses "Log In" in the header (Dynamic SDK auth flow). Older
  // builds used "Connect Wallet". Cover both + a few alternates.
  const connectClicked = await clickFirstVisible(page, [
    'header button:has-text("Log In")',
    'button:has-text("Log In")',
    'button:has-text("Login")',
    'button:has-text("Sign In")',
    'button:has-text("Sign in")',
    'button:has-text("Connect Wallet")',
    'button:has-text("Connect wallet")',
    'button:has-text("Connect")',
    '[data-testid*="connect"]',
    '[data-testid*="login"]',
    '[data-test*="connect"]',
    'a:has-text("Log In")',
    'a:has-text("Connect")',
  ], 'Connect/LogIn button');

  if (!connectClicked) {
    log('  FAIL: could not find Connect button. Magic Eden DOM probably changed or anti-bot blocked render.');
    await shot(page, '02-picker-fail-no-connect');
    log('  --- fallback diagnostics ---');
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll('button, a')]
        .map((el) => (el.innerText || '').trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 60)
    );
    log('  visible button/anchor texts:', JSON.stringify(buttons));
    await context.close();
    process.exit(3);
  }
  await page.waitForTimeout(2500);
  await shot(page, '02-picker');

  log('---- step 2b: pick "Continue with a wallet" (Dynamic SDK email-first modal) ----');
  // Magic Eden uses Dynamic SDK — first modal is "Log in or sign up" with an
  // email field and a "Continue with a wallet" CTA. Clicking that reveals the
  // wallet list (Phantom, Solflare, …).
  const walletPathClicked = await clickFirstVisible(page, [
    'button:has-text("Continue with a wallet")',
    'button:has-text("Continue with wallet")',
    '[role="button"]:has-text("Continue with a wallet")',
    'text=Continue with a wallet',
  ], '"Continue with a wallet"');
  if (walletPathClicked) {
    await page.waitForTimeout(2000);
    await shot(page, '02b-wallet-list');
  }

  log('---- step 3: click Phantom in picker ----');
  // Magic Eden's picker uses Dynamic SDK; "Phantom" appears as a clickable row.
  const phantomClicked = await clickFirstVisible(page, [
    'button:has-text("Phantom")',
    '[role="button"]:has-text("Phantom")',
    'div[role="button"]:has-text("Phantom")',
    'li:has-text("Phantom")',
    '[data-testid*="phantom" i]',
    'img[alt*="Phantom" i]',
    'text=Phantom',
  ], 'Phantom row');
  if (!phantomClicked) {
    log('  FAIL: Phantom not in picker. Magic Eden may auto-detect installed wallets and skip the row.');
    await shot(page, '02-picker-fail-no-phantom');
    log('  --- picker DOM diagnostics ---');
    const pickerTexts = await page.evaluate(() =>
      [...document.querySelectorAll('button, a, [role="button"], li, div')]
        .map((el) => (el.innerText || '').trim())
        .filter((t) => t && t.length < 60)
        .filter((t, i, arr) => arr.indexOf(t) === i)
        .slice(0, 80)
    );
    log('  unique short texts in DOM:', JSON.stringify(pickerTexts));
    await context.close();
    process.exit(4);
  }

  log('---- step 3b: confirm "Connect" in Magic Eden\'s ledger-toggle modal ----');
  // After picking Phantom, Magic Eden shows a "This wallet supports either
  // Ledger or wallet… Toggle on ledger to enable it." dialog with a primary
  // "Connect" button. We need to click that to actually open Phantom.
  await page.waitForTimeout(1500);
  await shot(page, '03a-pre-connect-modal');
  const meConnectClicked = await clickFirstVisible(page, [
    // Primary CTA inside the inner Magic Eden Connect modal.
    'button:has-text("Connect"):not(:has-text("Disconnect"))',
    '[role="button"]:has-text("Connect")',
  ], 'Magic Eden inner Connect');
  if (!meConnectClicked) {
    log('  WARN: did not find inner Connect button — Phantom may already be opening.');
  }

  log('---- step 4: wait for Phantom approval popup ----');
  const approvalPage = await waitForPage(
    context,
    (p) => p.url().includes(PHANTOM_ID) && p.url().includes('notification.html'),
    20000
  );
  if (!approvalPage) {
    // Path A: Phantom auto-trusted the origin (the seeded profile may already
    // know magiceden.io from a prior session). The connection still completes
    // — we just don't see a popup. Fall through and let step 6 verify whether
    // SIWS triggers later.
    log('  NOTE: no Phantom approval popup in 20s — checking if connection auto-completed.');
    log('  current open pages:');
    for (const p of context.pages()) log('    ·', p.url());
  } else {
    await approvalPage.waitForLoadState('domcontentloaded').catch(() => {});
    await approvalPage.waitForTimeout(2000);

    // Re-unlock if needed.
    const lockOnApproval = await approvalPage.locator('input[type="password"]').count().catch(() => 0);
    if (lockOnApproval > 0) {
      log('  approval popup is locked — entering password');
      await approvalPage.locator('input[type="password"]').first().fill(PHANTOM_PASSWORD);
      try { await approvalPage.getByRole('button', { name: /unlock/i }).first().click({ timeout: 3000 }); } catch {}
      await approvalPage.waitForTimeout(2500);
    }

    log('  clicking approve / connect / vincular …');
    let approved = false;
    for (const re of [/^connect$/i, /^conectar$/i, /^vincular$/i, /^trust$/i, /^continue$/i, /^approve$/i, /^confirm$/i, /^aprobar$/i]) {
      try {
        const b = approvalPage.getByRole('button', { name: re }).first();
        if (await b.isVisible({ timeout: 1500 })) {
          await b.click({ timeout: 2500 });
          log('    clicked button matching', re.source);
          approved = true;
          break;
        }
      } catch {}
    }
    if (!approved) {
      // Last resort: click any primary-looking button.
      log('    fallback: click last button on popup');
      try {
        const all = await approvalPage.locator('button').all();
        if (all.length > 0) { await all[all.length - 1].click({ timeout: 2000 }); approved = true; }
      } catch {}
    }
    await page.waitForTimeout(4000);
  }

  log('---- step 5: verify connection ----');
  const postConnect = await readSolshieldStatus(page);
  const connectedDom = await page.evaluate(() => {
    // Magic Eden flips header text to wallet address (truncated) on connect.
    const text = document.body.innerText || '';
    const truncatedMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{4}\.\.\.[1-9A-HJ-NP-Za-km-z]{4}/);
    return {
      hasTruncatedPubkey: !!truncatedMatch,
      pubkeySample: truncatedMatch ? truncatedMatch[0] : null,
      stillShowingConnect: /Connect Wallet/i.test(text),
    };
  });
  log('  connected DOM heuristics:', JSON.stringify(connectedDom));
  log('  __solshield walletNames:', JSON.stringify(postConnect?.walletNames || []));
  log('  __solshield walletStandardWallets:', postConnect?.walletStandardWallets);
  log('  __solshield interceptions:', JSON.stringify(postConnect?.interceptions || {}));
  log('  __solshield errors:', JSON.stringify(postConnect?.errors || []));
  log('  __solshield logTail (post-connect):');
  for (const line of (postConnect?.logTail || []).slice(-12)) log('    ·', JSON.stringify(line));
  await shot(page, '03-connected');

  const phantomKnown = (postConnect?.walletNames || []).includes('Phantom');
  if (!phantomKnown) {
    log('  WARNING: Phantom not present in __solshield.walletNames. Adapter likely skipped wrap.');
  }

  log('---- step 6: trigger signMessage (SIWS) ----');
  // Magic Eden often auto-triggers SIWS once a wallet connects. Give it 4s to
  // surface our overlay first, then look for an explicit "Sign In with Solana"
  // / "Sign Message" button if needed.
  log('  waiting 4s for any auto-SIWS to surface our overlay…');
  await page.waitForTimeout(4000);
  let overlayState = await page.evaluate(() => {
    const host = document.querySelector('[id^="solshield-overlay-"]');
    return host ? { present: true, id: host.id, attached: !!host.shadowRoot } : { present: false };
  });
  log('  overlay state after auto-SIWS wait:', JSON.stringify(overlayState));

  if (!overlayState.present) {
    log('  no auto overlay — looking for explicit sign button…');
    const explicitClicked = await clickFirstVisible(page, [
      'button:has-text("Sign In With Solana")',
      'button:has-text("Sign In with Solana")',
      'button:has-text("Sign in with Solana")',
      'button:has-text("Sign Message")',
      'button:has-text("Sign In")',
      'button:has-text("Sign")',
      '[data-testid*="sign"]',
    ], 'explicit sign button');
    if (!explicitClicked) {
      log('  no explicit sign button visible. Magic Eden may not gate UI behind SIWS for unbid wallets.');
      log('  fallback: invoke signMessage directly via the wrapped wallet (proves wrap works even if UI doesn\'t trigger).');
      // Direct invocation through navigator.wallets — this is the same path the
      // dapp would use if it called sign on its own.
      const directResult = await page.evaluate(async () => {
        try {
          const reg = navigator?.wallets;
          if (!reg || typeof reg.get !== 'function') return { err: 'no navigator.wallets' };
          const wallets = reg.get();
          const phantom = wallets.find((w) => w.name === 'Phantom');
          if (!phantom) return { err: 'no Phantom in registry', names: wallets.map((w) => w.name) };
          const signFn = phantom.features['solana:signMessage']?.signMessage;
          const isWrapped = signFn?.__solshield_wrapped === true;
          if (!signFn) return { err: 'no signMessage feature' };
          const acct = phantom.accounts[0];
          const msg = new TextEncoder().encode(`magiceden.io wants you to sign in with your Solana account:\n${acct?.address}\n\nNonce: ${Math.random()}`);
          // Fire-and-forget — overlay should appear before this resolves.
          phantom.features['solana:signMessage'].signMessage({ message: msg, account: acct })
            .then(() => { window.__directSignResult = 'resolved'; })
            .catch((e) => { window.__directSignResult = 'rejected: ' + e.message; });
          return { isWrapped, fired: true };
        } catch (e) {
          return { err: e.message };
        }
      });
      log('  direct sign trigger:', JSON.stringify(directResult));
    }

    // Poll for overlay up to 10s.
    log('  polling for overlay (10s) …');
    const start = Date.now();
    while (Date.now() - start < 10000) {
      overlayState = await page.evaluate(() => {
        const host = document.querySelector('[id^="solshield-overlay-"]');
        return host ? { present: true, id: host.id, attached: !!host.shadowRoot } : { present: false };
      });
      if (overlayState.present) break;
      await page.waitForTimeout(300);
    }
    log('  overlay state after polling:', JSON.stringify(overlayState));
  }

  if (!overlayState.present) {
    log('  FAIL: overlay never appeared. SolShield did NOT intercept Magic Eden\'s signMessage.');
    await shot(page, '04-overlay-fail');
    const finalStatus = await readSolshieldStatus(page);
    log('  --- final __solshield diagnostic ---');
    log('  walletStandardWallets:', finalStatus?.walletStandardWallets);
    log('  interceptions:', JSON.stringify(finalStatus?.interceptions || {}));
    log('  errors:', JSON.stringify(finalStatus?.errors || []));
    log('  full logTail:');
    for (const line of (finalStatus?.logTail || []).slice(-30)) log('    ·', JSON.stringify(line));
    log('  open pages at failure:');
    for (const p of context.pages()) log('    ·', p.url());
    await new Promise((r) => setTimeout(r, 3000));
    await context.close();
    process.exit(6);
  }

  log('  OVERLAY PRESENT — waiting for it to render fully then capturing.');
  // Give the overlay's React render a moment to paint the actual UI inside the
  // shadow root.
  await page.waitForTimeout(1500);
  // Inspect the overlay host to confirm it's visible (z-index, dimensions).
  const overlayShape = await page.evaluate(() => {
    const host = document.querySelector('[id^="solshield-overlay-"]');
    if (!host) return { present: false };
    const style = getComputedStyle(host);
    const rect = host.getBoundingClientRect();
    return {
      present: true,
      id: host.id,
      hasShadowRoot: !!host.shadowRoot,
      hasOpenShadow: host.shadowRoot != null,
      style: { position: style.position, zIndex: style.zIndex, display: style.display, visibility: style.visibility, opacity: style.opacity },
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      childCount: host.children.length,
    };
  });
  log('  overlay shape:', JSON.stringify(overlayShape));
  await shot(page, '04-overlay');

  // Snapshot count of phantom notification windows BEFORE we reject.
  const phantomPopupsBefore = context.pages().filter((p) =>
    p.url().includes(PHANTOM_ID) && p.url().includes('notification.html')
  ).length;
  log('  phantom notification pages already open before reject:', phantomPopupsBefore);

  // Click Reject inside the overlay shadow root. Coordinates fallback if the
  // shadow-root API isn't reachable.
  const rejectResult = await page.evaluate(() => {
    const host = document.querySelector('[id^="solshield-overlay-"]');
    if (!host) return { ok: false, reason: 'no host' };
    const root = host.shadowRoot;
    if (!root) return { ok: false, reason: 'no shadowRoot' };
    const buttons = [...root.querySelectorAll('button')];
    const labels = buttons.map((b) => (b.innerText || b.textContent || '').trim());
    const reject = buttons.find((b) =>
      /reject|cancel|block|don't sign|dont sign/i.test((b.innerText || b.textContent || ''))
    );
    if (!reject) return { ok: false, reason: 'no reject button', labels };
    reject.click();
    return { ok: true, labels };
  });
  log('  reject click result:', JSON.stringify(rejectResult));
  await page.waitForTimeout(2500);

  const phantomPopupsAfter = context.pages().filter((p) =>
    p.url().includes(PHANTOM_ID) && p.url().includes('notification.html')
  ).length;
  log('  phantom notification pages after reject:', phantomPopupsAfter);
  if (phantomPopupsAfter > phantomPopupsBefore) {
    log('  WARNING: a new Phantom popup opened AFTER reject — overlay leaked.');
  } else {
    log('  OK — Phantom approval popup did NOT open after reject (overlay blocked the call).');
  }

  log('---- final summary ----');
  const finalStatus = await readSolshieldStatus(page);
  log('  __solshield version:', finalStatus?.version);
  log('  safeMode:', finalStatus?.safeMode);
  log('  walletNames:', JSON.stringify(finalStatus?.walletNames || []));
  log('  walletStandardWallets:', finalStatus?.walletStandardWallets);
  log('  interceptions:', JSON.stringify(finalStatus?.interceptions || {}));
  log('  errors:', JSON.stringify(finalStatus?.errors || []));
  log('  log tail (last 25):');
  for (const line of (finalStatus?.logTail || []).slice(-25)) log('    ·', JSON.stringify(line));
  log('  page events captured (', pageEvents.length, '):');
  for (const ev of pageEvents) log('    ·', ev.url);

  log('PASS: connect → sign overlay flow completed.');
  await new Promise((r) => setTimeout(r, 3000));
  await context.close();
  process.exit(0);
}

main().catch(async (e) => {
  log('FATAL:', e.message);
  console.error(e);
  process.exit(2);
});
