/**
 * Test 2 — AUTO-SIGN ON CONNECT (SIWS-style autosign)
 *
 * Hypothesis: Some dapps (Tensor, Drift, Magic Eden via Dynamic SDK, …) call
 * signMessage IMMEDIATELY after connect resolves so they can authenticate the
 * user via Sign-In-With-Solana (SIWS). When this happens:
 *
 *  - Phantom may have an "auto-approve" / trusted-app cache that fires the
 *    signature without showing a notification window.
 *  - Even if it doesn't, the call sequence is fast enough that our overlay
 *    needs to render BEFORE Phantom shows its own UI.
 *
 * The fixture below is written to look as much like a real SIWS handshake as
 * possible: it grabs window.phantom.solana right after the script runs (no
 * user click), calls connect({ onlyIfTrusted: false }) and immediately calls
 * signMessage with a SIWS-style payload.
 *
 * We then measure:
 *   - did __solshield log an `intercept` for the signMessage?
 *   - did our overlay element appear in the DOM (querySelector
 *     '[id^="solshield-overlay-"]' resolves)?
 *   - did Phantom open a notification window in parallel?
 *   - timing of each event vs. the connect-resolved timestamp.
 *
 * The seeded Phantom profile already trusts whatever origin we use (anyone who
 * onboards then approves once). We use 127.0.0.1:7431 — the FIRST run will
 * require a manual approval, so this test BOTH approves the connect popup AND
 * then asserts the autosign behaviour happens on the SAME page load (we don't
 * reload between connect and autosign — we trigger them back-to-back).
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const PHANTOM = resolve(__dirname, 'real-wallets', 'phantom');
const PROFILE_DIR = resolve(__dirname, '.seeded-phantom-profile');
const SCREENSHOTS = resolve(__dirname, 'screenshots');
const PHANTOM_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';
const PASSWORD = 'TestPwd123!TestPwd123!';
const PORT = 7431;

if (!existsSync(PROFILE_DIR)) {
  console.error('Profile not found. Run `node test/seed-phantom-storage.mjs --reset` first.');
  process.exit(1);
}
mkdirSync(SCREENSHOTS, { recursive: true });
for (const f of (await import('node:fs')).readdirSync(SCREENSHOTS)) {
  if (f.startsWith('autosign-')) rmSync(resolve(SCREENSHOTS, f));
}

const log = (...m) => process.stdout.write('[autosign] ' + m.join(' ') + '\n');

// SIWS-style autosign fixture — connect+sign in onload, no user interaction.
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>SIWS Autosign</title></head>
<body><h1>SIWS autosign probe</h1><pre id="out"></pre>
<script>
window.__events = [];
const stamp = (e, extra) => window.__events.push({ t: performance.now(), e, ...(extra || {}) });
window.__autosign_done = false;

(async () => {
  const out = document.getElementById('out');
  const log = (m) => { out.textContent += m + '\\n'; console.log('[siws]', m); };
  stamp('script-start');

  for (let i = 0; i < 200; i++) {
    if (window.phantom?.solana) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!window.phantom?.solana) { log('Phantom not injected'); window.__autosign_done = true; return; }
  stamp('phantom-detected');

  const wallet = window.phantom.solana;

  // 1) connect (already trusted from seeded profile after the manual approve
  // run; if not, Phantom will pop a notification window and we approve it
  // from the test harness).
  stamp('connect-call');
  let connectResult;
  try {
    connectResult = await wallet.connect({ onlyIfTrusted: false });
    stamp('connect-resolved', { pubkey: connectResult?.publicKey?.toString?.() });
  } catch (e) {
    stamp('connect-rejected', { err: e.message });
    log('connect failed: ' + e.message);
    window.__autosign_done = true;
    return;
  }

  // 2) IMMEDIATELY signMessage — no user click, no setTimeout — emulating SIWS.
  stamp('autosign-call');
  const message = new TextEncoder().encode("phishing.com wants you to sign in with your Solana account:\\n\\nDrain my wallet\\n\\nURI: https://phishing.com\\nVersion: 1\\nChain ID: solana:mainnet\\nNonce: " + Math.random().toString(36).slice(2) + "\\nIssued At: " + new Date().toISOString());
  try {
    const r = await wallet.signMessage(message, 'utf8');
    stamp('autosign-resolved', { bytes: r.signature?.length });
    log('autosign OK bytes=' + (r.signature?.length ?? '?'));
  } catch (e) {
    stamp('autosign-rejected', { err: e.message });
    log('autosign rejected: ' + e.message);
  }
  window.__autosign_done = true;
})();
</script></body></html>`;

async function main() {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(FIXTURE);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  log('fixture server :' + PORT);

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

  // Wait for both extension SWs.
  for (let i = 0; i < 50; i++) {
    const sws = context.serviceWorkers();
    if (sws.length >= 2) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  log('SWs:', context.serviceWorkers().map((w) => w.url().split('/').slice(2, 3).join('')).join(', '));

  // Pre-unlock Phantom.
  log('---- pre-unlock Phantom ----');
  const phantomPopup = await context.newPage();
  await phantomPopup.goto(`chrome-extension://${PHANTOM_ID}/popup.html`, { waitUntil: 'load' });
  await phantomPopup.waitForTimeout(2000);
  if ((await phantomPopup.locator('input[type="password"]').count()) > 0) {
    await phantomPopup.locator('input[type="password"]').first().fill(PASSWORD);
    try { await phantomPopup.getByRole('button', { name: /unlock/i }).first().click({ timeout: 3000 }); } catch {}
    await phantomPopup.waitForTimeout(2500);
  }
  await phantomPopup.screenshot({ path: resolve(SCREENSHOTS, 'autosign-phantom-unlocked.png') });
  await phantomPopup.close();

  // Open the fixture.
  const startT = performance.now();
  const page = await context.newPage();
  page.on('console', (m) => log('  page>', m.text()));
  page.on('pageerror', (e) => log('  pageerror>', e.message));

  // Begin a screenshot loop concurrently with navigation; the fixture is
  // expected to autosign before we click anything.
  const shots = [];
  const captureLoop = (async () => {
    for (let i = 0; i < 25; i++) {
      try {
        const path = resolve(SCREENSHOTS, `autosign-t${String(i).padStart(2, '0')}.png`);
        await page.screenshot({ path, timeout: 1500 }).catch(() => {});
        shots.push({ i, t: performance.now() - startT, path });
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
  })();

  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'load' });

  // While the autosign is running we may need to approve a connect popup
  // (first-time origin trust). Watch for a notification window in parallel.
  const approveLoop = (async () => {
    for (let i = 0; i < 20; i++) {
      for (const p of context.pages()) {
        if (p.url().includes('notification.html')) {
          // Snap and try to approve any auth-style buttons (connect / approve / sign / continue / trust).
          try {
            await p.screenshot({ path: resolve(SCREENSHOTS, `autosign-popup-${i}.png`) });
          } catch {}
          const pwdHere = await p.locator('input[type="password"]').count().catch(() => 0);
          if (pwdHere > 0) {
            await p.locator('input[type="password"]').first().fill(PASSWORD).catch(() => {});
            try { await p.getByRole('button', { name: /unlock/i }).first().click({ timeout: 2000 }); } catch {}
            await p.waitForTimeout(1500);
          }
          for (const re of [/^connect$/i, /^trust$/i, /^approve$/i, /^confirm$/i, /^continue$/i, /^sign$/i]) {
            try {
              const b = p.getByRole('button', { name: re }).first();
              if (await b.isVisible({ timeout: 800 })) { await b.click({ timeout: 1500 }); log('  popup click', re.source); break; }
            } catch {}
          }
        }
      }
      const done = await page.evaluate(() => window.__autosign_done).catch(() => false);
      if (done) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  })();

  // Wait for autosign to complete or timeout.
  const completeWait = (async () => {
    for (let i = 0; i < 60; i++) {
      const done = await page.evaluate(() => window.__autosign_done).catch(() => false);
      if (done) return;
      await new Promise((r) => setTimeout(r, 300));
    }
  })();

  await Promise.all([captureLoop, approveLoop, completeWait]);

  log('---- post-run analysis ----');
  const fixtureEvents = await page.evaluate(() => window.__events || []);
  log('fixture events (relative ms):');
  let baseT = fixtureEvents[0]?.t ?? 0;
  for (const ev of fixtureEvents) {
    log(`  +${(ev.t - baseT).toFixed(1).padStart(7, ' ')}ms  ${ev.e}  ${JSON.stringify({ ...ev, t: undefined, e: undefined })}`);
  }

  // Check for overlay presence.
  const overlayState = await page.evaluate(() => {
    const host = document.querySelector('[id^="solshield-overlay-"]');
    if (!host) return { present: false };
    const sr = host.shadowRoot;
    const visibleChildren = sr ? sr.querySelectorAll('*').length : 0;
    return {
      present: true,
      id: host.id,
      attached: !!sr,
      shadow_children: visibleChildren,
      style_display: getComputedStyle(host).display,
      style_visibility: getComputedStyle(host).visibility,
      bounding: host.getBoundingClientRect().toJSON ? host.getBoundingClientRect().toJSON() : null,
    };
  });
  log('overlay state on fixture page:', JSON.stringify(overlayState));

  // Check SolShield internal log.
  const solshieldSnap = await page.evaluate(() => {
    const w = window;
    if (!w.__solshield) return { absent: true };
    return {
      version: w.__solshield.version,
      hooks: w.__solshield.hooks,
      interceptions: w.__solshield.interceptions,
      log_intercept: (w.__solshield.log || []).filter((e) => e.tag === 'intercept' || e.tag === 'verdict' || e.tag === 'overlay-ask').map((e) => `${e.level}/${e.tag}: ${e.msg}`),
      log_tail: (w.__solshield.log || []).slice(-30).map((e) => `${e.level}/${e.tag}: ${e.msg}`),
    };
  });
  log('solshield snap:');
  log('  version:', solshieldSnap.version);
  log('  hooks  :', JSON.stringify(solshieldSnap.hooks));
  log('  intercp:', JSON.stringify(solshieldSnap.interceptions));
  log('  intercept/verdict/overlay-ask events:');
  for (const m of solshieldSnap.log_intercept || []) log('   ', m);

  log('page-events from context.on(page):');
  for (const p of pageEvents) log(`  +${(p.t - startT).toFixed(0)}ms  ${p.event}  ${p.url}`);

  // Final verdict logic:
  //   - If autosign-resolved appears BEFORE overlay-ask in the log → BYPASS
  //   - If overlay-ask appears BEFORE autosign-resolved → caught
  //   - If autosign-rejected with our 4001 → caught & user rejected
  const evMap = Object.fromEntries(fixtureEvents.map((e) => [e.e, e.t]));
  const autosignResolved = evMap['autosign-resolved'];
  const autosignRejected = evMap['autosign-rejected'];
  const overlayAsk = (solshieldSnap.log_intercept || []).find((m) => m.includes('overlay-ask'));
  const interceptCalled = (solshieldSnap.log_intercept || []).find((m) => m.includes('intercept') && m.includes('signMessage'));
  let verdict;
  if (interceptCalled) {
    verdict = autosignResolved
      ? 'CAUGHT-BUT-PROCEEDED (intercept fired, user/auto approved)'
      : (autosignRejected ? 'CAUGHT-AND-BLOCKED (intercept fired, signature rejected)' : 'CAUGHT-IN-FLIGHT');
  } else if (autosignResolved) {
    verdict = 'BYPASS (signature went through with no SolShield intercept!)';
  } else if (autosignRejected) {
    verdict = 'PHANTOM-REJECTED (no SolShield intercept; Phantom rejected for other reasons)';
  } else {
    verdict = 'UNCLEAR (no completion signals)';
  }
  log('VERDICT:', verdict);
  log('overlayState:', JSON.stringify(overlayState));

  await new Promise((r) => setTimeout(r, 3000));
  await context.close();
  server.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
