/**
 * SolShield real-flow test against UNLOCKED Solflare wallet.
 *
 * Goals:
 *  - Discover whether SolShield's overlay actually shows BEFORE Solflare's
 *    native sign popup (X < Y) or the popup races us (Y < X).
 *  - Capture timeline + screenshots so we can confirm/refute the user-reported
 *    bug ("Phantom-style popup appears in front, my overlay never visible").
 *
 * Strategy:
 *  1. chromium.launchPersistentContext with --load-extension for SolShield
 *     and the bundled Solflare extension.
 *  2. First time: walk Solflare onboarding (import 12-word mnemonic → set
 *     password → finish). Persist profile so subsequent runs skip setup.
 *  3. Serve a local fixture HTML with a "Sign" button that calls
 *     window.solflare.signMessage(suspicious-permit).
 *  4. Watch context.pages() with timestamps so we know when Solflare opens
 *     its own popup tab. Watch the fixture's #solshield-overlay-* host so we
 *     know when SolShield's overlay mounts.
 *  5. Periodic screenshots (200ms × 4s) of the fixture page so we can SEE
 *     who painted first.
 *
 * Run:   node apps/extension/test/run-solflare-real-flow.mjs
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const SOLFLARE = resolve(__dirname, 'real-wallets', 'solflare');
const PROFILE = '/tmp/solshield-solflare-profile';
const SCREENS = resolve(__dirname, 'screenshots');
const WALLET = JSON.parse(readFileSync(resolve(__dirname, 'wallet.json'), 'utf8'));

// Will be discovered at runtime by inspecting context.serviceWorkers().
let SOLFLARE_ID = '';
const PASSWORD = 'SolShieldTest123!';

mkdirSync(SCREENS, { recursive: true });

const log = (...m) => process.stdout.write('[solflare] ' + m.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 23);

// ---- Fixture page ---------------------------------------------------------
// Triggers Solflare.signMessage on click. We serve over HTTP so it's a real
// http origin (some wallet behaviors differ on file://).
const FIXTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>SolShield x Solflare fixture</title></head>
<body style="background:#1a1a2e;color:#eee;font-family:system-ui;padding:24px;">
<h1>SolShield x Solflare e2e</h1>
<button id="connect" style="font-size:16px;padding:12px 24px;margin:8px;">1. Connect Solflare</button>
<button id="sign" style="font-size:16px;padding:12px 24px;margin:8px;background:#ff4444;color:white;border:none;">2. Sign suspicious permit</button>
<pre id="out" style="background:#000;color:#0f0;padding:12px;font-size:12px;max-height:400px;overflow:auto;"></pre>
<script>
const out = document.getElementById('out');
const ts = () => new Date().toISOString().slice(11,23);
const log = (m) => { out.textContent += ts() + ' ' + m + '\\n'; console.log('[fixture]', m); };
window.__events = [];
const ev = (tag, data={}) => { const e = {t: performance.now(), tag, ...data}; window.__events.push(e); log(tag + ' ' + JSON.stringify(data)); };

// Detect ANY new <div id="solshield-overlay-*"> appearing in the DOM.
const overlayObserver = new MutationObserver(() => {
  const h = document.querySelector('[id^="solshield-overlay-"]');
  if (h && !window.__overlaySeen) {
    window.__overlaySeen = true;
    ev('overlay-mounted', { id: h.id });
  }
});
overlayObserver.observe(document.body, { childList: true, subtree: true });

// Wait for Solflare provider to inject.
function waitFor(predicate, timeout=15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const v = predicate();
        if (v) return resolve(v);
      } catch {}
      if (Date.now() - start > timeout) return reject(new Error('timeout waiting for ' + predicate.toString()));
      setTimeout(tick, 50);
    };
    tick();
  });
}

document.getElementById('connect').addEventListener('click', async () => {
  ev('connect-click');
  try {
    await waitFor(() => window.solflare);
    ev('solflare-detected', { isConnected: !!window.solflare.isConnected });
    await window.solflare.connect();
    ev('connect-resolved', { pk: window.solflare.publicKey?.toString?.() });
  } catch (e) {
    ev('connect-error', { msg: String(e && e.message || e) });
  }
});

document.getElementById('sign').addEventListener('click', async () => {
  ev('sign-click');
  if (!window.solflare) { ev('no-solflare'); return; }
  try {
    if (!window.solflare.isConnected) {
      ev('not-connected-trying-connect');
      await window.solflare.connect();
    }
    const msg = new TextEncoder().encode(
      'permit-style: I authorize the transfer of 100000 USDC from my wallet to drainer.fake/airdrop'
    );
    ev('signMessage-call');
    const result = await window.solflare.signMessage(msg, 'utf8');
    ev('signMessage-resolved', { len: result?.signature?.length || result?.length });
  } catch (e) {
    ev('signMessage-error', { msg: String(e && e.message || e) });
  }
});

window.addEventListener('load', () => ev('load'));
</script></body></html>`;

function serveFixture() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(FIXTURE_HTML);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ url: `http://127.0.0.1:${port}/fixture.html`, server });
    });
  });
}

// ---- Helpers --------------------------------------------------------------

async function shot(page, name) {
  const path = join(SCREENS, `solflare-${name}.png`);
  try {
    await page.screenshot({ path, fullPage: false });
    return path;
  } catch (e) {
    log('shot-fail', name, String(e?.message || e));
    return null;
  }
}

async function findExtensionPage(context, urlPart) {
  for (const p of context.pages()) {
    if (p.url().includes(urlPart)) return p;
  }
  return null;
}

async function dumpPagesState(context, label) {
  const pages = context.pages();
  log(`-- pages @ ${label}`);
  for (let i = 0; i < pages.length; i++) {
    log(`  [${i}] ${pages[i].url()}`);
  }
  return pages.map((p) => p.url());
}

// ---- Solflare onboarding --------------------------------------------------
// Solflare's onboarding lives at chrome-extension://<id>/wallet.html.
// First-launch UI: "Create new wallet" / "I already have a wallet".
// We try a sequence of role-based / text-based selectors with generous
// timeouts and screenshot at each major step.

async function onboardSolflare(context) {
  log('opening Solflare onboarding...');
  const onboardingUrl = `chrome-extension://${SOLFLARE_ID}/wallet.html`;
  const page = await context.newPage();
  await page.goto(onboardingUrl, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
  await sleep(2500);
  await shot(page, 'onboard-01-initial');

  // Wait for SPA to render
  await page.waitForSelector('#root *', { timeout: 15000 }).catch(() => {});
  await sleep(1000);

  // Try to detect: is the user already onboarded (lock screen) or fresh?
  const initialState = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      text: text.slice(0, 800),
      hasUnlock: /unlock|password/i.test(text) && !/already.have/i.test(text),
      hasOnboard: /(already.have|create.new|recovery|getting.started|i'?ve already)/i.test(text),
    };
  });
  log('initial-state:', JSON.stringify(initialState).slice(0, 300));

  if (initialState.hasUnlock && !initialState.hasOnboard) {
    log('looks like unlock screen — trying to enter password');
    const ok = await tryUnlock(page);
    await shot(page, 'onboard-02-after-unlock');
    return ok;
  }

  // Fresh onboarding flow.
  const step = async (label, fn) => {
    log('step:', label);
    try {
      await fn();
    } catch (e) {
      log('  step-fail:', label, String(e?.message || e));
    }
    await sleep(800);
    await shot(page, `onboard-${label}`);
  };

  await step('03-pre-import', async () => {
    // Click "I already have a wallet" or similar.
    const candidates = [
      page.getByText(/i already have a wallet/i).first(),
      page.getByText(/already have a wallet/i).first(),
      page.getByText(/i'?ve already.*wallet/i).first(),
      page.getByText(/restore wallet/i).first(),
      page.getByText(/import wallet/i).first(),
    ];
    for (const c of candidates) {
      if (await c.count().catch(() => 0)) {
        await c.click({ timeout: 3000 });
        return;
      }
    }
    throw new Error('no "already have a wallet" button found');
  });

  await step('04-recovery-method', async () => {
    // Choose "Recovery phrase" / "Seed phrase".
    const candidates = [
      page.getByText(/recovery phrase/i).first(),
      page.getByText(/seed phrase/i).first(),
      page.getByText(/mnemonic/i).first(),
    ];
    for (const c of candidates) {
      if (await c.count().catch(() => 0)) {
        await c.click({ timeout: 3000 });
        return;
      }
    }
  });

  await step('05-enter-mnemonic', async () => {
    const words = WALLET.mnemonic.split(/\s+/).filter(Boolean);
    // Solflare typically exposes 12/24 separate inputs. Try that first.
    const inputs = page.locator('input[type="text"], input:not([type])');
    const count = await inputs.count();
    if (count >= words.length) {
      for (let i = 0; i < words.length; i++) {
        await inputs.nth(i).fill(words[i], { timeout: 2000 }).catch(() => {});
      }
      return;
    }
    // Fallback: a single textarea.
    const ta = page.locator('textarea');
    if (await ta.count()) {
      await ta.first().fill(WALLET.mnemonic);
      return;
    }
    throw new Error(`no mnemonic inputs found (count=${count})`);
  });

  await step('06-mnemonic-continue', async () => {
    const continueCandidates = [
      page.getByRole('button', { name: /continue|next|import|restore/i }).first(),
      page.getByText(/^continue$/i).first(),
      page.getByText(/^next$/i).first(),
      page.getByText(/^import$/i).first(),
    ];
    for (const c of continueCandidates) {
      if (await c.count().catch(() => 0)) {
        await c.click({ timeout: 3000 });
        return;
      }
    }
  });

  await step('07-account-pick', async () => {
    // Solflare may show "select accounts" — just click Continue.
    await sleep(2500);
    const cont = page.getByRole('button', { name: /continue|next|import|restore/i }).first();
    if (await cont.count()) await cont.click({ timeout: 3000 }).catch(() => {});
  });

  await step('08-password', async () => {
    const pwInputs = page.locator('input[type="password"]');
    await sleep(1500);
    const c = await pwInputs.count();
    if (c >= 1) await pwInputs.nth(0).fill(PASSWORD, { timeout: 2000 });
    if (c >= 2) await pwInputs.nth(1).fill(PASSWORD, { timeout: 2000 });
  });

  await step('09-password-continue', async () => {
    // Tick checkbox if any.
    const cbs = page.locator('input[type="checkbox"]');
    const cn = await cbs.count();
    for (let i = 0; i < cn; i++) await cbs.nth(i).check({ force: true, timeout: 1500 }).catch(() => {});
    const c = page.getByRole('button', { name: /continue|finish|done|create|next/i }).first();
    if (await c.count()) await c.click({ timeout: 3000 });
  });

  // Solflare may show "No Active Wallets Found" → click Quick setup
  await sleep(3000);
  await step('10-quick-setup', async () => {
    const candidates = [
      page.getByRole('button', { name: /quick setup/i }).first(),
      page.getByText(/quick setup/i).first(),
    ];
    for (const c of candidates) {
      if (await c.count().catch(() => 0)) {
        await c.click({ timeout: 3000 });
        return;
      }
    }
  });

  // Possible "got it" / "finish" / "explore" final screen
  await sleep(2500);
  await step('11-final-confirm', async () => {
    const candidates = [
      page.getByRole('button', { name: /got it|finish|explore|continue|done|let.*go|i.*understand/i }).first(),
    ];
    for (const c of candidates) {
      if (await c.count().catch(() => 0)) {
        await c.click({ timeout: 3000 });
        return;
      }
    }
  });

  await sleep(3000);
  await shot(page, 'onboard-12-final');

  // Did we land on the wallet home?
  const home = await page.evaluate(() => document.body.innerText.slice(0, 300));
  log('final-text:', home);

  return true;
}

async function tryUnlock(page) {
  await sleep(1500);
  const pw = page.locator('input[type="password"]').first();
  if (!(await pw.count())) return false;
  await pw.fill(PASSWORD);
  const btn = page.getByRole('button', { name: /unlock|continue|sign in/i }).first();
  if (await btn.count()) await btn.click({ timeout: 3000 });
  await sleep(2000);
  return true;
}

// ---- Main flow ------------------------------------------------------------

async function main() {
  const freshProfile = !existsSync(PROFILE);
  log('SolShield:', SOLSHIELD);
  log('Solflare :', SOLFLARE);
  log('Profile  :', PROFILE, freshProfile ? '(FRESH)' : '(reuse)');

  const fixture = await serveFixture();
  log('fixture:', fixture.url);

  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    args: [
      `--disable-extensions-except=${SOLSHIELD},${SOLFLARE}`,
      `--load-extension=${SOLSHIELD},${SOLFLARE}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1280, height: 900 },
  });

  // Wait for both extension SWs.
  for (let i = 0; i < 60; i++) {
    if (context.serviceWorkers().length >= 2) break;
    await sleep(250);
  }
  const sws = context.serviceWorkers().map((sw) => sw.url());
  log('service workers:', sws.join(' | '));

  // Identify Solflare ID by reading its manifest 'name' field via fetch from
  // each candidate extension URL.
  for (const url of sws) {
    const m = url.match(/chrome-extension:\/\/([a-z]+)\//);
    if (!m) continue;
    const id = m[1];
    try {
      const probePage = await context.newPage();
      let isSolflare = false;
      try {
        await probePage.goto(`chrome-extension://${id}/manifest.json`, { waitUntil: 'load', timeout: 5000 });
        const txt = await probePage.evaluate(() => document.body.innerText);
        isSolflare = /Solflare/i.test(txt);
      } catch {}
      await probePage.close();
      if (isSolflare) {
        SOLFLARE_ID = id;
        log('detected Solflare ID:', SOLFLARE_ID);
        break;
      }
    } catch (e) {
      log('probe-fail', id, String(e?.message || e));
    }
  }
  if (!SOLFLARE_ID) {
    log('FATAL: could not find Solflare extension ID');
    await context.close();
    process.exit(3);
  }
  await sleep(2000);

  // Track every page open with timestamps — so we can see Solflare's popup.
  const pageEvents = [];
  context.on('page', (p) => {
    const url = p.url();
    pageEvents.push({ t: Date.now(), tag: 'page-open', url });
    log(`[${ts()}] page-open ${url}`);
    p.on('framenavigated', (frame) => {
      if (frame === p.mainFrame()) {
        pageEvents.push({ t: Date.now(), tag: 'page-nav', url: frame.url() });
        log(`[${ts()}] page-nav  ${frame.url()}`);
      }
    });
    p.on('close', () => {
      pageEvents.push({ t: Date.now(), tag: 'page-close', url: p.url() });
      log(`[${ts()}] page-close ${p.url()}`);
    });
  });

  // Onboarding (only first time)
  if (freshProfile) {
    try {
      await onboardSolflare(context);
    } catch (e) {
      log('ONBOARD ERROR:', String(e?.message || e));
      await dumpPagesState(context, 'after-onboard-fail');
    }
  } else {
    log('reusing profile — opening wallet UI to check if unlocked');
    try {
      const p = await context.newPage();
      await p.goto(`chrome-extension://${SOLFLARE_ID}/app_popup.html`, { waitUntil: 'load' });
      await sleep(2500);
      await shot(p, 'reuse-01-popup');
      const txt = await p.evaluate(() => document.body.innerText.slice(0, 400));
      log('reuse-state:', txt.replace(/\n/g, ' ').slice(0, 200));
      if (/unlock|password/i.test(txt)) {
        await tryUnlock(p);
        await shot(p, 'reuse-02-unlocked');
      }
      await p.close();
    } catch (e) {
      log('reuse-warn:', String(e?.message || e));
    }
  }

  await dumpPagesState(context, 'pre-fixture');

  // ---- Open fixture and run sign flow ----
  log('--- opening fixture ---');
  const page = await context.newPage();
  await page.goto(fixture.url, { waitUntil: 'load', timeout: 15000 });
  await sleep(2500);
  await shot(page, 'fixture-01-loaded');

  // Verify SolShield content script is alive on this page.
  const ss = await page.evaluate(() => ({
    hasSolshield: !!window.__solshield,
    walletNames: window.__solshield?.walletNames,
    hasSolflare: !!window.solflare,
    isConnected: window.solflare?.isConnected,
  }));
  log('fixture-state:', JSON.stringify(ss));

  // Auto-approve handler: every time Solflare opens a confirm popup, click
  // Approve / Connect / Sign. We also tag the screenshot.
  let popupSeq = 0;
  const approvePopup = async (p, label) => {
    const u = p.url();
    if (!u.includes(SOLFLARE_ID)) return false;
    if (!/confirm_popup|wallet\.html.*#\/(?:request|approve|sign)/.test(u)) return false;
    popupSeq += 1;
    log(`  popup#${popupSeq} ${label}: ${u}`);
    await sleep(900);
    await shot(p, `popup-${label}-${popupSeq}-pre`);
    try {
      // Wait for the SPA to render its CTA.
      await p.waitForSelector('button', { timeout: 5000 }).catch(() => {});
      const approve = p.getByRole('button', { name: /connect|approve|sign|confirm|allow/i }).first();
      if (await approve.count()) {
        await approve.click({ timeout: 3000 });
        log(`  popup#${popupSeq} approved`);
        await sleep(700);
        await shot(p, `popup-${label}-${popupSeq}-post`);
        return true;
      } else {
        log(`  popup#${popupSeq} no CTA found`);
      }
    } catch (e) {
      log(`  popup#${popupSeq} approve-warn: ${String(e?.message || e)}`);
    }
    return false;
  };

  context.on('page', async (p) => {
    // Wait for the page to settle then try to approve.
    await sleep(800);
    await approvePopup(p, 'auto').catch(() => {});
  });

  // Click Connect first
  log('--- click connect ---');
  await page.locator('#connect').click();
  await sleep(4500);
  await shot(page, 'fixture-02-after-connect');

  await dumpPagesState(context, 'after-connect');

  // Sweep any popup that may already be open but the listener missed.
  for (const p of context.pages()) {
    await approvePopup(p, 'sweep-connect').catch(() => {});
  }
  await sleep(2500);
  await shot(page, 'fixture-03-connected');

  // Confirm we're connected on the fixture.
  const connectedState = await page.evaluate(() => ({
    isConnected: window.solflare?.isConnected,
    pk: window.solflare?.publicKey?.toString?.(),
  }));
  log('connected-state:', JSON.stringify(connectedState));

  // ---- THE KEY TEST: click Sign and capture the race ----
  pageEvents.length = 0; // reset for this section
  const tStart = Date.now();
  log('=== CLICK SIGN @', tStart, '===');

  // Capture screenshot stream while clicking.
  const screenshotPromise = (async () => {
    const shots = [];
    for (let i = 0; i < 25; i++) {
      const t = Date.now() - tStart;
      const path = join(SCREENS, `solflare-flow-t${String(t).padStart(4, '0')}.png`);
      try {
        await page.screenshot({ path });
        shots.push({ t, path });
      } catch {}
      await sleep(200);
    }
    return shots;
  })();

  await page.locator('#sign').click().catch((e) => log('sign-click-warn:', String(e?.message || e)));

  // Concurrently sweep for any new popup and auto-approve it (so the sign
  // resolves and our overlay-click flow can complete naturally). We DO NOT
  // approve immediately — we wait 1.5s so SolShield's overlay has a chance
  // to show first; this exposes the race more clearly.
  const sweep = (async () => {
    while (Date.now() - tStart < 12000) {
      for (const p of context.pages()) {
        await approvePopup(p, 'sign-sweep').catch(() => {});
      }
      await sleep(400);
    }
  })();

  const shots = await screenshotPromise;
  log('captured', shots.length, 'flow screenshots');
  await sweep;

  await sleep(1000);

  // ---- Collect the timeline ----
  const fixtureEvents = await page.evaluate(() => window.__events || []);
  const overlayPresent = await page.evaluate(() => !!document.querySelector('[id^="solshield-overlay-"]'));
  const ssLog = await page.evaluate(() => (window.__solshield?.log || []).filter((e) => /overlay|verdict|inspect|intercept|fail-open|wrap|safe-mode/i.test(JSON.stringify(e))).slice(-50));
  const ssStatus = await page.evaluate(() => {
    const s = window.__solshield;
    if (!s) return null;
    return {
      version: s.version,
      hooks: s.hooks,
      walletNames: s.walletNames,
      interceptions: s.interceptions,
      errors: s.errors,
      hasSolflare: !!window.solflare,
      solflareSignMessage: typeof window.solflare?.signMessage,
      solflareSignMessageWrapped: !!window.solflare?.signMessage?.__solshield_wrapped,
      solflareSignMessageSrc: (window.solflare?.signMessage?.toString() || '').slice(0, 200),
      solflarePropDescriptor: (() => {
        try {
          const d = Object.getOwnPropertyDescriptor(window.solflare, 'signMessage');
          return d ? { hasGet: !!d.get, hasSet: !!d.set, value: typeof d.value, configurable: d.configurable, writable: d.writable } : null;
        } catch (e) { return String(e); }
      })(),
    };
  });
  log('SOLSHIELD STATUS:', JSON.stringify(ssStatus, null, 2));

  // Did Solflare open its own popup tab during sign?
  const popupEvents = pageEvents.filter((e) => e.url.includes(SOLFLARE_ID));

  log('=== TIMELINE ===');
  log('fixture events:', JSON.stringify(fixtureEvents, null, 2));
  log('popup/page events during sign:', JSON.stringify(popupEvents, null, 2));
  log('overlay still present:', overlayPresent);
  log('solshield log tail:', JSON.stringify(ssLog, null, 2));

  // Compute X/Y
  const overlayEv = fixtureEvents.find((e) => e.tag === 'overlay-mounted');
  const popupEv = popupEvents.find((e) => /confirm_popup|app_popup|popup\.html|side_panel/.test(e.url));
  let X = overlayEv ? overlayEv.t : null;
  let Y = popupEv ? popupEv.t - tStart : null;

  log('=== RACE RESULT ===');
  log('SolShield overlay appeared at t+' + (X != null ? X.toFixed(0) : 'NEVER') + 'ms');
  log('Solflare popup    appeared at t+' + (Y != null ? Y.toFixed(0) : 'NEVER') + 'ms');
  if (X != null && Y != null) {
    if (X < Y) log('VERDICT: overlay first (X<Y) — wrap is intercepting properly');
    else log('VERDICT: popup first (Y<X) — BUG: wrap bypassed or too slow');
  } else if (X != null && Y == null) {
    log('VERDICT: overlay only — wrap held the call, no popup ever opened (best case)');
  } else if (Y != null && X == null) {
    log('VERDICT: popup only, NO OVERLAY — CRITICAL BUG: wrap was bypassed');
  } else {
    log('VERDICT: NEITHER appeared — sign flow probably never executed');
  }

  await shot(page, 'fixture-99-final');

  // Persist a JSON report alongside screenshots.
  const report = {
    when: new Date().toISOString(),
    solflareId: SOLFLARE_ID,
    profileFresh: freshProfile,
    fixtureEvents,
    popupEvents,
    overlayPresentAtEnd: overlayPresent,
    overlayTimeMs: X,
    popupTimeMs: Y,
    ssLogTail: ssLog,
  };
  const reportPath = join(SCREENS, 'solflare-flow-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log('report:', reportPath);

  await sleep(1500);
  await context.close();
  fixture.server.close();
  process.exit(0);
}

main().catch((e) => {
  log('runner threw:', e.message, e.stack);
  process.exit(2);
});
