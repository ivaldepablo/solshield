/**
 * Test 3 — PHANTOM NOTIFICATION TAB / WINDOW FOCUS UX
 *
 * Hypothesis: When Phantom needs approval (signMessage / signTransaction /
 * connect), it opens its `notification.html` page. We want to know:
 *
 *   - Is it a NEW window (popup) or a tab in the same window?
 *   - Does it auto-focus / steal focus from the dapp tab?
 *   - With many tabs already open, where does it land?
 *   - Is our SolShield overlay (in the dapp tab) still visible to the user?
 *
 * The interesting part for SolShield UX: if the approval window steals focus,
 * the user probably looks AT THE PHANTOM POPUP and never sees our overlay,
 * which means our security UX is invisible at the exact moment we need it.
 *
 * We measure:
 *   - Whether the dapp page (which holds the SolShield overlay) is still
 *     `document.hasFocus() === true` after Phantom opens its notification.
 *   - The notification window's URL pattern (popup-vs-tab).
 *   - Whether our overlay element is still attached and visible-to-user
 *     (z-index, viewport intersection).
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
const PORT = 7441;

if (!existsSync(PROFILE_DIR)) {
  console.error('Profile not found. Run `node test/seed-phantom-storage.mjs --reset` first.');
  process.exit(1);
}
mkdirSync(SCREENSHOTS, { recursive: true });
for (const f of (await import('node:fs')).readdirSync(SCREENSHOTS)) {
  if (f.startsWith('notif-focus-')) rmSync(resolve(SCREENSHOTS, f));
}

const log = (...m) => process.stdout.write('[notif-focus] ' + m.join(' ') + '\n');

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Notif Focus Probe</title></head>
<body><h1 id="title">Notification Focus Probe</h1>
<button id="connect">connect</button><button id="sign">sign</button>
<pre id="out"></pre>
<script>
window.__events = [];
const stamp = (e, extra) => window.__events.push({ t: performance.now(), e, ...(extra || {}), focused: document.hasFocus(), visible: document.visibilityState });
window.addEventListener('focus', () => stamp('window-focus'));
window.addEventListener('blur', () => stamp('window-blur'));
document.addEventListener('visibilitychange', () => stamp('visibilitychange'));
(async () => {
  const out = document.getElementById('out');
  const log = (m) => { out.textContent += m + '\\n'; console.log('[notif]', m); };
  for (let i = 0; i < 200; i++) { if (window.phantom?.solana) break; await new Promise(r => setTimeout(r, 50)); }
  if (!window.phantom?.solana) { log('Phantom not injected'); return; }
  stamp('phantom-detected');
  document.getElementById('connect').onclick = async () => {
    stamp('connect-click');
    try { const r = await window.phantom.solana.connect({ onlyIfTrusted: false }); stamp('connect-resolved'); log('connect ok ' + r.publicKey?.toString?.()); }
    catch (e) { stamp('connect-rejected'); log('connect err ' + e.message); }
  };
  document.getElementById('sign').onclick = async () => {
    stamp('sign-click');
    const message = new TextEncoder().encode("notif-focus probe " + Date.now());
    try { const r = await window.phantom.solana.signMessage(message, 'utf8'); stamp('sign-resolved'); log('sign ok'); }
    catch (e) { stamp('sign-rejected'); log('sign err ' + e.message); }
  };
  log('ready');
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

  for (let i = 0; i < 50; i++) {
    if (context.serviceWorkers().length >= 2) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  log('SWs:', context.serviceWorkers().map((w) => w.url().split('/').slice(2, 3).join('')).join(', '));

  log('---- pre-unlock Phantom ----');
  const phantomPopup = await context.newPage();
  await phantomPopup.goto(`chrome-extension://${PHANTOM_ID}/popup.html`, { waitUntil: 'load' });
  await phantomPopup.waitForTimeout(2000);
  if ((await phantomPopup.locator('input[type="password"]').count()) > 0) {
    await phantomPopup.locator('input[type="password"]').first().fill(PASSWORD);
    try { await phantomPopup.getByRole('button', { name: /unlock/i }).first().click({ timeout: 3000 }); } catch {}
    await phantomPopup.waitForTimeout(2500);
  }
  await phantomPopup.close();

  // Open 5 distractor tabs FIRST so the dapp tab isn't the only one and we
  // can see how Phantom's notification picks a parent window/tab.
  log('---- open 5 distractor tabs ----');
  const distractors = [];
  for (let i = 0; i < 5; i++) {
    const p = await context.newPage();
    await p.goto('about:blank', { waitUntil: 'domcontentloaded' });
    await p.evaluate((idx) => { document.title = `distractor-${idx}`; document.body.innerHTML = `<h1>Distractor ${idx}</h1>`; }, i);
    distractors.push(p);
  }

  // Now the dapp tab.
  const page = await context.newPage();
  page.on('console', (m) => log('  page>', m.text()));
  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: resolve(SCREENSHOTS, 'notif-focus-before-connect.png') });

  log('---- step: connect ----');
  const connectStartT = performance.now();
  await page.click('#connect');
  await page.waitForTimeout(2500);

  // Catalogue all open pages.
  log('  pages after connect:');
  for (const p of context.pages()) log('    -', p.url(), 'visible=', await p.evaluate(() => document.visibilityState).catch(() => '?'));

  // Find Phantom notification.
  let approval = null;
  for (const p of context.pages()) {
    if (p.url().includes('notification.html')) { approval = p; break; }
  }
  if (approval) {
    log('  notification window URL:', approval.url());
    // Heuristic: Phantom uses chrome.windows.create({type:'popup'}) which gives
    // it its OWN top-level window (Playwright still surfaces it as a "page").
    // We can detect the window-vs-tab nature by seeing if the dapp page is
    // still the active tab in its window — for that we check document.hasFocus()
    // on the dapp page.
    await approval.screenshot({ path: resolve(SCREENSHOTS, 'notif-focus-approval-connect.png') });
    const dappFocus = await page.evaluate(() => ({ hasFocus: document.hasFocus(), visState: document.visibilityState }));
    log('  dapp page after Phantom popup: hasFocus=' + dappFocus.hasFocus + ' visState=' + dappFocus.visState);

    const pwdHere = await approval.locator('input[type="password"]').count();
    if (pwdHere > 0) {
      await approval.locator('input[type="password"]').first().fill(PASSWORD);
      try { await approval.getByRole('button', { name: /unlock/i }).first().click({ timeout: 2000 }); } catch {}
      await approval.waitForTimeout(2000);
    }
    for (const re of [/^connect$/i, /^trust$/i, /approve/i, /^continue$/i]) {
      try {
        const b = approval.getByRole('button', { name: re }).first();
        if (await b.isVisible({ timeout: 1500 })) { await b.click({ timeout: 2000 }); break; }
      } catch {}
    }
    await page.waitForTimeout(2000);
  } else {
    log('  no notification window opened — already trusted?');
  }

  log('---- step: sign (the focus measurement) ----');
  const dappFocusBeforeSign = await page.evaluate(() => ({ hasFocus: document.hasFocus(), visState: document.visibilityState, time: performance.now() }));
  log('  dapp focus BEFORE sign click:', JSON.stringify(dappFocusBeforeSign));

  // Make sure dapp tab is brought-to-front first (simulate user clicking its tab).
  await page.bringToFront();
  await page.waitForTimeout(200);

  const signClickT = performance.now();
  await page.click('#sign');
  // Capture focus state every 200ms for ~3s.
  const focusTrace = [];
  for (let i = 0; i < 16; i++) {
    const f = await page.evaluate(() => ({ hasFocus: document.hasFocus(), visState: document.visibilityState, t: performance.now() })).catch(() => null);
    if (f) focusTrace.push({ tick: i, ...f, dt: performance.now() - signClickT });
    try { await page.screenshot({ path: resolve(SCREENSHOTS, `notif-focus-t${String(i).padStart(2, '0')}.png`), timeout: 1500 }); } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }

  log('  focus trace (dt = ms after sign click):');
  for (const f of focusTrace) log(`    +${String(f.dt.toFixed(0)).padStart(4, ' ')}ms  hasFocus=${f.hasFocus} visState=${f.visState}`);

  // Search for sign approval popup.
  let signApproval = null;
  for (const p of context.pages()) {
    if (p.url().includes('notification.html')) { signApproval = p; break; }
  }
  if (signApproval) {
    await signApproval.screenshot({ path: resolve(SCREENSHOTS, 'notif-focus-approval-sign.png') });
    log('  sign-approval URL:', signApproval.url());
    // Check if dapp tab is still active or hidden.
    const distractorStates = [];
    for (let i = 0; i < distractors.length; i++) {
      try {
        const v = await distractors[i].evaluate(() => document.visibilityState);
        distractorStates.push(`distractor-${i}:${v}`);
      } catch (e) {
        distractorStates.push(`distractor-${i}:gone`);
      }
    }
    log('  distractor visibility:', distractorStates.join(' '));
  } else {
    log('  no sign-approval popup found');
  }

  // Final overlay state on dapp page.
  const overlayState = await page.evaluate(() => {
    const host = document.querySelector('[id^="solshield-overlay-"]');
    if (!host) return { present: false };
    const cs = getComputedStyle(host);
    const r = host.getBoundingClientRect();
    return {
      present: true,
      id: host.id,
      attached: !!host.shadowRoot,
      display: cs.display,
      visibility: cs.visibility,
      zIndex: cs.zIndex,
      width: r.width,
      height: r.height,
      hasContent: host.shadowRoot ? host.shadowRoot.children.length : 0,
    };
  });
  log('overlay state:', JSON.stringify(overlayState));

  // SolShield log relevant entries.
  const ss = await page.evaluate(() => {
    if (!window.__solshield) return { absent: true };
    return {
      log_overlay: (window.__solshield.log || []).filter((e) => e.tag === 'overlay-ask').map((e) => `${e.level}/${e.tag}: ${e.msg}`),
      log_tail: (window.__solshield.log || []).slice(-20).map((e) => `${e.level}/${e.tag}: ${e.msg}`),
    };
  });
  log('overlay-ask events:');
  for (const m of ss.log_overlay || []) log('  ', m);

  log('VERDICT:');
  // The interesting case: does the dapp page lose focus when Phantom opens?
  const lostFocus = focusTrace.filter((f) => !f.hasFocus).length;
  const overlayPresent = overlayState.present && overlayState.attached && (overlayState.hasContent ?? 0) > 0;
  if (lostFocus > 0 && !overlayPresent) {
    log('  Phantom STOLE FOCUS and we never showed an overlay → user looks at Phantom only (UX risk if our verdict was non-safe).');
  } else if (lostFocus > 0 && overlayPresent) {
    log('  Phantom stole focus BUT our overlay was present in dapp tab. User likely sees Phantom popup; needs to switch back to dapp tab to see SolShield.');
  } else if (!lostFocus && overlayPresent) {
    log('  dapp tab kept focus AND overlay present → best UX.');
  } else {
    log('  dapp kept focus, no overlay → either signature was auto-approved or no risk detected.');
  }

  await new Promise((r) => setTimeout(r, 2000));
  await context.close();
  server.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
