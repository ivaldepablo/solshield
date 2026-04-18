/**
 * OBSERVATIONAL test: capture exactly what windows/popups the browser opens
 * when a dapp calls signMessage / connect, with precise timing.
 *
 * Method C — observation of browser events. NO Phantom unlock required.
 *
 * Detects:
 *   - Phantom popup (chrome-extension://bfnaelmomeimhlpmgjnjophhpkkoljpa/popup.html)
 *   - SolShield overlay (DOM element [id^="solshield-overlay-"])
 *   - Service workers from both extensions
 *   - Page-load events
 *
 * Reports a TIMELINE per dapp with millisecond-relative timestamps.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const PHANTOM = resolve(__dirname, 'real-wallets', 'phantom');
const SHOTS_DIR = resolve(__dirname, 'screenshots');
mkdirSync(SHOTS_DIR, { recursive: true });

// Phantom's deterministic extension id is derived from the public key in its
// manifest "key" field (already verified in the manifest).
const PHANTOM_EXT_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';
const PHANTOM_URL_PREFIX = `chrome-extension://${PHANTOM_EXT_ID}`;

const log = (...m) => process.stdout.write('[timing] ' + m.join(' ') + '\n');

// ---- Local fixture HTTP server ------------------------------------------

const FIXTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>SolShield Timing Fixture</title></head>
<body style="font-family: monospace; padding: 24px;">
  <h1>SolShield popup-timing fixture</h1>
  <button id="connect" style="font-size: 18px; padding: 12px 20px;">Connect</button>
  <button id="sign" style="font-size: 18px; padding: 12px 20px; margin-left: 8px;">Sign</button>
  <pre id="out" style="white-space: pre-wrap;"></pre>
  <script>
    const out = document.getElementById('out');
    const log = (m) => { out.textContent += m + '\\n'; console.log('[fixture]', m); };
    log('window.phantom present? ' + !!window.phantom);
    log('window.phantom?.solana present? ' + !!(window.phantom && window.phantom.solana));
    document.getElementById('connect').onclick = async () => {
      log('connect clicked at t=' + Date.now());
      try {
        const r = await window.phantom?.solana?.connect();
        log('connect resolved: ' + JSON.stringify(r));
      } catch (e) { log('connect rejected: ' + e.message); }
    };
    document.getElementById('sign').onclick = async () => {
      log('sign clicked at t=' + Date.now());
      try {
        const msg = new TextEncoder().encode('observational test ' + Date.now());
        const r = await window.phantom?.solana?.signMessage(msg);
        log('sign resolved: ' + JSON.stringify(r));
      } catch (e) { log('sign rejected: ' + e.message); }
    };
  </script>
</body></html>`;

function startFixtureServer() {
  return new Promise((resolveStart) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(FIXTURE_HTML);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolveStart({ server, port });
    });
  });
}

// ---- Timeline recording -------------------------------------------------

class Timeline {
  constructor(label) {
    this.label = label;
    this.t0 = Date.now();
    this.events = [];
  }
  rel() { return Date.now() - this.t0; }
  add(kind, detail) {
    const t = this.rel();
    this.events.push({ t, kind, detail });
    log(`  [${this.label}] +${String(t).padStart(5)}ms  ${kind}  ${detail || ''}`);
  }
  reset() { this.t0 = Date.now(); this.events = []; }
}

function classifyPage(url) {
  if (!url) return 'unknown';
  if (url.startsWith(PHANTOM_URL_PREFIX)) return 'PHANTOM-POPUP';
  if (url.startsWith('chrome-extension://')) return 'OTHER-EXTENSION';
  if (url.startsWith('http')) return 'WEB-PAGE';
  if (url.startsWith('about:') || url === 'about:blank') return 'ABOUT';
  return 'OTHER';
}

async function snapshotPagesAndOverlay(context, mainPage) {
  const pages = context.pages();
  const pageInfo = pages.map((p) => {
    let url = '';
    try { url = p.url(); } catch {}
    return { url, kind: classifyPage(url) };
  });
  let overlayPresent = false;
  let overlayId = null;
  try {
    const r = await mainPage.evaluate(() => {
      const el = document.querySelector('[id^="solshield-overlay-"]');
      return el ? { present: true, id: el.id } : { present: false };
    });
    overlayPresent = r.present;
    overlayId = r.id || null;
  } catch {}
  return { pages: pageInfo, overlayPresent, overlayId };
}

// ---- Per-dapp test ------------------------------------------------------

async function runDappObservation(context, target, opts) {
  const { name, url, trigger } = target;
  const { phantomPopupPages } = opts;
  const tl = new Timeline(name);
  const shotPrefix = resolve(SHOTS_DIR, `timing-${name}`);

  log(`\n=== ${name} (${url}) ===`);

  // Snapshot pages that existed BEFORE this dapp run so we can distinguish
  // a popup that already existed (Phantom onboarding tab) from one that the
  // trigger actually opened.
  const preExistingUrls = new Set(context.pages().map((p) => { try { return p.url(); } catch { return ''; } }));
  log(`  pre-existing pages (${preExistingUrls.size}): ${[...preExistingUrls].join(' | ')}`);

  const mainPage = await context.newPage();
  mainPage.on('pageerror', (e) => tl.add('PAGE-ERROR', e.message.slice(0, 120)));

  tl.add('NAV-START', url);
  try {
    await mainPage.goto(url, { timeout: 25000, waitUntil: 'domcontentloaded' });
  } catch (e) {
    tl.add('NAV-ERR', e.message.slice(0, 120));
  }
  tl.add('NAV-DONE');

  // Let extensions register
  await new Promise((r) => setTimeout(r, 5000));
  tl.add('SETTLE-5s');

  // Probe SolShield + wallet presence
  let probe = null;
  try {
    probe = await mainPage.evaluate(() => ({
      solshieldVersion: window.__solshield?.version || null,
      walletNames: window.__solshield?.walletNames || null,
      hasPhantomGlobal: !!(window.phantom && window.phantom.solana),
      isPhantom: !!(window.phantom?.solana?.isPhantom),
    }));
  } catch (e) {
    probe = { error: e.message };
  }
  tl.add('PROBE', JSON.stringify(probe));

  // Reset clock for trigger phase
  tl.reset();
  tl.add('TRIGGER-START', trigger);

  // Run the trigger
  try {
    if (trigger === 'fixture-sign') {
      await mainPage.click('#sign', { timeout: 3000 });
    } else if (trigger === 'fixture-connect') {
      await mainPage.click('#connect', { timeout: 3000 });
    } else if (trigger === 'real-connect') {
      // Try a few common selectors for "Connect Wallet"
      const selectors = [
        'button:has-text("Connect Wallet")',
        'button:has-text("Connect")',
        '[data-testid*="connect"]',
        'a:has-text("Connect")',
      ];
      let clicked = false;
      for (const sel of selectors) {
        try {
          const el = await mainPage.locator(sel).first();
          if (await el.count() > 0) {
            await el.click({ timeout: 2000 });
            tl.add('CLICK-OK', sel);
            clicked = true;
            break;
          }
        } catch {}
      }
      if (!clicked) tl.add('CLICK-MISS', 'no connect button found');
    }
  } catch (e) {
    tl.add('TRIGGER-ERR', e.message.slice(0, 120));
  }

  // Sample every 100 ms for 5 s; screenshot every 500 ms.
  const samples = [];
  const totalMs = 5000;
  const step = 100;
  let phantomNewPopupCaptured = false;
  for (let i = 0; i * step < totalMs; i++) {
    const snap = await snapshotPagesAndOverlay(context, mainPage);
    samples.push({ t: tl.rel(), ...snap });

    // Detect new state vs previous sample
    const prev = samples[i - 1];
    if (!prev || prev.pages.length !== snap.pages.length) {
      tl.add('PAGES-COUNT', String(snap.pages.length) + ' kinds=' + snap.pages.map((p) => p.kind).join(','));
    }
    // NEW phantom popup means url not seen before AND not in pre-existing
    const prevUrls = new Set((prev?.pages || []).map((p) => p.url));
    const newPhantomPopups = snap.pages.filter(
      (p) => p.kind === 'PHANTOM-POPUP' && !prevUrls.has(p.url) && !preExistingUrls.has(p.url),
    );
    for (const np of newPhantomPopups) tl.add('PHANTOM-POPUP-NEW', np.url);

    if (!prev?.overlayPresent && snap.overlayPresent) {
      tl.add('SOLSHIELD-OVERLAY-APPEARED', snap.overlayId || '');
    }

    // Capture phantom popup screenshot the FIRST time we see a NEW one
    if (!phantomNewPopupCaptured && newPhantomPopups.length > 0) {
      const phantomPage = context.pages().find((p) => {
        try { return p.url() === newPhantomPopups[0].url; } catch { return false; }
      });
      if (phantomPage) {
        try {
          await new Promise((r) => setTimeout(r, 200));
          const vp = phantomPage.viewportSize();
          const shotPath = resolve(SHOTS_DIR, `phantom-popup-${name}.png`);
          await phantomPage.screenshot({ path: shotPath });
          tl.add('PHANTOM-SHOT', `${shotPath} viewport=${vp ? vp.width + 'x' + vp.height : 'unknown'}`);
          phantomPopupPages.push({ dapp: name, url: phantomPage.url(), viewport: vp, screenshot: shotPath });
          phantomNewPopupCaptured = true;
        } catch (e) {
          tl.add('PHANTOM-SHOT-ERR', e.message.slice(0, 80));
        }
      }
    }

    // Periodic screenshot of main page
    if (i % 5 === 0) {
      try {
        await mainPage.screenshot({ path: `${shotPrefix}-t${String(i).padStart(2, '0')}.png` });
      } catch {}
    }
    await new Promise((r) => setTimeout(r, step));
  }

  tl.add('SAMPLE-DONE');

  // Final overlay state
  const finalSnap = await snapshotPagesAndOverlay(context, mainPage);
  tl.add('FINAL', `pages=${finalSnap.pages.length} overlay=${finalSnap.overlayPresent}`);

  await mainPage.close().catch(() => {});

  return {
    name,
    url,
    trigger,
    probe,
    timeline: tl.events,
    samples,
    saw: {
      phantomNewPopup: tl.events.some((e) => e.kind === 'PHANTOM-POPUP-NEW'),
      solshieldOverlay: tl.events.some((e) => e.kind === 'SOLSHIELD-OVERLAY-APPEARED'),
      preExistingPhantomTab: [...preExistingUrls].some((u) => u.startsWith(PHANTOM_URL_PREFIX)),
    },
  };
}

// ---- Main ---------------------------------------------------------------

async function main() {
  log('SolShield:', SOLSHIELD);
  log('Phantom  :', PHANTOM);

  const { server, port } = await startFixtureServer();
  const fixtureUrl = `http://127.0.0.1:${port}/`;
  log('fixture  :', fixtureUrl);

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${SOLSHIELD},${PHANTOM}`,
      `--load-extension=${SOLSHIELD},${PHANTOM}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  // Hook BEFORE any navigation
  const allPagesSeen = [];
  const allSwSeen = [];
  const t0 = Date.now();
  context.on('page', (page) => {
    let url = '';
    try { url = page.url(); } catch {}
    const rec = { t: Date.now() - t0, url, kind: classifyPage(url) };
    allPagesSeen.push(rec);
    log(`[ctx] +${rec.t}ms PAGE opened url=${rec.url || '(blank)'} kind=${rec.kind}`);
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        try {
          const u = frame.url();
          const k = classifyPage(u);
          allPagesSeen.push({ t: Date.now() - t0, url: u, kind: k, ev: 'framenavigated' });
          log(`[ctx] +${Date.now() - t0}ms FRAMENAV url=${u} kind=${k}`);
        } catch {}
      }
    });
    page.on('close', () => {
      log(`[ctx] +${Date.now() - t0}ms PAGE closed url=${page.url()}`);
    });
  });
  context.on('serviceworker', (sw) => {
    const u = sw.url();
    allSwSeen.push({ t: Date.now() - t0, url: u });
    log(`[ctx] +${Date.now() - t0}ms SW url=${u}`);
  });

  // Wait for initial SW
  for (let i = 0; i < 30; i++) {
    if (context.serviceWorkers().length >= 1) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await new Promise((r) => setTimeout(r, 4000));
  log(`init: ${context.serviceWorkers().length} SWs, ${context.pages().length} pages`);

  const phantomPopupPages = [];
  const opts = { phantomPopupPages };

  const targets = [
    { name: 'fixture-connect', url: fixtureUrl, trigger: 'fixture-connect' },
    { name: 'fixture-sign', url: fixtureUrl, trigger: 'fixture-sign' },
    { name: 'magiceden', url: 'https://magiceden.io', trigger: 'real-connect' },
    { name: 'jupiter', url: 'https://jup.ag', trigger: 'real-connect' },
    { name: 'dexscreener', url: 'https://dexscreener.com', trigger: 'real-connect' },
  ];

  const results = [];
  for (const t of targets) {
    try {
      const r = await runDappObservation(context, t, opts);
      results.push(r);
    } catch (e) {
      log('dapp threw:', e.message);
      results.push({ name: t.name, error: e.message });
    }
  }

  log('\n\n========== TIMELINE SUMMARY ==========');
  for (const r of results) {
    log(`\n--- ${r.name} (probe: ${JSON.stringify(r.probe)}) ---`);
    if (!r.timeline) { log('  no timeline (error)'); continue; }
    for (const e of r.timeline) {
      log(`  +${String(e.t).padStart(5)}ms  ${e.kind}  ${e.detail || ''}`);
    }
    log(`  -> phantomPopup=${r.saw.phantomPopup} overlay=${r.saw.solshieldOverlay}`);
  }

  log('\nPhantom popups captured:');
  for (const p of phantomPopupPages) log(`  ${p.dapp}: url=${p.url} viewport=${JSON.stringify(p.viewport)}`);

  // Dump JSON for post-mortem
  const dumpPath = resolve(SHOTS_DIR, 'popup-timing-dump.json');
  writeFileSync(dumpPath, JSON.stringify({ allPagesSeen, allSwSeen, results, phantomPopupPages }, null, 2));
  log('\ndump:', dumpPath);

  await context.close();
  server.close();
  log('done');
  process.exit(0);
}

main().catch((e) => {
  log('runner threw:', e.message);
  console.error(e);
  process.exit(2);
});
