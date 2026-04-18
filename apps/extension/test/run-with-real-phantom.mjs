/**
 * REAL-WORLD test: load both SolShield AND a Phantom-clone extension into
 * Chromium, navigate to real dapps, verify SolShield wraps the wallet that
 * the dapp ends up with.
 *
 * Unlike the run-multi-intercept test (which injects a fake wallet via
 * page-side init script), this test runs the wallet in a SEPARATE chrome
 * extension exactly the way real Phantom does — including the load-order
 * race that's the most likely real-world failure mode.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const FAKE_PHANTOM = resolve(__dirname, 'fake-phantom-ext');

const log = (...m) => process.stdout.write('[real] ' + m.join(' ') + '\n');

const DAPPS = [
  { name: 'magiceden', url: 'https://magiceden.io' },
  { name: 'jupiter', url: 'https://jup.ag' },
  { name: 'tensor', url: 'https://tensor.trade' },
  { name: 'pump', url: 'https://pump.fun' },
  { name: 'dexscreener', url: 'https://dexscreener.com' },
  { name: 'orca', url: 'https://www.orca.so' },
  { name: 'drift', url: 'https://app.drift.trade' },
];

async function testDapp(context, dapp) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  let result = { name: dapp.name };
  try {
    await page.goto(dapp.url, { timeout: 25000, waitUntil: 'domcontentloaded' });
    // Allow wallet-standard handshake + dapp init.
    await new Promise((r) => setTimeout(r, 7000));

    // Set up our own dapp-side register listener that captures wallets.
    // We do this AFTER page load to simulate a dapp's late discovery.
    await page.evaluate(() => {
      window.__capturedWallets = [];
      window.dispatchEvent(
        new CustomEvent('wallet-standard:app-ready', {
          detail: {
            register: (...wallets) => {
              window.__capturedWallets.push(...wallets);
              return () => {};
            },
          },
        }),
      );
    });

    await new Promise((r) => setTimeout(r, 500));

    const test = await page.evaluate(async () => {
      const wallets = window.__capturedWallets || [];

      // Find ALL wrapped wallets (Phantom + Solflare + Backpack + Glow)
      const wrappedWallets = wallets.filter((w) => {
        try {
          const fn = w?.features?.['solana:signMessage']?.signMessage;
          return typeof fn === 'function' && fn.__solshield_wrapped;
        } catch {
          return false;
        }
      });

      if (wrappedWallets.length === 0) {
        return {
          ok: false,
          reason: 'no wrapped wallets',
          captured: wallets.map((w) => w?.name),
          count: wallets.length,
        };
      }

      // Test signMessage on EACH wallet — verify our wrap intercepts all of them
      const perWalletResults = [];
      for (const target of wrappedWallets) {
        const beforeCalls = window.__fakeWallets.signMessageCalls(target.name);
        const beforeIntercepts = window.__solshield.interceptions.total;
        const message = new TextEncoder().encode('Auth ' + target.name + ' ' + Math.random());

        let signError;
        try {
          await Promise.race([
            target.features['solana:signMessage'].signMessage({
              message,
              account: target.accounts[0],
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('hard-10s')), 10000)),
          ]);
        } catch (e) {
          signError = e.message;
        }

        const afterCalls = window.__fakeWallets.signMessageCalls(target.name);
        const afterIntercepts = window.__solshield.interceptions.total;
        perWalletResults.push({
          name: target.name,
          intercepted: afterIntercepts > beforeIntercepts,
          beforeCalls,
          afterCalls,
          beforeIntercepts,
          afterIntercepts,
          signError,
        });
      }

      const allIntercepted = perWalletResults.every((r) => r.intercepted);
      return {
        ok: allIntercepted,
        wrappedCount: wrappedWallets.length,
        capturedNames: wallets.map((w) => w?.name),
        perWallet: perWalletResults,
        finalLog: window.__solshield.log.slice(-10),
      };
    });

    result.test = test;
    result.success = test.ok === true;
    result.consoleErrors = consoleErrors.length;
  } catch (err) {
    result.error = err.message;
    result.success = false;
  } finally {
    await page.close();
  }
  return result;
}

async function main() {
  log('SolShield:', SOLSHIELD);
  log('FakePhantom:', FAKE_PHANTOM);

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${SOLSHIELD},${FAKE_PHANTOM}`,
      `--load-extension=${SOLSHIELD},${FAKE_PHANTOM}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  // Wait for service worker
  for (let i = 0; i < 30; i++) {
    if (context.serviceWorkers()[0]) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!context.serviceWorkers()[0]) {
    log('FAIL: no SW');
    await context.close();
    process.exit(1);
  }
  log('SW up');
  await new Promise((r) => setTimeout(r, 4000));

  const results = [];
  for (const dapp of DAPPS) {
    log(`\n--- ${dapp.name} ---`);
    const r = await testDapp(context, dapp);
    results.push(r);
    if (r.test) {
      log(`  overall: ${r.success ? 'ALL INTERCEPTED ✓' : 'PARTIAL/NONE ✗'}`);
      if (r.test.wrappedCount !== undefined) {
        log(`  wrapped wallets: ${r.test.wrappedCount}/${r.test.capturedNames?.length}`);
      }
      if (r.test.perWallet) {
        for (const pw of r.test.perWallet) {
          log(
            `    ${pw.intercepted ? '✓' : '✗'} ${pw.name.padEnd(10)} intercepts ${pw.beforeIntercepts}→${pw.afterIntercepts}, calls ${pw.beforeCalls}→${pw.afterCalls}, err=${pw.signError || 'none'}`,
          );
        }
      }
      if (r.test.reason) log(`  reason: ${r.test.reason}`);
      if (r.test.captured) log(`  captured: ${JSON.stringify(r.test.captured)}`);
    }
    if (r.error) log(`  ERROR: ${r.error}`);
  }

  log('\n=== SUMMARY ===');
  const passed = results.filter((r) => r.success).length;
  log(`${passed}/${results.length} dapps fully intercepted (all 4 wallets each)`);

  // Per-wallet-per-dapp breakdown
  log('\nPer-wallet breakdown:');
  const walletNames = ['Phantom', 'Solflare', 'Backpack', 'Glow'];
  for (const name of walletNames) {
    const ok = results.filter((r) => r.test?.perWallet?.find((pw) => pw.name === name)?.intercepted).length;
    log(`  ${name.padEnd(10)} intercepted on ${ok}/${results.length} dapps`);
  }

  await context.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  log('runner threw:', e.message);
  console.error(e);
  process.exit(2);
});
