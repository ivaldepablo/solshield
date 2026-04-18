/**
 * v0.4.2 SMOKE TEST — load SolShield into a fresh Chromium, navigate real dapps,
 * snapshot diagnostics from window.__solshield, and capture screenshots.
 *
 * Pure observational test: NO connect, NO sign, NO interception trigger.
 * Asserts: __solshield exists, version === 0.4.2, errors == 0.
 *
 * For magiceden + jupiter only, attempt to click a Connect button to
 * visually confirm the wallet picker renders without breaking. We never
 * complete a wallet connect.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const SCREENSHOT_DIR = resolve(__dirname, 'screenshots');
const EXPECTED_VERSION = '0.4.2';

const log = (...m) => process.stdout.write('[smoke] ' + m.join(' ') + '\n');

const DAPPS = [
  { name: 'magiceden', url: 'https://magiceden.io', tryConnect: true },
  { name: 'jupiter', url: 'https://jup.ag', tryConnect: true },
  { name: 'tensor', url: 'https://tensor.trade', tryConnect: false },
  { name: 'dexscreener', url: 'https://dexscreener.com', tryConnect: false },
  { name: 'pump', url: 'https://pump.fun', tryConnect: false },
  { name: 'drift', url: 'https://app.drift.trade', tryConnect: false },
  { name: 'orca', url: 'https://www.orca.so', tryConnect: false },
];

const RELEVANT_TAGS = new Set(['boot', 'wrap-wallet', 'register-wallet', 'dispatch-hijack', 'install-sticky']);

const CONNECT_SELECTORS = [
  'button:has-text("Connect Wallet")',
  'button:has-text("Connect")',
  '[data-testid*="connect" i]',
  '[data-testid*="wallet" i]',
  '[aria-label*="connect" i]',
  'button[class*="connect" i]',
  'a:has-text("Connect Wallet")',
];

async function tryClickConnect(page, dappName) {
  for (const sel of CONNECT_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) === 0) continue;
      const visible = await el.isVisible({ timeout: 1500 }).catch(() => false);
      if (!visible) continue;
      log(`  [${dappName}] connect selector matched: ${sel}`);
      await el.click({ timeout: 3000, force: true });
      await new Promise((r) => setTimeout(r, 2500));
      return { selector: sel };
    } catch (e) {
      // try next selector
    }
  }
  return null;
}

async function testDapp(context, dapp) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const result = {
    name: dapp.name,
    url: dapp.url,
    screenshot: null,
    pickerScreenshot: null,
    pageErrors,
    diag: null,
    pickerOpened: null,
    notes: [],
  };

  try {
    log(`\n--- ${dapp.name} (${dapp.url}) ---`);
    await page.goto(dapp.url, { timeout: 30000, waitUntil: 'domcontentloaded' });
    log(`  goto ok`);
    await new Promise((r) => setTimeout(r, 8000));

    const screenshotPath = resolve(SCREENSHOT_DIR, `dapp-${dapp.name}.png`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false });
      result.screenshot = screenshotPath;
      log(`  screenshot → ${screenshotPath}`);
    } catch (e) {
      result.notes.push(`screenshot failed: ${e.message}`);
    }

    const diag = await page.evaluate((relevantTagsArr) => {
      const rel = new Set(relevantTagsArr);
      const s = window.__solshield;
      if (!s) return { exists: false };
      const recentErrors = (s.errors || []).slice(-3).map((e) => ({
        phase: e.phase,
        message: e.message,
        at: e.at,
      }));
      const relevantLog = (s.log || [])
        .filter((entry) => rel.has(entry.tag))
        .slice(-20)
        .map((entry) => ({ tag: entry.tag, level: entry.level, msg: entry.msg, at: entry.at }));
      return {
        exists: true,
        version: s.version,
        installedAt: s.installedAt,
        safeMode: s.safeMode,
        safeModeReason: s.safeModeReason,
        walletNames: Array.isArray(s.walletNames) ? s.walletNames.slice() : [],
        hooks: s.hooks,
        walletStandardWallets: s.hooks?.walletStandardWallets ?? 0,
        errorsTotal: (s.errors || []).length,
        recentErrors,
        logTotal: (s.log || []).length,
        relevantLog,
      };
    }, Array.from(RELEVANT_TAGS));
    result.diag = diag;

    if (!diag.exists) {
      log(`  CRITICAL: window.__solshield is undefined`);
    } else {
      log(`  version=${diag.version} walletStandard=${diag.walletStandardWallets} errors=${diag.errorsTotal} safeMode=${diag.safeMode} wallets=[${diag.walletNames.join(', ')}]`);
      const bootEntry = diag.relevantLog.find((e) => e.tag === 'boot');
      if (bootEntry) log(`  boot log: ${bootEntry.msg}`);
      if (diag.recentErrors.length) {
        for (const e of diag.recentErrors) {
          log(`  err[${e.phase}]: ${e.message}`);
        }
      }
    }

    if (dapp.tryConnect) {
      const click = await tryClickConnect(page, dapp.name);
      if (click) {
        const pickerPath = resolve(SCREENSHOT_DIR, `dapp-${dapp.name}-picker.png`);
        try {
          await page.screenshot({ path: pickerPath, fullPage: false });
          result.pickerScreenshot = pickerPath;
          result.pickerOpened = { selector: click.selector };
          log(`  picker screenshot → ${pickerPath}`);
        } catch (e) {
          result.notes.push(`picker screenshot failed: ${e.message}`);
        }
      } else {
        result.notes.push('no connect button found');
        log(`  no connect button matched`);
      }
    }
  } catch (err) {
    result.notes.push(`navigation/runtime error: ${err.message}`);
    log(`  ERROR: ${err.message}`);
  } finally {
    await page.close().catch(() => {});
  }

  return result;
}

function verdict(r) {
  if (!r.diag || !r.diag.exists) return { ok: false, reason: '__solshield undefined' };
  if (r.diag.version !== EXPECTED_VERSION) return { ok: false, reason: `version ${r.diag.version} != ${EXPECTED_VERSION}` };
  if (r.diag.errorsTotal > 0) return { ok: false, reason: `${r.diag.errorsTotal} errors` };
  if (r.diag.safeMode) return { ok: false, reason: `safe-mode: ${r.diag.safeModeReason}` };
  return { ok: true };
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  log('extension:', EXTENSION_PATH);
  log('expected version:', EXPECTED_VERSION);

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1366, height: 850 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  for (let i = 0; i < 30; i++) {
    if (context.serviceWorkers()[0]) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!context.serviceWorkers()[0]) {
    log('FAIL: no service worker — extension did not load');
    await context.close();
    process.exit(1);
  }
  log('service worker up, settling 3s...');
  await new Promise((r) => setTimeout(r, 3000));

  const results = [];
  for (const dapp of DAPPS) {
    const r = await testDapp(context, dapp);
    results.push(r);
  }

  log('\n=========== SMOKE-TEST SUMMARY ===========');
  log(`expected version: ${EXPECTED_VERSION}\n`);
  log('| dapp        | version | walletStd | errors | pageErr | pickerOpened | verdict | screenshot');
  log('|-------------|---------|-----------|--------|---------|--------------|---------|-----------');
  let pass = 0;
  for (const r of results) {
    const v = verdict(r);
    if (v.ok) pass++;
    const d = r.diag || {};
    const sLine = [
      r.name.padEnd(11),
      String(d.version || 'n/a').padEnd(7),
      String(d.walletStandardWallets ?? 'n/a').padEnd(9),
      String(d.errorsTotal ?? 'n/a').padEnd(6),
      String(r.pageErrors.length).padEnd(7),
      String(!!r.pickerOpened).padEnd(12),
      (v.ok ? 'OK' : `FAIL ${v.reason}`).padEnd(7),
      r.screenshot || 'none',
    ].join(' | ');
    log('| ' + sLine);
  }

  log(`\n${pass}/${results.length} dapps PASS verdict`);

  log('\n=========== PER-DAPP DETAIL ===========');
  for (const r of results) {
    log(`\n[${r.name}] (${r.url})`);
    log(`  screenshot: ${r.screenshot || 'none'}`);
    if (r.pickerScreenshot) log(`  picker:     ${r.pickerScreenshot}`);
    if (r.diag) {
      log(`  version=${r.diag.version} installedAt=${r.diag.installedAt} safeMode=${r.diag.safeMode}`);
      log(`  walletNames: [${r.diag.walletNames.join(', ')}]`);
      log(`  hooks: ${JSON.stringify(r.diag.hooks)}`);
      log(`  errors total=${r.diag.errorsTotal}, log entries total=${r.diag.logTotal}`);
      if (r.diag.recentErrors.length) {
        for (const e of r.diag.recentErrors) {
          log(`    err[${e.phase}]: ${e.message}`);
        }
      }
      if (r.diag.relevantLog.length) {
        log(`  boot/wrap/register/dispatch/install-sticky log:`);
        for (const e of r.diag.relevantLog) {
          log(`    [${e.tag}/${e.level}] ${e.msg}`);
        }
      } else {
        log(`  (no relevant log entries)`);
      }
    } else {
      log(`  diag: NONE`);
    }
    if (r.pageErrors.length) {
      log(`  pageErrors:`);
      for (const e of r.pageErrors) log(`    ${e}`);
    }
    if (r.notes.length) {
      log(`  notes: ${r.notes.join('; ')}`);
    }
  }

  await context.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
  log('runner threw:', e.message);
  console.error(e);
  process.exit(2);
});
