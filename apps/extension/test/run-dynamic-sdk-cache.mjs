/**
 * Test 4 — DYNAMIC SDK / WALLET-ADAPTER CACHED REFERENCE
 *
 * Hypothesis (the user's, the one we're trying to confirm or refute):
 *
 *   Dynamic SDK and @solana/wallet-adapter cache the wallet REFERENCE at
 *   connect-time. SolShield's wrap fires at app-ready (via the
 *   `wallet-standard:register-wallet` redispatch trick), so by connect-time
 *   the dapp ALREADY HAS our Proxy and we win — except in two scenarios:
 *
 *     (a) The dapp listens for `wallet-standard:register-wallet` synchronously
 *         using { capture: true } before our code installs its hijack. Our
 *         hijack uses `stopImmediatePropagation()` to swallow the original
 *         event; if the dapp registered earlier in capture phase OR our
 *         setTimeout-based polyfill chain did not run yet, the dapp gets the
 *         RAW wallet reference and caches that.
 *
 *     (b) The dapp polls navigator.wallets directly. We DO wrap that in
 *         init:navigator-wallets, so this should be safe — but if the dapp
 *         walks `navigator.wallets.get()` ONCE at boot, then caches each entry
 *         to a singleton, our wrap-on-the-fly logic won't help post-cache.
 *
 * This test:
 *   1. Loads magiceden.io (which uses the Dynamic SDK for connect modal).
 *   2. After load, captures a reference to the wallet object the page sees.
 *   3. Triggers connect via the page's own UI (best effort — fall back to
 *      direct wallet-standard call if magiceden's UI is not deterministic).
 *   4. Captures the cached reference AGAIN.
 *   5. Compares both references with the wrapped `__solshield_wrapped` /
 *      Proxy `defineProperty` markers we expect to find on a wrapped feature.
 *   6. Calls signMessage on the cached reference and watches __solshield log.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, existsSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const PHANTOM = resolve(__dirname, 'real-wallets', 'phantom');
const PROFILE_DIR = resolve(__dirname, '.seeded-phantom-profile');
const SCREENSHOTS = resolve(__dirname, 'screenshots');
const PHANTOM_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';
const PASSWORD = 'TestPwd123!TestPwd123!';

if (!existsSync(PROFILE_DIR)) {
  console.error('Profile not found. Run `node test/seed-phantom-storage.mjs --reset` first.');
  process.exit(1);
}
mkdirSync(SCREENSHOTS, { recursive: true });
for (const f of (await import('node:fs')).readdirSync(SCREENSHOTS)) {
  if (f.startsWith('dyn-cache-')) rmSync(resolve(SCREENSHOTS, f));
}

const log = (...m) => process.stdout.write('[dyn-cache] ' + m.join(' ') + '\n');

async function inspectWallet(page, label) {
  return await page.evaluate((label) => {
    const out = { label };
    const w = window;
    out.has_solshield = !!w.__solshield;
    out.solshield_wallets = (w.__solshield?.walletNames || []).slice();
    out.solshield_hooks = w.__solshield?.hooks || null;

    // Find any wallet-standard wallet via navigator.wallets.
    let wallets = [];
    try { if (navigator.wallets?.get) wallets = navigator.wallets.get() || []; } catch {}

    out.nav_wallets_count = wallets.length;
    out.nav_wallets = wallets.map((wlt) => {
      const r = { name: wlt?.name, hasFeatures: !!wlt?.features, featuresKeys: wlt?.features ? Object.keys(wlt.features) : [] };
      try {
        const sm = wlt?.features?.['solana:signMessage']?.signMessage;
        r.signMessage_wrapped = typeof sm === 'function' && !!sm.__solshield_wrapped;
        r.signMessage_typeof = typeof sm;
      } catch (e) { r.err = e.message; }
      return r;
    });

    // The window.phantom.solana legacy provider — is it our Proxy?
    if (w.phantom?.solana) {
      const sm = w.phantom.solana.signMessage;
      out.legacy_phantom = {
        has_signMessage: typeof sm === 'function',
        signMessage_wrapped: !!sm?.__solshield_wrapped,
        // Proxy detection: a Proxy will have a different toString than a regular function.
        toString: typeof sm === 'function' ? sm.toString().slice(0, 80) : null,
      };
    }
    return out;
  }, label);
}

async function main() {
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

  const pageEvents = [];
  context.on('page', (p) => {
    pageEvents.push({ t: performance.now(), event: 'page-opened', url: p.url() });
    log('  +page', p.url());
  });

  for (let i = 0; i < 50; i++) {
    if (context.serviceWorkers().length >= 2) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  log('SWs:', context.serviceWorkers().map((w) => w.url().split('/').slice(2, 3).join('')).join(', '));

  // Pre-unlock Phantom.
  const phantomPopup = await context.newPage();
  await phantomPopup.goto(`chrome-extension://${PHANTOM_ID}/popup.html`, { waitUntil: 'load' });
  await phantomPopup.waitForTimeout(2000);
  if ((await phantomPopup.locator('input[type="password"]').count()) > 0) {
    await phantomPopup.locator('input[type="password"]').first().fill(PASSWORD);
    try { await phantomPopup.getByRole('button', { name: /unlock/i }).first().click({ timeout: 3000 }); } catch {}
    await phantomPopup.waitForTimeout(2500);
  }
  await phantomPopup.close();

  const page = await context.newPage();
  page.on('console', (m) => log('  page>', m.text()));

  log('---- nav: magiceden.io ----');
  try {
    await page.goto('https://magiceden.io/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    log('  goto failed:', e.message);
    try { await page.goto('https://magiceden.io/', { waitUntil: 'load', timeout: 30000 }); } catch (e2) {
      log('  fallback goto failed:', e2.message);
    }
  }
  await page.waitForTimeout(8000);
  await page.screenshot({ path: resolve(SCREENSHOTS, 'dyn-cache-loaded.png') });

  // Snapshot 1 — wallets known to the page.
  const snap1 = await inspectWallet(page, 'after-load');
  log('SNAPSHOT 1 (after page load):');
  log('  ' + JSON.stringify(snap1, null, 2).split('\n').join('\n  '));

  // Capture a reference. We'll stash the first wallet found onto window.__capturedWallet.
  const captured = await page.evaluate(() => {
    let wallets = [];
    try { if (navigator.wallets?.get) wallets = navigator.wallets.get() || []; } catch {}
    const w = wallets[0];
    if (w) {
      window.__capturedWalletA = w;
      window.__capturedWalletA_signMessageRef = w.features?.['solana:signMessage']?.signMessage ?? null;
      return {
        name: w.name,
        captured: true,
        has_sm: typeof window.__capturedWalletA_signMessageRef === 'function',
        sm_wrapped: !!window.__capturedWalletA_signMessageRef?.__solshield_wrapped,
      };
    }
    return { captured: false };
  });
  log('captured wallet at boot:', JSON.stringify(captured));

  // Try to drive Magic Eden's connect modal by clicking obvious entry points.
  log('---- attempt: drive connect ----');
  let clicked = false;
  for (const re of [/connect wallet/i, /^connect$/i, /^login$/i, /sign in/i]) {
    try {
      const b = page.getByRole('button', { name: re }).first();
      if (await b.isVisible({ timeout: 2500 })) {
        await b.click({ timeout: 2000 });
        log('  clicked', re.source);
        clicked = true; break;
      }
    } catch {}
  }
  if (!clicked) log('  no connect button found via standard selectors');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: resolve(SCREENSHOTS, 'dyn-cache-after-connect-click.png') });

  // Try Phantom from any visible modal.
  for (const re of [/phantom/i]) {
    try {
      const b = page.getByText(re).first();
      if (await b.isVisible({ timeout: 2000 })) { await b.click({ timeout: 2000 }); log('  clicked Phantom in modal'); break; }
    } catch {}
  }
  await page.waitForTimeout(2500);

  // Approve any phantom popup that may have appeared.
  for (const p of context.pages()) {
    if (p.url().includes('notification.html')) {
      const pwdHere = await p.locator('input[type="password"]').count().catch(() => 0);
      if (pwdHere > 0) {
        await p.locator('input[type="password"]').first().fill(PASSWORD).catch(() => {});
        try { await p.getByRole('button', { name: /unlock/i }).first().click({ timeout: 2000 }); } catch {}
        await p.waitForTimeout(1500);
      }
      for (const re of [/^connect$/i, /^trust$/i, /^approve$/i, /^continue$/i, /^sign$/i]) {
        try {
          const b = p.getByRole('button', { name: re }).first();
          if (await b.isVisible({ timeout: 1500 })) { await b.click({ timeout: 2000 }); log('  popup click', re.source); break; }
        } catch {}
      }
    }
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: resolve(SCREENSHOTS, 'dyn-cache-after-connect-resolve.png') });

  // Snapshot 2 — what does the page see now?
  const snap2 = await inspectWallet(page, 'after-connect');
  log('SNAPSHOT 2 (after connect attempt):');
  log('  ' + JSON.stringify(snap2, null, 2).split('\n').join('\n  '));

  // Capture a reference AGAIN.
  const captured2 = await page.evaluate(() => {
    let wallets = [];
    try { if (navigator.wallets?.get) wallets = navigator.wallets.get() || []; } catch {}
    const w = wallets[0];
    if (w) {
      window.__capturedWalletB = w;
      window.__capturedWalletB_signMessageRef = w.features?.['solana:signMessage']?.signMessage ?? null;
      return {
        name: w.name,
        same_as_A_obj: window.__capturedWalletA === w,
        same_as_A_sm: window.__capturedWalletA_signMessageRef === window.__capturedWalletB_signMessageRef,
        sm_wrapped: !!window.__capturedWalletB_signMessageRef?.__solshield_wrapped,
      };
    }
    return { captured: false };
  });
  log('captured wallet after connect:', JSON.stringify(captured2));

  // Now invoke signMessage via the captured A reference (worst case: dapp
  // cached the early reference) AND via fresh navigator.wallets lookup.
  log('---- trigger: signMessage via captured-A reference ----');
  const callA = await page.evaluate(async () => {
    const w = window.__capturedWalletA;
    if (!w?.features?.['solana:signMessage']?.signMessage) return { ok: false, err: 'no signMessage' };
    const sm = w.features['solana:signMessage'].signMessage;
    const start = performance.now();
    try {
      const out = await sm({ account: w.accounts?.[0], message: new TextEncoder().encode('captured-A test ' + Date.now()) });
      return { ok: true, dt: performance.now() - start, wrapped: !!sm.__solshield_wrapped, out_keys: Object.keys(out?.[0] || out || {}) };
    } catch (e) {
      return { ok: false, dt: performance.now() - start, err: e.message, code: e.code, wrapped: !!sm.__solshield_wrapped };
    }
  });
  log('result via captured-A:', JSON.stringify(callA));

  log('---- trigger: signMessage via fresh navigator.wallets ----');
  const callFresh = await page.evaluate(async () => {
    let wallets = [];
    try { if (navigator.wallets?.get) wallets = navigator.wallets.get() || []; } catch {}
    const w = wallets[0];
    if (!w?.features?.['solana:signMessage']?.signMessage) return { ok: false, err: 'no signMessage' };
    const sm = w.features['solana:signMessage'].signMessage;
    const start = performance.now();
    try {
      const out = await sm({ account: w.accounts?.[0], message: new TextEncoder().encode('fresh test ' + Date.now()) });
      return { ok: true, dt: performance.now() - start, wrapped: !!sm.__solshield_wrapped, out_keys: Object.keys(out?.[0] || out || {}) };
    } catch (e) {
      return { ok: false, dt: performance.now() - start, err: e.message, code: e.code, wrapped: !!sm.__solshield_wrapped };
    }
  });
  log('result via fresh:', JSON.stringify(callFresh));

  // Final SolShield log dump.
  const ss = await page.evaluate(() => {
    if (!window.__solshield) return { absent: true };
    return {
      version: window.__solshield.version,
      hooks: window.__solshield.hooks,
      walletNames: window.__solshield.walletNames,
      interceptions: window.__solshield.interceptions,
      log_intercept: (window.__solshield.log || []).filter((e) => e.tag === 'intercept' || e.tag === 'verdict' || e.tag === 'overlay-ask' || e.tag === 'wrap-wallet' || e.tag === 'register-wallet' || e.tag === 'dispatch-hijack' || e.tag === 'nav-wallets').map((e) => `${e.level}/${e.tag}: ${e.msg}`),
      log_tail: (window.__solshield.log || []).slice(-30).map((e) => `${e.level}/${e.tag}: ${e.msg}`),
    };
  });
  log('solshield final state:');
  log('  version:', ss.version);
  log('  hooks  :', JSON.stringify(ss.hooks));
  log('  walletNames:', JSON.stringify(ss.walletNames));
  log('  interceptions:', JSON.stringify(ss.interceptions));
  log('  intercept/wrap-wallet/register-wallet/dispatch-hijack events:');
  for (const m of ss.log_intercept || []) log('   ', m);

  log('VERDICT:');
  // If captured-A signMessage is wrapped → caching is safe.
  // If captured-A wrapped=false but fresh wrapped=true → CACHING IS UNSAFE for early callers.
  const aWrapped = captured.sm_wrapped;
  const bWrapped = captured2.sm_wrapped;
  const aRef = callA.wrapped;
  const freshRef = callFresh.wrapped;
  if (aWrapped && bWrapped && aRef && freshRef) {
    log('  All references wrapped: SolShield wrap survives Dynamic SDK caching.');
  } else if (!aWrapped && bWrapped) {
    log('  RACE-CONFIRMED: early reference (captured at boot) was NOT wrapped, later reference IS wrapped. Dapps that cache early lose protection.');
  } else if (!aWrapped && !bWrapped && !aRef && !freshRef) {
    log('  NO WRAP at all on this dapp — wallet-standard register-wallet path may have been short-circuited (dapp uses different discovery).');
  } else {
    log('  Mixed result — see snapshots and trace above.');
  }

  await new Promise((r) => setTimeout(r, 4000));
  await context.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
