/**
 * REAL E2E flow with REAL unlocked Phantom + SolShield.
 *
 * Hypothesis being tested: when a dapp calls signMessage, Phantom opens its
 * own popup IMMEDIATELY (before our wrap intercepts) or IN PARALLEL on top
 * of our overlay. We capture screenshots and timing data to confirm.
 *
 * Method A — persistent profile + onboarding automation:
 *   1. First run: load only Phantom, automate import-wallet onboarding.
 *   2. Subsequent runs: load Phantom + SolShield together.
 *   3. Drive a controlled fixture page that calls signMessage on the wallet
 *      Phantom registered (Wallet Standard), capture 3 screenshots at t=0,
 *      t=200ms, t=1000ms, capture all open pages (popup detection), capture
 *      __solshield.log filtered to overlay-ask events.
 *
 * Why a fixture page (not magiceden/jupiter)?
 *   Real dapps require SIWS / cookies / captcha and surface variable buttons
 *   per session. A fixture page calls signMessage directly so we measure the
 *   ONLY thing the user cares about: what UI shows up and in what order.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const PHANTOM = resolve(__dirname, 'real-wallets', 'phantom');
const WALLET = JSON.parse(readFileSync(resolve(__dirname, 'wallet.json'), 'utf8'));
const PHANTOM_PASSWORD = 'TestPassword123!';
const SHOTS = resolve(__dirname, 'screenshots', 'phantom-real-flow');
mkdirSync(SHOTS, { recursive: true });

// Persistent profile — onboarding only happens once.
const PROFILE = '/tmp/solshield-phantom-test-profile';
const PROFILE_FRESH = !existsSync(PROFILE) || readdirSync(PROFILE).length === 0;

const log = (...m) => process.stdout.write('[real-flow] ' + m.join(' ') + '\n');

// ----------- minimal HTTP fixture (lets us call signMessage on demand) ------
const FIXTURE_HTML = `<!doctype html>
<html><head><title>SolShield Phantom Real Flow</title>
<style>
  body { font: 14px monospace; padding: 20px; background:#111; color:#0f0; }
  button { padding: 12px 18px; font-size:16px; margin:6px; cursor:pointer; }
  pre { background:#000; padding:10px; max-height:200px; overflow:auto; white-space:pre-wrap; }
</style></head>
<body>
  <h1>SolShield x Phantom flow harness</h1>
  <button id="connect">1) Connect Phantom</button>
  <button id="sign">2) signMessage</button>
  <button id="signTx">3) signTransaction (placeholder)</button>
  <pre id="out">waiting...</pre>
  <script>
    const out = document.getElementById('out');
    const log = (m) => { out.textContent += '\\n' + new Date().toISOString().slice(11,23) + ' ' + m; };
    window.__flow = { events: [] };

    document.getElementById('connect').onclick = async () => {
      log('connect: looking for window.phantom.solana');
      try {
        if (!window.phantom?.solana) {
          log('NO window.phantom.solana — phantom content script did not inject');
          return;
        }
        const resp = await window.phantom.solana.connect();
        window.__flow.publicKey = resp.publicKey?.toString?.();
        log('connected pk=' + window.__flow.publicKey);
      } catch (e) { log('connect ERR ' + e.message); }
    };

    document.getElementById('sign').onclick = async () => {
      log('signMessage CLICK at t=0');
      window.__flow.signClickedAt = Date.now();
      try {
        // single-space message triggers empty-message-sign rule -> overlay
        const enc = new TextEncoder().encode(' ');
        const t0 = performance.now();
        const sig = await window.phantom.solana.signMessage(enc, 'utf8');
        const t1 = performance.now();
        window.__flow.signedAt = Date.now();
        window.__flow.signDuration = (t1 - t0) | 0;
        log('signed in ' + (t1 - t0).toFixed(0) + 'ms sig.length=' + (sig.signature?.length ?? 'n/a'));
      } catch (e) {
        window.__flow.signError = e.message;
        log('sign ERR ' + e.message);
      }
    };
  </script>
</body></html>`;

function startFixture() {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(FIXTURE_HTML);
  });
  return new Promise((rsv) => srv.listen(0, '127.0.0.1', () => {
    const port = srv.address().port;
    rsv({ url: `http://127.0.0.1:${port}/`, srv });
  }));
}

// --------------------------- onboarding automation ----------------------------
async function findPhantomServiceWorker(context, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sw = context.serviceWorkers().find((w) => w.url().includes('chrome-extension://') && w.url().includes('serviceWorker'));
    if (sw) {
      // Phantom SW URL contains its extension id
      const id = sw.url().match(/chrome-extension:\/\/([a-z]+)/)?.[1];
      return { sw, id };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function detectPhantomOnboardingPage(context, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pages = context.pages();
    for (const p of pages) {
      const url = p.url();
      if (url.includes('chrome-extension://') && url.includes('onboarding')) return p;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function automateOnboarding(context) {
  log('PROFILE_FRESH=true → automating Phantom onboarding');
  log('  waiting for onboarding tab...');
  let onboarding = await detectPhantomOnboardingPage(context, 20000);
  if (!onboarding) {
    log('  no auto-onboarding tab; trying to open it manually');
    const swInfo = await findPhantomServiceWorker(context, 8000);
    if (!swInfo) throw new Error('no phantom SW; cannot derive extension id');
    log('  phantom id=' + swInfo.id);
    onboarding = await context.newPage();
    await onboarding.goto(`chrome-extension://${swInfo.id}/onboarding.html`);
  }
  log('  onboarding url=' + onboarding.url());
  await onboarding.waitForLoadState('domcontentloaded');
  await onboarding.waitForTimeout(2000);

  // STEP 1: shoot the initial screen so we can debug if selectors miss.
  await onboarding.screenshot({ path: resolve(SHOTS, 'onboard-01-initial.png') });

  // Phantom's onboarding is a single-page React app. Its DOM uses data-testid
  // sparsely and its copy changes between versions. Strategy: try several
  // selectors and fall back to "click any button containing X".
  const tryClick = async (page, ...candidates) => {
    for (const sel of candidates) {
      try {
        const el = await page.locator(sel).first();
        if (await el.count()) {
          await el.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
          await el.click({ timeout: 3000 });
          return sel;
        }
      } catch {}
    }
    // Fallback: any button whose text matches.
    for (const text of candidates.filter((c) => !c.startsWith('['))) {
      try {
        const el = page.getByRole('button', { name: new RegExp(text, 'i') }).first();
        if (await el.count()) {
          await el.click({ timeout: 3000 });
          return 'role:' + text;
        }
      } catch {}
    }
    return null;
  };

  // Many Phantom builds first show a "Get Started" / "Continue" splash.
  // Phantom UI in this profile is in Spanish — we include both copies.
  await tryClick(
    onboarding,
    '[data-testid="onboarding-get-started"]',
    'Get Started',
    'Continue',
    'Continuar',
    'Empezar',
  );
  await onboarding.waitForTimeout(800);

  const importChosen = await tryClick(
    onboarding,
    '[data-testid="onboarding-import-existing"]',
    'Ya tengo una billetera',
    'Importar una billetera',
    'Importar billetera',
    'I already have a wallet',
    'Import an existing wallet',
    'Import Secret Recovery Phrase',
    'Import a wallet',
  );
  log('  click import → ' + importChosen);
  await onboarding.waitForTimeout(1500);
  await onboarding.screenshot({ path: resolve(SHOTS, 'onboard-02a-method-picker.png') });

  // STEP 2b: pick "Importar frase de recuperación" / "Recovery Phrase".
  // The picker uses divs not buttons — use text content match on any clickable.
  const recoveryClicked = await onboarding.evaluate(() => {
    const candidates = ['Importar frase de recuperación', 'Recovery Phrase', 'Secret Recovery Phrase', 'Frase de recuperación', 'Importar frase'];
    const all = Array.from(document.querySelectorAll('button, div[role="button"], li, a, [class*="row"], [class*="option"]'));
    for (const el of all) {
      const t = (el.textContent || '').trim();
      for (const c of candidates) {
        if (t.includes(c)) { el.click(); return c; }
      }
    }
    return null;
  });
  log('  recovery method clicked → ' + recoveryClicked);
  await onboarding.waitForTimeout(1500);
  await onboarding.screenshot({ path: resolve(SHOTS, 'onboard-02b-after-method.png') });

  // Recovery phrase entry. Phantom uses 12 separate <input>s OR one textarea.
  const words = WALLET.mnemonic.trim().split(/\s+/);
  const inputs = await onboarding.locator('input').all();
  log('  inputs found on phrase screen=' + inputs.length);
  if (inputs.length >= 12) {
    for (let i = 0; i < 12; i++) {
      try {
        await inputs[i].click({ timeout: 1500 });
        await inputs[i].fill(words[i]);
      } catch (e) { log('   word ' + i + ' fill err ' + e.message); }
    }
  } else {
    // textarea fallback
    const ta = onboarding.locator('textarea').first();
    if (await ta.count()) await ta.fill(WALLET.mnemonic);
    else log('  WARN: neither 12 inputs nor textarea found');
  }
  await onboarding.waitForTimeout(800);
  await onboarding.screenshot({ path: resolve(SHOTS, 'onboard-03-phrase-filled.png') });

  await tryClick(onboarding, '[data-testid="onboarding-form-submit-button"]', 'Importar billetera', 'Import wallet', 'Import', 'Continue', 'Next', 'Importar', 'Continuar', 'Siguiente');
  await onboarding.waitForTimeout(3000);

  // "Importar cuentas — hemos encontrado N cuenta" → Continuar
  await onboarding.screenshot({ path: resolve(SHOTS, 'onboard-03b-account-found.png') });
  await tryClick(onboarding, 'Continuar', 'Continue', 'Next', 'Siguiente', 'Importar');
  await onboarding.waitForTimeout(2500);
  await onboarding.screenshot({ path: resolve(SHOTS, 'onboard-04-password-screen.png') });

  // Password create — Phantom uses plain <input type="password">.
  const allInputs = await onboarding.locator('input').all();
  log('  total inputs on pw screen=' + allInputs.length);
  // First two inputs are password + confirm.
  for (let i = 0; i < Math.min(2, allInputs.length); i++) {
    try {
      await allInputs[i].click({ timeout: 1500 });
      await allInputs[i].fill(PHANTOM_PASSWORD);
    } catch (e) { log('   pw fill ' + i + ' err ' + e.message); }
  }
  // T&C checkbox — could be a styled div, just click the label text.
  const cbClicked = await onboarding.evaluate(() => {
    const el = document.querySelector('input[type="checkbox"]');
    if (el) { try { el.click(); return 'native'; } catch {} }
    // styled checkbox
    const labels = Array.from(document.querySelectorAll('label, div, span'));
    for (const l of labels) {
      if ((l.textContent || '').includes('Acepto')) {
        const clickable = l.querySelector('input,div,span') || l;
        try { clickable.click(); return 'styled'; } catch {}
      }
    }
    return null;
  });
  log('  checkbox clicked=' + cbClicked);
  await onboarding.waitForTimeout(800);

  await onboarding.screenshot({ path: resolve(SHOTS, 'onboard-04-password-filled.png') });
  await tryClick(onboarding, 'Continuar', 'Continue', 'Submit', 'Next', 'Done', 'Get Started', 'Enviar', 'Siguiente', 'Listo', 'Empezar', 'Finalizar');
  await onboarding.waitForTimeout(4000);
  // possible final "Done" / "Aceptar" / "Comenzar"
  await tryClick(onboarding, 'Done', 'Finalizar', 'Listo', 'Aceptar', 'OK', 'Comenzar', 'Get Started', 'Continuar');
  await onboarding.waitForTimeout(2000);
  await onboarding.screenshot({ path: resolve(SHOTS, 'onboard-05-final.png') });
  log('  onboarding done (best-effort).');
}

// --------------------------- popup auto-approve hook --------------------------
function attachPopupListener(context, label) {
  context.on('page', async (page) => {
    const url = page.url();
    log(`[popup] new page url=${url || '(blank)'} label=${label}`);
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
    } catch {}
    if (page.url().includes('chrome-extension://') && page.url().includes(/* phantom popup uses notification.html */ 'notification')) {
      try {
        const shot = resolve(SHOTS, `popup-${label}-${Date.now()}.png`);
        await page.screenshot({ path: shot });
        log(`  saved phantom popup shot ${shot}`);
      } catch {}
    }
  });
}

