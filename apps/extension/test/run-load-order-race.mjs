/**
 * Test 1 — EXTENSION LOAD ORDER RACE
 *
 * Hypothesis: Chromium MV3 content scripts run in load-order. If Phantom is
 * loaded BEFORE SolShield, Phantom may seal `window.phantom.solana` via a
 * non-configurable defineProperty before our early-defineProperty interceptor
 * gets a chance to wrap it. In that case `install-sticky` falls back to the
 * sealed-property branch and (likely) silently no-ops.
 *
 * This test repeatedly launches a fresh Chromium with --load-extension in a
 * specific order and reads back __solshield.log to verify which path actually
 * fired:
 *    "early-defineProperty: wrapped …" → win
 *    "install-sticky: silently no-opped (sealed property)" → loss
 *    no log entries about phantom.solana at all → also loss
 *
 * Then we exercise window.phantom.solana.signMessage on a fresh non-onboarded
 * Phantom (it'll throw because it's locked, but the wrap status is what we're
 * measuring, not the sign result).
 *
 * Variants:
 *   A) load-extension=PHANTOM,SOLSHIELD     (Phantom first)
 *   B) load-extension=SOLSHIELD,PHANTOM     (SolShield first)
 *   C) all-three: PHANTOM, SOLFLARE, BACKPACK, SOLSHIELD
 *   D) all-three reversed: SOLSHIELD, BACKPACK, SOLFLARE, PHANTOM
 *
 * No real wallet unlock is required — the goal is to inspect the wrap install
 * log on a freshly-loaded page.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const PHANTOM = resolve(__dirname, 'real-wallets', 'phantom');
const SOLFLARE = resolve(__dirname, 'real-wallets', 'solflare');
const BACKPACK = resolve(__dirname, 'real-wallets', 'backpack');
const SCREENSHOTS = resolve(__dirname, 'screenshots');
const PORT = 7421;

mkdirSync(SCREENSHOTS, { recursive: true });

const log = (...m) => process.stdout.write('[load-order] ' + m.join(' ') + '\n');

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Load Order Probe</title></head>
<body><h1>Probe</h1><pre id="out"></pre>
<script>
(async () => {
  const out = document.getElementById('out');
  const log = (m) => { out.textContent += m + '\\n'; console.log('[probe]', m); };
  // Wait briefly for content scripts to settle.
  await new Promise(r => setTimeout(r, 1500));

  const probe = {
    has_window_solana: !!window.solana,
    has_window_phantom: !!window.phantom,
    has_phantom_solana: !!(window.phantom && window.phantom.solana),
    has_solflare: !!window.solflare,
    has_backpack: !!(window.backpack || window.xnft),
    phantom_solana_descriptor: null,
    phantom_descriptor: null,
    phantom_isPhantom: window.phantom?.solana?.isPhantom ?? null,
    has_solshield_log: !!(window.__solshield && Array.isArray(window.__solshield.log)),
    solshield_version: window.__solshield?.version ?? null,
    solshield_hooks: window.__solshield?.hooks ?? null,
    solshield_log_install_sticky: [],
    solshield_log_intercept: [],
    solshield_log_all_tail: [],
  };
  try {
    const d = Object.getOwnPropertyDescriptor(window, 'phantom');
    if (d) probe.phantom_descriptor = { configurable: d.configurable, writable: d.writable, enumerable: d.enumerable, hasGetter: !!d.get, hasSetter: !!d.set };
  } catch {}
  try {
    if (window.phantom) {
      const d = Object.getOwnPropertyDescriptor(window.phantom, 'solana');
      if (d) probe.phantom_solana_descriptor = { configurable: d.configurable, writable: d.writable, enumerable: d.enumerable, hasGetter: !!d.get, hasSetter: !!d.set };
    }
  } catch {}
  if (window.__solshield && Array.isArray(window.__solshield.log)) {
    probe.solshield_log_install_sticky = window.__solshield.log.filter((e) => e.tag === 'install-sticky').map((e) => e.msg);
    probe.solshield_log_intercept = window.__solshield.log.filter((e) => e.tag === 'intercept').map((e) => e.msg);
    probe.solshield_log_all_tail = window.__solshield.log.slice(-30).map((e) => e.level + '/' + e.tag + ': ' + e.msg);
  }
  // Try to force a signMessage call. We don't care about the result; we want to
  // see whether our wrapper fires (look for [intercept] log entries).
  probe.signMessage_attempt = null;
  try {
    if (window.phantom?.solana?.signMessage) {
      const msg = new TextEncoder().encode("load-order test " + Date.now());
      const start = performance.now();
      try {
        await window.phantom.solana.signMessage(msg);
        probe.signMessage_attempt = { ok: true, ms: performance.now() - start };
      } catch (e) {
        probe.signMessage_attempt = { ok: false, err: e.message, ms: performance.now() - start };
      }
    } else {
      probe.signMessage_attempt = { ok: false, err: 'no signMessage on window.phantom.solana' };
    }
  } catch (e) {
    probe.signMessage_attempt = { ok: false, err: 'caught: ' + e.message };
  }

  // After the call, snapshot the log again.
  if (window.__solshield && Array.isArray(window.__solshield.log)) {
    probe.solshield_log_after_sign = window.__solshield.log.slice(-30).map((e) => e.level + '/' + e.tag + ': ' + e.msg);
  }

  window.__probe = probe;
  log(JSON.stringify(probe, null, 2));
})();
</script></body></html>`;

async function probeOrder(label, extOrder) {
  log(`\n=========== ${label} ===========`);
  log('order:');
  for (const ext of extOrder) log('  - ' + ext);
  // Use a brand-new ephemeral profile each time so we don't get a re-onboarded
  // Phantom from the seeded profile; a fresh Phantom will still inject and seal
  // window.phantom.
  const profile = mkdtempSync(join(tmpdir(), 'solshield-loadorder-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    locale: 'en-US',
    args: [
      `--disable-extensions-except=${extOrder.join(',')}`,
      `--load-extension=${extOrder.join(',')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--lang=en-US',
    ],
    viewport: { width: 1280, height: 900 },
  });
  // Give all SWs a moment.
  for (let i = 0; i < 30; i++) {
    if (context.serviceWorkers().length >= extOrder.length) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const sws = context.serviceWorkers().map((w) => w.url().split('/').slice(2, 3).join(''));
  log('SWs:', sws.join(', '));

  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(m.text()));
  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'load' });
  // The fixture script runs auto, so wait for it to finish.
  await page.waitForTimeout(8000);

  const probe = await page.evaluate(() => window.__probe || null);
  await page.screenshot({ path: resolve(SCREENSHOTS, `load-order-${label}.png`) });

  log('result:');
  if (!probe) {
    log('  <NO PROBE>');
  } else {
    log('  has_window_phantom:', probe.has_window_phantom);
    log('  has_phantom_solana:', probe.has_phantom_solana);
    log('  phantom descriptor:', JSON.stringify(probe.phantom_descriptor));
    log('  phantom.solana descriptor:', JSON.stringify(probe.phantom_solana_descriptor));
    log('  isPhantom flag:', probe.phantom_isPhantom);
    log('  solshield version:', probe.solshield_version);
    log('  solshield hooks:', JSON.stringify(probe.solshield_hooks));
    log('  install-sticky log:');
    for (const m of probe.solshield_log_install_sticky) log('    -', m);
    log('  intercept log:');
    for (const m of probe.solshield_log_intercept) log('    -', m);
    log('  signMessage attempt:', JSON.stringify(probe.signMessage_attempt));
    log('  log tail (after sign):');
    for (const m of probe.solshield_log_after_sign || []) log('    -', m);
  }
  await context.close();
  return probe;
}

async function main() {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(FIXTURE);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  log('fixture server :' + PORT);

  const variants = [
    { label: 'A_phantom-first', exts: [PHANTOM, SOLSHIELD] },
    { label: 'B_solshield-first', exts: [SOLSHIELD, PHANTOM] },
    { label: 'C_4wallets-solshield-last', exts: [PHANTOM, SOLFLARE, BACKPACK, SOLSHIELD] },
    { label: 'D_4wallets-solshield-first', exts: [SOLSHIELD, PHANTOM, SOLFLARE, BACKPACK] },
  ];

  const results = {};
  for (const v of variants) {
    try {
      results[v.label] = await probeOrder(v.label, v.exts);
    } catch (e) {
      log('VARIANT FAILED:', v.label, e.message);
      results[v.label] = { __error: e.message };
    }
  }

  log('\n=========== SUMMARY ===========');
  for (const v of variants) {
    const r = results[v.label];
    if (!r || r.__error) { log(`  ${v.label}: error ${r?.__error}`); continue; }
    const wrappedEarly = (r.solshield_log_install_sticky || []).some((m) => m.includes('early-defineProperty'));
    const sealedNoop = (r.solshield_log_install_sticky || []).some((m) => m.includes('silently no-opped'));
    const installedOk = (r.solshield_log_install_sticky || []).some((m) => m.includes('installed via'));
    const intercepted = (r.solshield_log_intercept || []).some((m) => m.includes('legacy signMessage'));
    let verdict;
    if (intercepted) verdict = 'WRAP-WORKS (intercept fired)';
    else if (wrappedEarly) verdict = 'WRAP-LIKELY-WORKS (early defineProperty caught it)';
    else if (sealedNoop && !installedOk) verdict = 'WRAP-FAIL-SEALED (no early catch, install no-opped on sealed property)';
    else if (installedOk) verdict = 'WRAP-INSTALLED-LATE (sticky path won, but no live intercept fired)';
    else verdict = 'WRAP-UNCLEAR (no decisive log entries)';
    log(`  ${v.label}: ${verdict}`);
    log(`     early-defineProperty=${wrappedEarly} sealed-noop=${sealedNoop} install-ok=${installedOk} intercept-fired=${intercepted}`);
  }

  server.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
