/**
 * REAL wallets e2e — load SolShield v0.4.3 alongside the actual Phantom,
 * Solflare and Backpack extensions downloaded from the Chrome Web Store.
 * Hit the production API (no mocks). Verify:
 *
 *   1. SolShield boots on every dapp, version === 0.4.3, errors === 0.
 *   2. SolShield wraps the wallets that real Phantom/Solflare/Backpack
 *      register via wallet-standard.
 *   3. A real signMessage call with a permit-style payload triggers the
 *      production /api/inspect-message, the overlay appears, and clicking
 *      reject (via shadow-DOM-piercing coordinates) propagates a rejection
 *      back to the caller.
 *   4. ANTI-SPOOF: a malicious page-side listener trying to forge
 *      `solshield-decision` events with guessed requestIds cannot bypass
 *      the overlay (because v0.4.3's stopImmediatePropagation hides the
 *      show event AND the requestId from the dapp).
 *
 * Screenshots are written to test/screenshots/real-*.png.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD_PATH = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const REAL_PHANTOM = resolve(__dirname, 'real-wallets', 'phantom');
const REAL_SOLFLARE = resolve(__dirname, 'real-wallets', 'solflare');
const REAL_BACKPACK = resolve(__dirname, 'real-wallets', 'backpack');
const SCREENSHOT_DIR = resolve(__dirname, 'screenshots');
const EXPECTED_VERSION = '0.4.4';

const log = (...m) => process.stdout.write('[real] ' + m.join(' ') + '\n');

const DAPPS = [
  { name: 'magiceden', url: 'https://magiceden.io' },
  { name: 'jupiter', url: 'https://jup.ag' },
  { name: 'tensor', url: 'https://tensor.trade' },
  { name: 'dexscreener', url: 'https://dexscreener.com' },
];

const RELEVANT_TAGS = new Set([
  'boot',
  'wrap-wallet',
  'register-wallet',
  'dispatch-hijack',
  'install-sticky',
  'overlay-ask',
  'overlay-decision',
]);

async function readDiag(page) {
  return page.evaluate((relTags) => {
    const rel = new Set(relTags);
    const s = window.__solshield;
    if (!s) return { exists: false };
    const recentErrors = (s.errors || []).slice(-3).map((e) => ({
      phase: e.phase,
      message: e.message,
    }));
    const relevantLog = (s.log || [])
      .filter((entry) => rel.has(entry.tag))
      .slice(-30)
      .map((entry) => ({ tag: entry.tag, level: entry.level, msg: entry.msg }));
    return {
      exists: true,
      version: s.version,
      safeMode: s.safeMode,
      safeModeReason: s.safeModeReason,
      walletNames: Array.isArray(s.walletNames) ? s.walletNames.slice() : [],
      walletStandardWallets: s.hooks?.walletStandardWallets ?? 0,
      legacyWindowSolana: !!s.hooks?.legacyWindowSolana,
      errorsTotal: (s.errors || []).length,
      recentErrors,
      relevantLog,
    };
  }, Array.from(RELEVANT_TAGS));
}

async function smokeDapp(context, dapp) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const result = { name: dapp.name, url: dapp.url, screenshot: null, diag: null, pageErrors };
  try {
    log(`\n--- ${dapp.name} (${dapp.url}) ---`);
    await page.goto(dapp.url, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 9000));
    const sp = resolve(SCREENSHOT_DIR, `real-${dapp.name}.png`);
    await page.screenshot({ path: sp, fullPage: false }).catch(() => {});
    result.screenshot = sp;
    result.diag = await readDiag(page);
    if (result.diag.exists) {
      log(
        `  v=${result.diag.version} ws=${result.diag.walletStandardWallets} ` +
          `errors=${result.diag.errorsTotal} safeMode=${result.diag.safeMode} ` +
          `wallets=[${result.diag.walletNames.join(', ')}]`,
      );
      if (result.diag.recentErrors.length) {
        for (const e of result.diag.recentErrors) log(`  ERR[${e.phase}]: ${e.message}`);
      }
    } else {
      log(`  CRITICAL: __solshield missing on ${dapp.name}`);
    }
  } catch (err) {
    log(`  ERROR: ${err.message}`);
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

/** Build a fixture page that drives a real wallet's signMessage from
 *  inside the page (so SolShield's wrapper intercepts). The fixture also
 *  installs a malicious page-side listener that tries to forge a
 *  `solshield-decision` event. We assert the spoof fails. */
const FIXTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>SolShield real-wallet fixture</title></head>
<body>
<h1>SolShield real-wallet fixture</h1>
<p>This page calls window.phantom.solana.signMessage with a permit-style
payload that should trigger a non-safe verdict from production.</p>
<button id="go">Sign</button>
<pre id="out"></pre>
<script>
  // Anti-spoof: try to forge decisions while the overlay is up.
  window.__spoof = { showsObserved: 0, decisionsForged: 0 };
  document.addEventListener('solshield-show', (e) => {
    window.__spoof.showsObserved += 1;
    window.__spoof.lastShowDetail = e.detail;
  }, true);
  let spoofTimer = null;
  function startSpoofing() {
    if (spoofTimer) return;
    spoofTimer = setInterval(() => {
      window.__spoof.decisionsForged += 1;
      try {
        document.dispatchEvent(new CustomEvent('solshield-decision', {
          detail: { requestId: 'guess-' + window.__spoof.decisionsForged, decision: 'proceed' }
        }));
      } catch {}
    }, 25);
  }
  function stopSpoofing() { if (spoofTimer) { clearInterval(spoofTimer); spoofTimer = null; } }
  window.__startSpoofing = startSpoofing;
  window.__stopSpoofing = stopSpoofing;

  // Track all wallets registered via wallet-standard so the click handler
  // can pick one (real Phantom inserts itself this way).
  window.__wallets__ = [];

  document.getElementById('go').onclick = async () => {
    const out = document.getElementById('out');
    try {
      // Use a permit-style message that should trigger the
      // permit-style-approval rule (severity high → suspicious).
      const text = "I authorize the transfer of 100000 USDC from my wallet to merchant_address as an off-chain approval / permit.";
      const encoded = new TextEncoder().encode(text);
      // Pick the path: wallet-standard (default) or legacy provider.
      const useLegacy = new URLSearchParams(location.search).get('legacy') === '1';
      let r;
      startSpoofing();
      if (useLegacy && window.solflare && typeof window.solflare.signMessage === 'function') {
        // LEGACY direct provider call — this is the path real Solflare 2.24+
        // seals with writable:false, configurable:false. Verifies our early
        // defineProperty interceptor wraps it.
        window.__path = 'legacy-solflare';
        r = await window.solflare.signMessage(encoded);
      } else if (useLegacy && window.phantom?.solana?.signMessage) {
        window.__path = 'legacy-phantom';
        r = await window.phantom.solana.signMessage(encoded);
      } else {
        const wallets = window.__wallets__ || [];
        const target = wallets.find(w => w.features && w.features['solana:signMessage']);
        if (!target) {
          out.textContent = 'NO WALLET AVAILABLE — wallets registered=' + wallets.length;
          window.__signResult = { ok: false, msg: 'no wallet' };
          return;
        }
        window.__path = 'wallet-standard';
        r = await target.features['solana:signMessage'].signMessage({
          account: { publicKey: new Uint8Array(32) },
          message: encoded,
        });
      }
      out.textContent = 'SIGNED: ' + JSON.stringify(r).slice(0, 100);
      window.__signResult = { ok: true };
    } catch (err) {
      out.textContent = 'REJECTED: ' + (err && err.message ? err.message : String(err));
      window.__signResult = { ok: false, msg: err && err.message ? err.message : String(err) };
    } finally {
      stopSpoofing();
    }
  };

  // Re-register listener (the previous one is consumed at script start).
  window.addEventListener('wallet-standard:register-wallet', (e) => {
    try {
      const detail = e.detail;
      if (typeof detail === 'function') {
        detail({ register: (...wallets) => {
          for (const w of wallets) window.__wallets__.push(w);
          return () => {};
        }});
      }
    } catch (err) { /* ignore */ }
  });
  // Also fire app-ready so any wallet that loaded BEFORE this page sees us.
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', {
    detail: { register: (...wallets) => {
      for (const w of wallets) window.__wallets__.push(w);
      return () => {};
    }},
  }));