// --------------------------- main flow ---------------------------------------
async function run() {
  const fixture = await startFixture();
  log('fixture ' + fixture.url);

  // ---- Phase 1: onboarding (only Phantom loaded) ----
  if (PROFILE_FRESH) {
    log('Profile fresh — bootstrapping Phantom in isolation');
    mkdirSync(PROFILE, { recursive: true });
    const ctx0 = await chromium.launchPersistentContext(PROFILE, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${PHANTOM}`,
        `--load-extension=${PHANTOM}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    try {
      await automateOnboarding(ctx0);
    } catch (e) {
      log('onboarding error: ' + e.message);
    }
    await ctx0.close();
    log('Phase 1 done. Reopening with both extensions.');
  } else {
    log('Profile exists at ' + PROFILE + ' — skipping onboarding');
  }

  // ---- Phase 2: real flow with both extensions ----
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${SOLSHIELD},${PHANTOM}`,
      `--load-extension=${SOLSHIELD},${PHANTOM}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  attachPopupListener(context, 'phase2');

  // Wait for both service workers
  for (let i = 0; i < 50; i++) {
    if (context.serviceWorkers().length >= 2) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  log('SWs: ' + context.serviceWorkers().map((w) => w.url().slice(0, 70)).join('\n  '));

  // Open fixture
  const page = await context.newPage();
  await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: resolve(SHOTS, 'fixture-loaded.png') });

  // probe wallet presence + whether SolShield wrapped it
  const probe1 = await page.evaluate(() => {
    const out = {
      hasWindowPhantom: typeof window.phantom !== 'undefined',
      hasPhantomSolana: !!window.phantom?.solana,
      isPhantomFlag: !!window.phantom?.solana?.isPhantom,
      hasSolshield: !!window.__solshield,
      logCount: window.__solshield?.log?.length ?? 0,
    };
    // Try to detect wrapped methods on direct provider
    try {
      const sm = window.phantom?.solana?.signMessage;
      out.signMessageWrapped = !!sm?.__solshield_wrapped;
      out.signMessageType = typeof sm;
    } catch (e) { out.signMessageProbeErr = e.message; }
    return out;
  });
  log('probe1=' + JSON.stringify(probe1, null, 2));

  // Step 1: connect — if wallet locked, this opens phantom popup asking to unlock.
  const popupBefore = context.pages().length;
  await page.click('#connect');
  log('clicked connect, waiting for phantom popup if any');
  await page.waitForTimeout(4000);
  const popupAfterConnect = context.pages();
  log('after connect: ' + popupAfterConnect.length + ' pages (was ' + popupBefore + ')');
  for (const p of popupAfterConnect) log('  page ' + p.url().slice(0, 100));

  // Auto-approve any phantom popup. Phantom popups appear as:
  //   chrome-extension://<id>/notification.html
  // so we look for them and try to click "Connect".
  // First time after onboarding the wallet IS LOCKED -> notification.html
  // shows "Ingrese su contraseña" / "Desbloquear" full-tab.
  const handlePhantomNotification = async (p) => {
    const u = p.url();
    if (!u.includes('chrome-extension://') || (!u.includes('notification') && !u.includes('popup'))) return;
    try {
      await p.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
      await p.waitForTimeout(800);
      await p.screenshot({ path: resolve(SHOTS, `phantom-notif-${Date.now()}.png`) });
      // unlock screen?
      const inputs = await p.locator('input').all();
      if (inputs.length === 1) {
        log('  phantom notif: unlock screen -> filling password');
        try { await inputs[0].click({ timeout: 1500 }); await inputs[0].fill(PHANTOM_PASSWORD); } catch {}
        for (const txt of ['Desbloquear', 'Unlock', 'Continuar', 'Continue']) {
          const btn = p.getByRole('button', { name: new RegExp('^' + txt + '$', 'i') }).first();
          if (await btn.count()) { try { await btn.click({ timeout: 1500 }); break; } catch {} }
        }
        await p.waitForTimeout(1500);
        await p.screenshot({ path: resolve(SHOTS, `phantom-notif-after-unlock-${Date.now()}.png`) });
      }
      // approval buttons
      for (const txt of ['Connect', 'Conectar', 'Approve', 'Aprobar', 'Continue', 'Continuar', 'Sign', 'Firmar', 'Confirmar']) {
        try {
          const btn = p.getByRole('button', { name: new RegExp('^' + txt + '$', 'i') }).first();
          if (await btn.count()) {
            log('  phantom notif: clicking ' + txt + ' on ' + u.slice(0, 60));
            await btn.click({ timeout: 2000 });
            break;
          }
        } catch {}
      }
    } catch (e) { log('  notif handler err ' + e.message); }
  };

  for (const p of popupAfterConnect) {
    await handlePhantomNotification(p);
  }
  // Give Phantom up to 8s to finish the unlock + approve dance.
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500);
    for (const p of context.pages()) {
      if (p === page) continue;
      await handlePhantomNotification(p);
    }
  }
  await page.waitForTimeout(2000);

  const connectState = await page.evaluate(() => ({
    publicKey: window.__flow?.publicKey,
    out: document.getElementById('out')?.textContent,
  }));
  log('connect-state=' + JSON.stringify(connectState));
  await page.screenshot({ path: resolve(SHOTS, 'after-connect.png') });

  // ---- THE CRITICAL MOMENT — signMessage and capture overlapping screenshots
  log('=== Triggering signMessage ===');
  const t0 = Date.now();
  // Don't await the click — we want to be screenshotting as the cascade unfolds.
  page.click('#sign').catch((e) => log('sign click err ' + e.message));

  // shot at t=0: just after click dispatched
  await page.screenshot({ path: resolve(SHOTS, 'flow-t0-trigger.png') }).catch(() => {});
  log('t=' + (Date.now() - t0) + 'ms shot flow-t0-trigger');

  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(SHOTS, 'flow-t1-200ms.png') }).catch(() => {});
  const pagesAt200 = context.pages().map((p) => p.url());
  log('t=' + (Date.now() - t0) + 'ms shot flow-t1-200ms; pages=' + pagesAt200.length);

  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(SHOTS, 'flow-t2-1000ms.png') }).catch(() => {});
  const pagesAt1000 = context.pages().map((p) => p.url());
  log('t=' + (Date.now() - t0) + 'ms shot flow-t2-1000ms; pages=' + pagesAt1000.length);

  // Screenshot every NEW phantom popup we see (run a few more snapshots).
  for (let s = 0; s < 8; s++) {
    await page.waitForTimeout(500);
    const allPages = context.pages();
    for (const p of allPages) {
      const u = p.url();
      if (u.includes('chrome-extension://') && p !== page) {
        try {
          const fname = `popup-during-sign-s${s}-${Date.now()}.png`;
          await p.screenshot({ path: resolve(SHOTS, fname) });
        } catch {}
      }
    }
  }

  // Now click PROCEED on the SolShield overlay (it lives in our page DOM).
  log('=== Clicking PROCEED on SolShield overlay ===');
  await page.screenshot({ path: resolve(SHOTS, 'before-proceed.png') });
  const proceedClicked = await page.evaluate(() => {
    const seen = [];
    // SKIP the fixture's own buttons (they all start with "1)" / "2)" / "3)").
    const isFixtureButton = (b) => /^\s*\d\)/.test(b.textContent || '');
    const walk = (root, depth = 0) => {
      if (!root || depth > 6) return;
      const buttons = (root.querySelectorAll ? root.querySelectorAll('button') : []) || [];
      for (const b of buttons) {
        if (isFixtureButton(b)) continue;
        const txt = (b.textContent || '').trim();
        seen.push(txt.slice(0, 60));
        const lower = txt.toLowerCase();
        if (lower.includes('proceed') || lower.includes('understand') || lower.includes('continuar') || lower.includes('comprend')) {
          b.click();
          return { clicked: true, text: txt };
        }
      }
      const all = (root.querySelectorAll ? root.querySelectorAll('*') : []) || [];
      for (const el of all) {
        if (el.shadowRoot) {
          const r = walk(el.shadowRoot, depth + 1);
          if (r?.clicked) return r;
        }
      }
      return null;
    };
    const r = walk(document, 0);
    return r || { clicked: false, seen };
  });
  log('  proceed click=' + JSON.stringify(proceedClicked));
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(SHOTS, 'after-proceed-t0.png') });

  // After proceed → SolShield forwards to real Phantom → real Phantom popup opens.
  // Capture every new chrome-extension page AND screenshot fixture page.
  for (let s = 0; s < 12; s++) {
    await page.waitForTimeout(400);
    const allPages = context.pages();
    for (const p of allPages) {
      const u = p.url();
      if (u.includes('chrome-extension://') && p !== page) {
        try {
          await p.screenshot({ path: resolve(SHOTS, `phantom-popup-after-proceed-s${s}-${Date.now()}.png`) });
        } catch {}
      }
    }
    // also re-shoot fixture page so we can build a timeline gif
    try { await page.screenshot({ path: resolve(SHOTS, `fixture-after-proceed-s${s}.png`) }); } catch {}
  }

  // Final state probe — what does __solshield log say?
  const finalProbe = await page.evaluate(() => {
    const out = {
      flow: window.__flow,
      logTail: window.__solshield?.log?.slice(-25) ?? [],
      logCount: window.__solshield?.log?.length ?? 0,
      overlayAskCount: (window.__solshield?.log ?? []).filter((l) => (l.message || '').includes('overlay-ask')).length,
      hasOverlayInDom: !!document.querySelector('#solshield-overlay-host, [id*="solshield"]'),
    };
    return out;
  });
  log('final probe:');
  log(JSON.stringify(finalProbe, null, 2));

  // Save log to disk for postmortem
  writeFileSync(resolve(SHOTS, 'final-state.json'), JSON.stringify(finalProbe, null, 2));

  // Final viewport screenshots
  await page.screenshot({ path: resolve(SHOTS, 'flow-tFinal.png'), fullPage: true });
  for (const p of context.pages()) {
    if (p === page) continue;
    try {
      const id = p.url().split('/').slice(2, 4).join('-');
      await p.screenshot({ path: resolve(SHOTS, `final-popup-${id}-${Date.now()}.png`) });
    } catch {}
  }

  log('shots dir=' + SHOTS);
  log('all done. closing in 3s...');
  await new Promise((r) => setTimeout(r, 3000));
  await context.close();
  fixture.srv.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
