/**
 * Worst-case extension stack: SolShield + FakePhantom + FakePocketUniverse all
 * loaded simultaneously. Verifies SolShield's wrap survives a competitor
 * security extension that hijacks dispatchEvent and stopImmediatePropagation
 * captures wallet-standard:register-wallet on at least Phantom across 3 dapps.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD_PATH = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const FAKE_PHANTOM_PATH = resolve(__dirname, 'fake-phantom-ext');
const FAKE_PU_PATH = resolve(__dirname, 'fake-pocket-universe-ext');

const log = (...m) => process.stdout.write('[3ext] ' + m.join(' ') + '\n');

const DAPPS = [
  { name: 'magiceden', url: 'https://magiceden.io' },
  { name: 'jupiter', url: 'https://jup.ag' },
  { name: 'dexscreener', url: 'https://dexscreener.com' },
];

async function testDapp(context, dapp) {
  const page = await context.newPage();
  let pageErrors = 0;
  page.on('pageerror', () => pageErrors++);

  const result = { name: dapp.name, url: dapp.url };
  try {
    await page.goto(dapp.url, { timeout: 25000, waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 6000));

    const status = await page.evaluate(() => {
      const w = window;
      const ss = w.__solshield;
      const pu = w.__fakePocketUniverse;
      if (!ss) return null;
      const names = ss.walletNames || [];
      return {
        version: ss.version,
        walletNames: names,
        wrappedCount: ss.hooks?.walletStandardWallets ?? 0,
        phantomWrapped: names.includes('Phantom'),
        appReadyHijacks: ss.log.filter((e) => e.tag === 'dispatch-hijack' && e.msg.includes('caught')).length,
        registerWalletCatches: ss.log.filter((e) => e.tag === 'register-wallet').length,
        errors: ss.errors.length,
        recentErrors: ss.errors.slice(-3),
        puPresent: !!pu,
        puIntercepts: pu ? pu.interceptCount() : 0,
        puSeen: pu ? pu.seenWallets() : [],
      };
    });

    result.status = status;
    result.pageErrors = pageErrors;
    result.success = !!status && status.phantomWrapped && status.puPresent;
  } catch (err) {
    result.error = err.message;
    result.success = false;
  } finally {
    await page.close();
  }
  return result;
}

async function main() {
  log('solshield :', SOLSHIELD_PATH);
  log('fakePhant :', FAKE_PHANTOM_PATH);
  log('fakePU    :', FAKE_PU_PATH);

  const extList = [SOLSHIELD_PATH, FAKE_PHANTOM_PATH, FAKE_PU_PATH].join(',');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extList}`,
      `--load-extension=${extList}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  for (let i = 0; i < 30; i++) {
    if (context.serviceWorkers()[0]) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!context.serviceWorkers()[0]) { log('FAIL: no SW'); await context.close(); process.exit(1); }
  log('SW up; settling 3s for all extensions to register');
  await new Promise((r) => setTimeout(r, 3000));

  const results = [];
  for (const dapp of DAPPS) {
    log(`\n--- ${dapp.name} (${dapp.url}) ---`);
    const r = await testDapp(context, dapp);
    results.push(r);
    log(`  result: ${r.success ? 'WRAP OK (Phantom + PU coexist)' : 'WRAP FAIL'}`);
    if (r.status) {
      log(`  walletNames=${JSON.stringify(r.status.walletNames)} wrapped=${r.status.wrappedCount}`);
      log(`  PU present=${r.status.puPresent} PU intercepts=${r.status.puIntercepts} PU seen=${JSON.stringify(r.status.puSeen)}`);
      log(`  hijacks=${r.status.appReadyHijacks} regCatches=${r.status.registerWalletCatches} errs=${r.status.errors} pageErrs=${r.pageErrors}`);
      if (r.status.recentErrors?.length) log(`  recentErrors=${JSON.stringify(r.status.recentErrors)}`);
    }
    if (r.error) log(`  ERROR: ${r.error}`);
  }

  log('\n=== SUMMARY ===');
  const passed = results.filter((r) => r.success).length;
  log(`${passed}/${results.length} dapps survived three-extension stack`);
  for (const r of results) {
    const tick = r.success ? 'OK ' : 'XX ';
    log(`  ${tick} ${r.name.padEnd(12)} phantomWrapped=${r.status?.phantomWrapped ?? 'n/a'} puIntercepts=${r.status?.puIntercepts ?? 'n/a'}`);
  }

  await context.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { log('runner threw:', e.message); console.error(e); process.exit(2); });