</script>
</body></html>`;

async function antiSpoofAndOverlayTest(context, fixtureUrl) {
  log('\n--- anti-spoof + overlay decision test (REAL API) ---');
  log(`  fixture URL: ${fixtureUrl}`);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') log(`  [page/${t}] ${msg.text()}`);
  });

  // Serve the fixture over HTTP so content scripts (and __solshield) inject.
  // chrome-extension content scripts do NOT inject into `data:` URLs.
  await page.goto(fixtureUrl, { timeout: 15000, waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 5000));

  const beforeDiag = await readDiag(page);
  log(`  pre-click __solshield: v=${beforeDiag.version} wallets=[${beforeDiag.walletNames?.join(', ') ?? ''}]`);

  // Click the sign button. The wrapper will fetch the real verdict from
  // solshield.dev, get a non-safe result, and pop the overlay.
  await page.click('#go').catch((e) => log('  click err: ' + e.message));
  log('  clicked Sign — awaiting overlay');
  // Give time for fetch + overlay mount. The overlay host id starts with
  // `solshield-overlay-`; wait up to 25s.
  let overlayPresent = false;
  let overlayHostId = null;
  for (let i = 0; i < 50; i++) {
    overlayHostId = await page.evaluate(() => {
      const els = document.querySelectorAll('[id^="solshield-overlay-"]');
      return els.length > 0 ? els[0].id : null;
    });
    if (overlayHostId) {
      overlayPresent = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  let shotShow = null;
  if (overlayPresent) {
    shotShow = resolve(SCREENSHOT_DIR, 'real-overlay-shown.png');
    await page.screenshot({ path: shotShow }).catch(() => {});
    log(`  overlay host present id=${overlayHostId} → ${shotShow}`);
  } else {
    log('  WARN: overlay never appeared in 25s — verdict may have been "safe"');
    const diagAfter = await readDiag(page);
    log(`  diag now: errors=${diagAfter.errorsTotal} safeMode=${diagAfter.safeMode}`);
    if (diagAfter.relevantLog) {
      for (const e of diagAfter.relevantLog.slice(-15)) log(`    [${e.tag}/${e.level}] ${e.msg}`);
    }
  }

  // Anti-spoof assertion: the page-side listener should NEVER have seen the
  // show event because overlay-mount calls stopImmediatePropagation in
  // capture phase BEFORE any dapp listener can see it.
  const spoof = await page.evaluate(() => window.__spoof || null);
  log(`  spoof: showsObserved=${spoof?.showsObserved}, decisionsForged=${spoof?.decisionsForged}`);

  // If overlay is up, click reject by viewport coords. Overlay layout from
  // the existing run-overlay-ui.mjs: REJECT button center ≈ (vw/2, 0.573*vh).
  let signOutcome = null;
  if (overlayPresent) {
    const vp = page.viewportSize() || { width: 1280, height: 800 };
    const rejectX = Math.round(vp.width / 2);
    const rejectY = Math.round(vp.height * 0.573);
    log(`  clicking REJECT at (${rejectX}, ${rejectY})`);
    await page.mouse.click(rejectX, rejectY);
    await new Promise((r) => setTimeout(r, 2000));
    const shotAfter = resolve(SCREENSHOT_DIR, 'real-overlay-after-reject.png');
    await page.screenshot({ path: shotAfter }).catch(() => {});
    signOutcome = await page.evaluate(() => window.__signResult || null);
    log(`  signOutcome: ${JSON.stringify(signOutcome)}`);
    log(`  screenshot → ${shotAfter}`);
  }

  const finalDiag = await readDiag(page);
  log(`  final __solshield: errors=${finalDiag.errorsTotal} safeMode=${finalDiag.safeMode}`);
  if (finalDiag.recentErrors && finalDiag.recentErrors.length) {
    log(`  recent errors:`);
    for (const e of finalDiag.recentErrors) log(`    ERR[${e.phase}]: ${e.message}`);
  }
  if (finalDiag.relevantLog) {
    log(`  recent overlay log (last 10):`);
    for (const e of finalDiag.relevantLog.slice(-10)) log(`    [${e.tag}/${e.level}] ${e.msg}`);
  }
  log(`  registered wallets in __solshield: [${finalDiag.walletNames?.join(', ') ?? ''}]`);
  // Real Phantom's wallet object has private fields whose getters throw when
  // accessed across realms, so we read .name defensively.
  const wallets = await page.evaluate(() => {
    return (window.__wallets__ || []).map((w) => {
      try { return w.name || '(unnamed)'; } catch { return '(throws)'; }
    });
  });
  log(`  page __wallets__: [${wallets.join(', ')}]`);

  await page.close().catch(() => {});

  return {
    overlayPresent,
    overlayHostId,
    spoof,
    signOutcome,
    pageErrors,
    finalDiag,
    screenshots: { show: shotShow },
  };
}

function smokeVerdict(r) {
  if (!r.diag || !r.diag.exists) return { ok: false, why: '__solshield undefined' };
  if (r.diag.version !== EXPECTED_VERSION) {
    return { ok: false, why: `version ${r.diag.version} != ${EXPECTED_VERSION}` };
  }
  if (r.diag.errorsTotal > 0) return { ok: false, why: `${r.diag.errorsTotal} errors` };
  if (r.diag.safeMode) return { ok: false, why: `safe-mode: ${r.diag.safeModeReason}` };
  return { ok: true };
}

async function startFixtureServer() {
  return new Promise((resolveSrv) => {
    const server = createServer((req, res) => {
      if (!req.url || req.url === '/' || req.url === '/fixture.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(FIXTURE_HTML);
        return;
      }
      // Silence favicon and any other 404 noise so a missing icon doesn't
      // pollute page console errors.
      res.writeHead(204);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const url = `http://127.0.0.1:${addr.port}/fixture.html`;
      resolveSrv({ server, url });
    });
  });
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  log('SolShield  :', SOLSHIELD_PATH);
  log('Phantom    :', REAL_PHANTOM);
  log('Solflare   :', REAL_SOLFLARE);
  log('Backpack   :', REAL_BACKPACK);
  log('expected v :', EXPECTED_VERSION);

  const { server: fixtureServer, url: fixtureUrl } = await startFixtureServer();
  log('fixture URL:', fixtureUrl);

  const extList = [SOLSHIELD_PATH, REAL_PHANTOM, REAL_SOLFLARE, REAL_BACKPACK].join(',');

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1366, height: 850 },
    args: [
      `--disable-extensions-except=${extList}`,
      `--load-extension=${extList}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  for (let i = 0; i < 50; i++) {
    if (context.serviceWorkers()[0]) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!context.serviceWorkers()[0]) {
    log('FAIL: no service worker — extensions did not load');
    await context.close();
    process.exit(1);
  }
  log('service workers up; settling 5s for all 4 extensions to register...');
  await new Promise((r) => setTimeout(r, 5000));

  const results = [];
  for (const dapp of DAPPS) {
    results.push(await smokeDapp(context, dapp));
  }

  const sec = await antiSpoofAndOverlayTest(context, fixtureUrl);

  log('\n=========== SMOKE SUMMARY (real wallets loaded) ===========');
  let pass = 0;
  for (const r of results) {
    const v = smokeVerdict(r);
    if (v.ok) pass++;
    log(
      `  ${v.ok ? 'OK ' : 'XX '} ${r.name.padEnd(12)} v=${r.diag?.version ?? 'n/a'} ws=${r.diag?.walletStandardWallets ?? '?'} errors=${r.diag?.errorsTotal ?? '?'} ${v.ok ? '' : 'why=' + v.why} sshot=${r.screenshot ?? 'none'}`,
    );
  }
  log(`  ${pass}/${results.length} dapps PASS`);

  log('\n=========== SECURITY (anti-spoof + overlay) ===========');
  log(`  overlay appeared:           ${sec.overlayPresent ? 'YES' : 'NO'}`);
  log(`  overlay host id:            ${sec.overlayHostId ?? 'n/a'}`);
  log(`  page saw show event:        ${sec.spoof?.showsObserved ?? 'n/a'}    (must be 0)`);
  log(`  forged decisions tried:     ${sec.spoof?.decisionsForged ?? 'n/a'}`);
  log(`  signMessage outcome:        ${JSON.stringify(sec.signOutcome)}`);
  log(`  pageErrors during sec test: ${sec.pageErrors.length}`);
  if (sec.pageErrors.length) for (const e of sec.pageErrors) log(`    ${e}`);

  const securityPass =
    sec.overlayPresent &&
    (sec.spoof?.showsObserved ?? 1) === 0 &&
    sec.signOutcome &&
    sec.signOutcome.ok === false;

  log(`\n  SECURITY VERDICT: ${securityPass ? 'PASS' : 'FAIL'}`);

  await context.close();
  fixtureServer.close();
  process.exit(pass === results.length && securityPass ? 0 : 1);
}

main().catch((e) => {
  log('runner threw:', e.message);
  console.error(e);
  process.exit(2);
});
