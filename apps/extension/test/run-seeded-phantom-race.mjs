/**
 * Phase 2 — load the seeded Phantom profile + SolShield, navigate to a fixture
 * page that calls window.phantom.solana.signMessage, observe the order of
 * appearance: SolShield overlay vs Phantom approval popup.
 *
 * Outputs screenshots every 200ms for ~3 s after the call to:
 *   apps/extension/test/screenshots/seeded-flow-tNN.png
 *
 * Also tracks any new pages/popups Phantom opens so we can report whether the
 * approval window appeared in parallel with our overlay.
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
const PORT = 7411;

if (!existsSync(PROFILE_DIR)) {
  console.error('Profile not found. Run `node test/seed-phantom-storage.mjs --reset` first.');
  process.exit(1);
}
mkdirSync(SCREENSHOTS, { recursive: true });

// Wipe old race screenshots.
try {
  for (const f of (await import('node:fs')).readdirSync(SCREENSHOTS)) {
    if (f.startsWith('seeded-flow-t') || f.startsWith('seeded-popup-')) {
      rmSync(resolve(SCREENSHOTS, f));
    }
  }
} catch {}

const log = (...m) => process.stdout.write('[seeded-race] ' + m.join(' ') + '\n');

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Phishing Fixture</title></head>
<body><h1 id="origin">Loaded</h1>
<button id="connect">connect</button>
<button id="sign">sign</button>
<pre id="out"></pre>
<script>
(async () => {
  const out = document.getElementById('out');
  const log = (m) => { out.textContent += m + '\\n'; console.log('[fixture]', m); };
  window.__events = [];
  const stamp = (e) => window.__events.push({ t: performance.now(), e });
  stamp('script-start');

  // Wait for Phantom to inject.
  for (let i = 0; i < 200; i++) {
    if (window.phantom?.solana) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!window.phantom?.solana) { log('Phantom not injected'); return; }
  stamp('phantom-detected');

  document.getElementById('connect').onclick = async () => {
    stamp('connect-click');
    try { const r = await window.phantom.solana.connect({ onlyIfTrusted: false }); stamp('connect-resolved'); log('connect ok ' + r.publicKey?.toString?.()); }
    catch (e) { stamp('connect-rejected'); log('connect err ' + e.message); }
  };

  document.getElementById('sign').onclick = async () => {
    stamp('sign-click');
    const message = new TextEncoder().encode("phishing.com wants you to sign in with your Solana account:\\n\\nDrain my wallet");
    try {
      const r = await window.phantom.solana.signMessage(message, 'utf8');
      stamp('sign-resolved');
      log('sign ok bytes=' + (r.signature?.length ?? '?'));
    } catch (e) {
      stamp('sign-rejected');
      log('sign err ' + e.message);
    }
  };

  log('ready');
})();
</script>
</body></html>`;

async function main() {
  const server = createServer((req, res) => {
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

  // Track all pages — Phantom may open a notification window.
  const pageEvents = [];
  context.on('page', (p) => {
    pageEvents.push({ t: performance.now(), event: 'page-opened', url: p.url() });
    log('  +page', p.url());
  });

  // Wait for both extension SWs.
  for (let i = 0; i < 50; i++) {
    const sws = context.serviceWorkers();
    const hasPhantom = sws.find((w) => w.url().includes('bfnaelmomeimhlpmgjnjophhpkkoljpa'));
    const hasSolShield = sws.find((w) => !w.url().includes('bfnaelmomeimhlpmgjnjophhpkkoljpa'));
    if (hasPhantom && hasSolShield) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  log('SWs:', context.serviceWorkers().map((w) => w.url().split('/').slice(2, 3).join(''))
    .join(', '));

  // Pre-unlock Phantom so the signMessage flow doesn't get blocked by the
  // password screen (Phantom auto-locks when its SW restarts, but the on-disk
  // vault from the seeded profile is intact).
  log('---- pre-unlock Phantom ----');
  const PASSWORD = 'TestPwd123!TestPwd123!';
  const phantomPopup = await context.newPage();
  await phantomPopup.goto(`chrome-extension://bfnaelmomeimhlpmgjnjophhpkkoljpa/popup.html`, { waitUntil: 'load' });
  await phantomPopup.waitForTimeout(2000);
  const lockCount = await phantomPopup.locator('input[type="password"]').count();
  log('  popup password inputs visible:', lockCount);
  if (lockCount > 0) {
    await phantomPopup.locator('input[type="password"]').first().fill(PASSWORD);
    try {
      await phantomPopup.getByRole('button', { name: /unlock/i }).first().click({ timeout: 3000 });
    } catch {}
    await phantomPopup.waitForTimeout(2500);
  }
  await phantomPopup.screenshot({ path: resolve(SCREENSHOTS, 'seeded-popup-unlocked-runtime.png') });
  log('  unlock done');
  await phantomPopup.close();

  const page = await context.newPage();
  page.on('console', (m) => log('  page>', m.text()));
  page.on('pageerror', (e) => log('  pageerror>', e.message));

  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  log('fixture loaded — phantom present? ', await page.evaluate(() => !!window.phantom?.solana));

  // Connect first (Phantom requires per-origin trust).
  log('---- step: connect ----');
  await page.click('#connect');
  // Phantom usually opens a notification popup for the connect approval.
  await page.waitForTimeout(2500);

  // Look for Phantom notification window.
  let approvalPage = null;
  for (const p of context.pages()) {
    if (p.url().includes('notification.html')) {
      approvalPage = p;
      log('  found connect-approval window:', p.url());
      break;
    }
  }
  if (approvalPage) {
    await approvalPage.screenshot({ path: resolve(SCREENSHOTS, 'seeded-popup-connect.png') });
    // Phantom may show password screen first if it re-locked between events.
    const pwdHere = await approvalPage.locator('input[type="password"]').count();
    if (pwdHere > 0) {
      log('  approval popup re-locked — re-entering password');
      await approvalPage.locator('input[type="password"]').first().fill(PASSWORD);
      try { await approvalPage.getByRole('button', { name: /unlock/i }).first().click({ timeout: 3000 }); } catch {}
      await approvalPage.waitForTimeout(2000);
    }
    // Click "Connect" / "Approve" / "Trust".
    for (const re of [/^connect$/i, /^trust$/i, /approve/i, /confirm/i, /^continue$/i]) {
      try {
        const b = approvalPage.getByRole('button', { name: re }).first();
        if (await b.isVisible({ timeout: 1500 })) { await b.click({ timeout: 2000 }); log('  clicked', re.source); break; }
      } catch {}
    }
    await page.waitForTimeout(2500);
  } else {
    log('  no approval window — auto-trusted?');
  }

  log('---- step: signMessage (the race) ----');
  // Begin a screenshot loop concurrently with the sign click.
  const shots = [];
  const startT = performance.now();
  const captureLoop = (async () => {
    for (let i = 0; i < 16; i++) {
      // 200ms cadence × 16 ≈ 3.2 s
      try {
        const path = resolve(SCREENSHOTS, `seeded-flow-t${String(i).padStart(2, '0')}.png`);
        await page.screenshot({ path });
        shots.push({ i, t: performance.now() - startT, path });
      } catch (e) {
        log('  shot fail', i, e.message.split('\n')[0]);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  })();

  // Trigger sign at the same time as the loop.
  await page.click('#sign');

  await captureLoop;

  log('---- post-sign analysis ----');
  // Fetch fixture event log.
  const fixtureEvents = await page.evaluate(() => window.__events || []);
  log('fixture events:');
  for (const ev of fixtureEvents) log(`  +${ev.t.toFixed(1)}ms  ${ev.e}`);

  log('page events from context.on(page):');
  for (const p of pageEvents) log(`  +${(p.t - startT).toFixed(1)}ms  ${p.event}  ${p.url}`);

  log('all open pages:');
  for (const p of context.pages()) log(`  ${p.url()}`);

  // SolShield overlay detection — the host element id starts with "solshield-overlay-".
  const overlayState = await page.evaluate(() => {
    const host = document.querySelector('[id^="solshield-overlay-"]');
    if (!host) return { present: false };
    return { present: true, id: host.id, attached: !!host.shadowRoot };
  });
  log('overlay on fixture page:', JSON.stringify(overlayState));

  // Phantom approval window snapshot if any opened during the sign race.
  let phantomApproval = null;
  for (const p of context.pages()) {
    if (p.url().includes(`bfnaelmomeimhlpmgjnjophhpkkoljpa`) && (p.url().includes('notification.html') || p.url().includes('popup.html'))) {
      phantomApproval = p;
      break;
    }
  }
  if (phantomApproval) {
    await phantomApproval.screenshot({ path: resolve(SCREENSHOTS, 'seeded-popup-sign.png') });
    log('  phantom approval window present at end of race:', phantomApproval.url());
  } else {
    log('  no phantom approval window present at end of race');
  }

  log('shots saved:');
  for (const s of shots) log(`  +${s.t.toFixed(0).padStart(4, ' ')}ms  ${s.path}`);

  await new Promise((r) => setTimeout(r, 4000));
  await context.close();
  server.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
