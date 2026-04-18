/**
 * UI E2E test for the SolShield v0.4.2 OVERLAY pipeline.
 *
 * Verifies four invariants:
 *   1. Overlay element appears for danger / suspicious verdicts.
 *   2. Reject button rejects the underlying signMessage call (4001).
 *   3. Proceed button forwards the call to the wallet.
 *   4. Anti-spoofing: a malicious page-side listener that catches
 *      `__solshield_show_overlay` and posts `{decision:'proceed'}` on
 *      `event.ports[0]` does NOT win the race against overlay-mount,
 *      so the overlay still appears and the user retains control.
 *
 * Tactics:
 *   - We mock `https://solshield.dev/api/inspect-message` with `page.route()`
 *     so we control the verdict deterministically. The mock fires on EVERY
 *     such request (provider-hook MAIN-world fetch + overlay-mount ISOLATED
 *     fetch), hence both interception points see the same forced verdict.
 *   - The overlay shadow root is `mode: 'closed'` since v0.4.2; we cannot
 *     query buttons via Playwright selectors. We click by COORDINATES of the
 *     known host element (the overlay component renders the reject button as
 *     the wider top button and the proceed button beneath it).
 *   - Host id is randomized: `solshield-overlay-<random8chars>`. We locate
 *     it via `[id^="solshield-overlay-"]`.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const SCREENSHOTS_DIR = resolve(__dirname, 'screenshots');
const PORT = 7398;

if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const log = (...m) => process.stdout.write('[overlay-ui] ' + m.join(' ') + '\n');

/**
 * Fixture page served from a real HTTP origin (not file://) so the extension's
 * content scripts attach normally and the page is allowed to fetch.
 *
 * The page exposes a `__runScenario(name)` global that drives the scenarios:
 *   - 'plain'        — plain signMessage call (Test 1, 2, 3)
 *   - 'antiSpoof'    — installs a malicious capture-phase listener BEFORE
 *                      calling signMessage (Test 4)
 *
 * Each scenario sets `__lastError` / `__lastResult` so the test can assert.
 */
const FIXTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>SolShield overlay-ui fixture</title></head>
<body>
<h1>SolShield overlay-ui fixture</h1>
<pre id="result">awaiting scenario...</pre>
<script>
(function () {
  let originalSignMessageCallCount = 0;
  window.__originalSignCalls = () => originalSignMessageCallCount;

  function makeFakeWallet() {
    return {
      name: 'TestPhantom',
      version: '1.0.0',
      icon: 'data:image/svg+xml;base64,PHN2Zy8+',
      chains: ['solana:mainnet'],
      accounts: [{
        address: 'TestPubKeyAddressForSolanaSimulationPlaceholder1',
        publicKey: new Uint8Array(32),
        chains: ['solana:mainnet'],
        features: ['solana:signMessage', 'standard:connect'],
      }],
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [] }) },
        'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
        'standard:events': { version: '1.0.0', on: () => () => {} },
        'solana:signMessage': {
          version: '1.0.0',
          signMessage: async (input) => {
            originalSignMessageCallCount++;
            return [{ signedMessage: input.message, signature: new Uint8Array(64) }];
          },
        },
      },
    };
  }

  // Run the wallet-standard handshake the same way every dapp does:
  // 1) install a register-wallet listener that captures wallets the extension
  //    is about to hand to "the dapp"
  // 2) dispatch register-wallet with our wallet's callback
  // 3) keep a reference to the wrapped wallet (the one the dapp would use).
  window.__capturedDappWallets = [];
  window.addEventListener('wallet-standard:register-wallet', (event) => {
    const callback = event.detail;
    if (typeof callback !== 'function') return;
    callback({
      register: (...wallets) => {
        window.__capturedDappWallets.push(...wallets);
        return () => {};
      },
    });
  });

  function dispatchWallet() {
    const wallet = makeFakeWallet();
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', {
      detail: (api) => api.register(wallet),
    }));
  }

  // anti-spoof state (Test 4): records what the malicious listener saw.
  window.__antiSpoofLog = [];

  function installSpoofingListener() {
    window.addEventListener('message', (e) => {
      try {
        if (e?.data?.__solshield_show_overlay === true) {
          window.__antiSpoofLog.push({
            sawShowOverlay: true,
            hasPort: !!e.ports?.[0],
            id: e.data.id,
          });
          const port = e.ports?.[0];
          if (port) {
            try { port.start(); } catch {}
            // Try to forge a 'proceed' BEFORE overlay-mount can see it.
            try { port.postMessage({ decision: 'proceed' }); } catch {}
          }
        }
      } catch {}
    }, true);
  }

  window.__runScenario = async function (name) {
    window.__lastResult = null;
    window.__lastError = null;
    window.__overlayWasShown = false;
    window.__originalCallsAtStart = originalSignMessageCallCount;

    if (name === 'antiSpoof') {
      installSpoofingListener();
    }

    dispatchWallet();
    await new Promise(r => setTimeout(r, 300));

    if (window.__capturedDappWallets.length === 0) {
      window.__lastError = 'no captured wallet';
      return;
    }
    const dappWallet = window.__capturedDappWallets[
      window.__capturedDappWallets.length - 1
    ];

    const phishyMsg = new TextEncoder().encode(
      'wallet-drainer.xyz/airdrop wants you to sign and approve transferAll for 100% of your SOL — claim now ' + Math.random()
    );

    // Don't await — we need control to flow back to the test harness so
    // it can detect the overlay and click. Stash the promise on window.
    window.__signPromise = (async () => {
      try {
        const out = await dappWallet.features['solana:signMessage'].signMessage({
          message: phishyMsg,
          account: dappWallet.accounts[0],
        });
        window.__lastResult = { ok: true, originalCalls: originalSignMessageCallCount };
        return out;
      } catch (e) {
        window.__lastError = { message: e?.message, code: e?.code, originalCalls: originalSignMessageCallCount };
        throw e;
      }
    })();

    return 'started';
  };
})();
</script>
</body></html>`;

function startFixtureServer() {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(FIXTURE_HTML);
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

/**
 * Build a deterministic verdict mock. Returns a body shaped like the SolShield
 * API response for `/api/inspect-message` (see api-client.ts).
 */
function buildMockVerdict(verdict) {
  return {
    verdict, // 'safe' | 'suspicious' | 'danger'
    score: verdict === 'danger' ? 92 : verdict === 'suspicious' ? 60 : 5,
    summary:
      verdict === 'danger'
        ? "wallet-drainer URL + permit-style approval — don't sign"
        : verdict === 'suspicious'
          ? 'message contains a URL — verify before clicking'
          : 'looks fine',
    findings:
      verdict === 'safe'
        ? []
        : [
            {
              severity: verdict === 'danger' ? 'critical' : 'medium',
              ruleId: 'url-in-message',
              message: 'message contains a link — verify before clicking',
            },
            {
              severity: verdict === 'danger' ? 'high' : 'low',
              ruleId: 'permit-style-approval',
              message: 'message looks like an off-chain token approval',
            },
          ],
    elapsedMs: 187,
  };
}

/**
 * Locate the overlay host element. The host is a bare <div> with closed
 * shadow DOM — from the page world its `shadowRoot` is null, and its own
 * bounding box is 0x0 because it has no layout (the card lives inside the
 * shadow root with position:fixed which escapes layout). Presence is the
 * only signal we can see from the page.
 */
async function findOverlayHost(page) {
  return await page.evaluate(() => {
    const host = document.querySelector('[id^="solshield-overlay-"]');
    if (!host) return null;
    return { id: host.id, presentInBody: document.body.contains(host) };
  });
}

/**
 * Wait until the overlay host appears (or timeout).
 */
async function waitForOverlay(page, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const host = await findOverlayHost(page);
    if (host && host.presentInBody) {
      // Give the shadow DOM one paint to mount its contents.
      await new Promise((r) => setTimeout(r, 200));
      return host;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/**
 * The overlay layout is a centered card. The two buttons live at the BOTTOM
 * of the card stacked vertically:
 *   [ ✓ REJECT & CLOSE     ]  ← taller button (12px padding, font-size 13)
 *   [ i understand · proceed ] ← shorter button (8px padding, font-size 11)
 *
 * Card maxWidth=420, total padding = 20 each side, with content roughly:
 *   header(~40), headline+icon(~80), text(~30), findings(~70 for 2 items),
 *   buttons gap(8) + reject(~46) + proceed(~38), footer(~40)
 *
 * The overlay host fills the viewport (position:fixed inset:0). The card
 * is centered. We need to compute approximate button centers RELATIVE TO
 * THE VIEWPORT — the host's getBoundingClientRect spans the whole viewport,
 * so we use viewport center for the card x and approximate y from the
 * card's bottom.
 *
 * Strategy: rely on the fact that the card is at most 420px wide centered,
 * and the buttons are ~40px tall stacked at the bottom. We click in the
 * lower-middle area of the viewport with two distinct y offsets.
 */
async function approximateButtonCoords(page) {
  // The card is centered horizontally and vertically inside the viewport.
  // We measured the actual card layout from a screenshot:
  //   1280x800 viewport → card spans ~y=210 to y=590 (≈380px tall with 2
  //   findings, no estimated-loss section).
  // Reject button center ≈ y=458, Proceed button center ≈ y=501.
  //
  // We compute these as fractions of viewport height so different viewport
  // sizes still hit roughly correct positions. Using the measured 800px
  // viewport, fractions are 458/800=0.573 and 501/800=0.626.
  const vp = page.viewportSize() ?? { width: 1280, height: 800 };
  const cx = vp.width / 2;
  return {
    reject: { x: cx, y: Math.round(vp.height * 0.573) },
    proceed: { x: cx, y: Math.round(vp.height * 0.626) },
    viewport: vp,
  };
}

/**
 * The closed shadow root means we can't directly query buttons. To validate
 * we hit the right button, we use the CDP "DOM.getDocument" + "DOM.querySelector"
 * approach in pierce mode via JS evaluation through the extension itself.
 *
 * Practically: we check post-click side effects (signMessage rejection vs
 * resolution, original wallet call counter) to determine which button fired.
 */

async function snapshotPageState(page) {
  return await page.evaluate(() => {
    const w = window;
    return {
      lastResult: w.__lastResult,
      lastError: w.__lastError,
      originalCalls: typeof w.__originalSignCalls === 'function' ? w.__originalSignCalls() : null,
      antiSpoofLog: w.__antiSpoofLog || [],
      overlayHost: (() => {
        const h = document.querySelector('[id^="solshield-overlay-"]');
        if (!h) return null;
        return { id: h.id, hasShadow: !!h.shadowRoot, presentInBody: document.body.contains(h) };
      })(),
      solshield: w.__solshield ? {
        version: w.__solshield.version,
        safeMode: w.__solshield.safeMode,
        interceptions: w.__solshield.interceptions,
        log: w.__solshield.log.slice(-15),
        errors: w.__solshield.errors.slice(-5),
      } : null,
    };
  });
}

/**
 * After a reject click the overlay-mount unmounts the host. After a proceed
 * click same. We wait for the signPromise on the page to settle (or for
 * `__lastResult` / `__lastError` to be set).
 */
async function waitForSettle(page, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const r = await page.evaluate(() => ({
      result: window.__lastResult,
      error: window.__lastError,
    }));
    if (r.result || r.error) return r;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function reloadFixture(page) {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__runScenario === 'function');
  // Wait for SolShield content scripts to attach.
  await page.waitForFunction(() => !!window.__solshield, { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 500));
}

async function main() {
  log('extension:', EXTENSION_PATH);
  const server = await startFixtureServer();
  log('fixture server: http://localhost:' + PORT);

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  // Mock the SolShield verdict API. We mutate `mockVerdict` per-test.
  let mockVerdict = 'danger';
  await context.route('**/solshield.dev/api/inspect-message', async (route) => {
    const v = mockVerdict;
    log('  [mock] inspect-message →', v);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(buildMockVerdict(v)),
    });
  });
  await context.route('**/solshield.dev/api/inspect', async (route) => {
    const v = mockVerdict;
    log('  [mock] inspect →', v);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(buildMockVerdict(v)),
    });
  });

  // Wait for service worker.
  for (let i = 0; i < 30; i++) {
    if (context.serviceWorkers()[0]) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!context.serviceWorkers()[0]) {
    log('FAIL: extension service worker did not start');
    await context.close();
    server.close();
    process.exit(1);
  }
  log('service worker up');
  await new Promise((r) => setTimeout(r, 2000));

  const page = await context.newPage();
  const consoleEvents = [];
  page.on('console', (msg) => {
    consoleEvents.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    consoleEvents.push(`[pageerror] ${err.message}`);
  });

  const results = {};

  /* ─────── Test 1 — overlay shown for danger verdict ─────── */
  log('\n=== Test 1: overlay shown for danger verdict ===');
  mockVerdict = 'danger';
  await reloadFixture(page);
  await page.evaluate(() => window.__runScenario('plain'));

  const t1Host = await waitForOverlay(page, 12000);
  if (t1Host) {
    log('  overlay host present: id=' + t1Host.id);
    await page.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'overlay-shown.png'),
      fullPage: false,
    });
    log('  screenshot → screenshots/overlay-shown.png');
    results.test1_overlayShown = { pass: true, hostId: t1Host.id };
  } else {
    log('  FAIL: overlay never appeared');
    await page.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'overlay-shown.png'),
      fullPage: false,
    });
    const snap = await snapshotPageState(page);
    log('  state snapshot:', JSON.stringify(snap, null, 2));
    results.test1_overlayShown = { pass: false, snap };
  }

  /* ─────── Test 2 — Reject button rejects the call ─────── */
  log('\n=== Test 2: Reject button rejects the signMessage ===');
  if (!t1Host) {
    log('  SKIP — no overlay from Test 1');
    results.test2_reject = { pass: false, reason: 'no overlay' };
  } else {
    const coords = await approximateButtonCoords(page);
    log('  clicking REJECT @ ' + coords.reject.x + ',' + coords.reject.y);
    await page.mouse.click(coords.reject.x, coords.reject.y);
    const settled = await waitForSettle(page, 6000);
    await page.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'overlay-after-reject.png'),
      fullPage: false,
    });
    log('  screenshot → screenshots/overlay-after-reject.png');
    if (!settled) {
      log('  FAIL: signMessage never settled after reject click');
      results.test2_reject = { pass: false, reason: 'no settle' };
    } else if (settled.error) {
      const isRejection = String(settled.error.message || '')
        .toLowerCase()
        .includes('user rejected') || settled.error.code === 4001;
      const originalCalls = settled.error.originalCalls;
      log('  rejected: msg="' + settled.error.message + '" code=' + settled.error.code + ' originalCalls=' + originalCalls);
      results.test2_reject = {
        pass: isRejection && originalCalls === 0,
        isRejection,
        originalCalls,
        error: settled.error,
      };
    } else {
      log('  FAIL: signMessage RESOLVED instead of rejecting');
      results.test2_reject = { pass: false, reason: 'resolved unexpectedly', settled };
    }
  }

  /* ─────── Test 3 — Proceed button forwards the call ─────── */
  log('\n=== Test 3: Proceed button forwards to wallet ===');
  mockVerdict = 'danger';
  await reloadFixture(page);
  await page.evaluate(() => window.__runScenario('plain'));
  const t3Host = await waitForOverlay(page, 12000);
  if (!t3Host) {
    log('  FAIL: overlay did not appear for Test 3');
    await page.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'overlay-after-proceed.png'),
      fullPage: false,
    });
    results.test3_proceed = { pass: false, reason: 'no overlay' };
  } else {
    const coords = await approximateButtonCoords(page);
    log('  clicking PROCEED @ ' + coords.proceed.x + ',' + coords.proceed.y);
    await page.mouse.click(coords.proceed.x, coords.proceed.y);
    const settled = await waitForSettle(page, 6000);
    await page.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'overlay-after-proceed.png'),
      fullPage: false,
    });
    log('  screenshot → screenshots/overlay-after-proceed.png');
    if (!settled) {
      log('  FAIL: signMessage never settled after proceed click');
      results.test3_proceed = { pass: false, reason: 'no settle' };
    } else if (settled.result?.ok) {
      log('  proceeded: originalCalls=' + settled.result.originalCalls);
      results.test3_proceed = {
        pass: settled.result.originalCalls >= 1,
        originalCalls: settled.result.originalCalls,
      };
    } else {
      log('  FAIL: signMessage REJECTED instead of resolving — proceed button did not fire');
      log('  error=', JSON.stringify(settled.error));
      results.test3_proceed = { pass: false, reason: 'rejected unexpectedly', settled };
    }
  }

  /* ─────── Test 4 — Anti-spoofing (CRITICAL) ─────── */
  log('\n=== Test 4: Anti-spoofing — malicious port forge MUST NOT win ===');
  mockVerdict = 'danger';
  await reloadFixture(page);
  await page.evaluate(() => window.__runScenario('antiSpoof'));

  const t4Host = await waitForOverlay(page, 12000);
  if (t4Host) {
    log('  overlay STILL APPEARED despite spoofing attempt → anti-spoof DEFENSE HOLDS');
    await page.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'overlay-anti-spoof.png'),
      fullPage: false,
    });
    log('  screenshot → screenshots/overlay-anti-spoof.png');
    // Click reject to confirm flow finishes correctly under spoofing pressure.
    const coords = await approximateButtonCoords(page);
    await page.mouse.click(coords.reject.x, coords.reject.y);
    const settled = await waitForSettle(page, 6000);
    const snap = await snapshotPageState(page);
    log('  spoof listener saw show-overlay event:', JSON.stringify(snap.antiSpoofLog));
    log('  settle after reject:', JSON.stringify(settled));
    results.test4_antiSpoof = {
      pass:
        !!settled?.error &&
        (settled.error.code === 4001 || /user rejected/i.test(settled.error.message || '')) &&
        settled.error.originalCalls === 0,
      antiSpoofLog: snap.antiSpoofLog,
      settled,
      defenseHeld: true,
    };
  } else {
    // Overlay never appeared → either the spoofing port-message reached
    // provider-hook's port1 first and resolved 'proceed', OR something else
    // broke. Check what happened.
    await page.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'overlay-anti-spoof.png'),
      fullPage: false,
    });
    log('  screenshot → screenshots/overlay-anti-spoof.png');
    const settled = await waitForSettle(page, 4000);
    const snap = await snapshotPageState(page);
    log('  no overlay. spoof log:', JSON.stringify(snap.antiSpoofLog));
    log('  settle:', JSON.stringify(settled));
    log('  __solshield.log tail:', JSON.stringify(snap.solshield?.log));
    if (settled?.result?.ok && snap.antiSpoofLog?.[0]?.hasPort) {
      log('  CRITICAL: spoofing forged proceed and signMessage ran — defense FAILED');
      results.test4_antiSpoof = {
        pass: false,
        critical: 'spoofing succeeded',
        antiSpoofLog: snap.antiSpoofLog,
        settled,
        defenseHeld: false,
      };
    } else {
      log('  overlay missing but spoof did not succeed — partial state');
      results.test4_antiSpoof = {
        pass: false,
        reason: 'overlay missing AND spoof inconclusive',
        antiSpoofLog: snap.antiSpoofLog,
        settled,
        snap,
      };
    }
  }

  /* ─────── SUMMARY ─────── */
  log('\n=== SUMMARY ===');
  const tests = [
    { name: 'Test 1: overlay shown',       k: 'test1_overlayShown' },
    { name: 'Test 2: reject button',       k: 'test2_reject' },
    { name: 'Test 3: proceed button',      k: 'test3_proceed' },
    { name: 'Test 4: anti-spoofing',       k: 'test4_antiSpoof' },
  ];
  let passed = 0;
  for (const t of tests) {
    const r = results[t.k];
    const ok = !!r?.pass;
    if (ok) passed++;
    log(`  ${ok ? '✓' : '✗'} ${t.name}${ok ? '' : ' — ' + JSON.stringify(r).slice(0, 200)}`);
  }
  log(`\n${passed}/${tests.length} tests passed`);
  log('\nScreenshots:');
  log('  - ' + resolve(SCREENSHOTS_DIR, 'overlay-shown.png'));
  log('  - ' + resolve(SCREENSHOTS_DIR, 'overlay-after-reject.png'));
  log('  - ' + resolve(SCREENSHOTS_DIR, 'overlay-after-proceed.png'));
  log('  - ' + resolve(SCREENSHOTS_DIR, 'overlay-anti-spoof.png'));

  if (passed < tests.length) {
    log('\n--- console events (last 30) ---');
    for (const e of consoleEvents.slice(-30)) log('  ' + e);
    const finalSnap = await snapshotPageState(page).catch(() => null);
    if (finalSnap) {
      log('\n--- final __solshield.log tail ---');
      for (const l of finalSnap.solshield?.log ?? []) log('  ' + JSON.stringify(l));
      log('\n--- final __solshield.errors ---');
      for (const e of finalSnap.solshield?.errors ?? []) log('  ' + JSON.stringify(e));
    }
  }

  await context.close();
  server.close();
  process.exit(passed === tests.length ? 0 : 1);
}

main().catch((e) => {
  log('runner threw:', e.message);
  console.error(e);
  process.exit(2);
});
