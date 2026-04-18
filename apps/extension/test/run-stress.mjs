/**
 * STRESS test: rapid concurrent signMessage calls + simulated React thrash.
 * If wrapper survives this it should survive any real dapp.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const FAKE = resolve(__dirname, 'fake-phantom-ext');

const log = (...m) => process.stdout.write('[stress] ' + m.join(' ') + '\n');

const DAPPS = [
  'https://magiceden.io',
  'https://jup.ag',
  'https://tensor.trade',
  'https://pump.fun',
  'https://dexscreener.com',
];

async function stressDapp(context, url) {
  const page = await context.newPage();
  let pageErrors = 0;
  page.on('pageerror', () => pageErrors++);

  let result = { url, pageErrors: 0 };
  try {
    await page.goto(url, { timeout: 25000, waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 6000));

    // Set up dapp-side capture
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

    // Stress: 10 concurrent signMessage calls per wallet across 4 wallets
    // Simulates worst-case dapp behavior (e.g., user clicks sign repeatedly,
    // or react re-renders trigger duplicate calls).
    const stress = await page.evaluate(async () => {
      const wallets = window.__capturedWallets || [];
      const wrapped = wallets.filter((w) => {
        try {
          return w?.features?.['solana:signMessage']?.signMessage?.__solshield_wrapped === true;
        } catch {
          return false;
        }
      });
      if (wrapped.length === 0) return { ok: false, reason: 'no wrapped wallets' };

      const beforeIntercepts = window.__solshield.interceptions.total;
      const beforeOriginalCalls = wrapped.reduce(
        (s, w) => s + window.__fakeWallets.signMessageCalls(w.name),
        0,
      );

      // Fire 10 calls per wallet, all concurrent — total 40 parallel calls
      const allCalls = [];
      for (const w of wrapped) {
        for (let i = 0; i < 10; i++) {
          const message = new TextEncoder().encode(`stress ${w.name} ${i}`);
          allCalls.push(
            Promise.race([
              w.features['solana:signMessage'].signMessage({
                message,
                account: w.accounts[0],
              }).then(() => 'ok').catch((e) => 'err:' + e.message),
              new Promise((_, rej) => setTimeout(() => rej(new Error('15s')), 15000)).catch(() => 'timeout'),
            ]).then((r) => r),
          );
        }
      }

      const startedAt = performance.now();
      const results = await Promise.all(allCalls);
      const elapsed = Math.round(performance.now() - startedAt);

      const afterIntercepts = window.__solshield.interceptions.total;
      const afterOriginalCalls = wrapped.reduce(
        (s, w) => s + window.__fakeWallets.signMessageCalls(w.name),
        0,
      );

      const okCount = results.filter((r) => r === 'ok').length;
      const errCount = results.filter((r) => typeof r === 'string' && r.startsWith('err')).length;
      const timeoutCount = results.filter((r) => r === 'timeout').length;

      return {
        ok: errCount === 0 && timeoutCount === 0 && okCount === results.length,
        total: results.length,
        okCount,
        errCount,
        timeoutCount,
        elapsedMs: elapsed,
        intercepts: { before: beforeIntercepts, after: afterIntercepts, delta: afterIntercepts - beforeIntercepts },
        originalCalls: { before: beforeOriginalCalls, after: afterOriginalCalls, delta: afterOriginalCalls - beforeOriginalCalls },
        wrappedCount: wrapped.length,
      };
    });

    result = { url, ...stress, pageErrors };
  } catch (err) {
    result.error = err.message;
    result.ok = false;
  } finally {
    await page.close();
  }
  return result;
}

async function main() {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${SOLSHIELD},${FAKE}`,
      `--load-extension=${SOLSHIELD},${FAKE}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

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
  for (const url of DAPPS) {
    log(`\n--- ${url} ---`);
    const r = await stressDapp(context, url);
    results.push(r);
    log(`  ${r.ok ? '✓ PASS' : '✗ FAIL'} ${r.okCount}/${r.total} calls in ${r.elapsedMs}ms`);
    if (r.intercepts) log(`  intercepts +${r.intercepts.delta}, original calls +${r.originalCalls.delta}`);
    if (r.errCount) log(`  errors: ${r.errCount}, timeouts: ${r.timeoutCount}`);
    if (r.pageErrors) log(`  page errors (mostly react #418): ${r.pageErrors}`);
    if (r.error) log(`  ERROR: ${r.error}`);
  }

  log('\n=== SUMMARY ===');
  const passed = results.filter((r) => r.ok).length;
  const totalCalls = results.reduce((s, r) => s + (r.total || 0), 0);
  const okCalls = results.reduce((s, r) => s + (r.okCount || 0), 0);
  log(`${passed}/${results.length} dapps fully passed stress`);
  log(`${okCalls}/${totalCalls} total signMessage calls succeeded`);

  await context.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  log('runner threw:', e.message);
  console.error(e);
  process.exit(2);
});
