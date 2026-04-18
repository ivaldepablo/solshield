/**
 * Multi-dapp INTERCEPTION test: for each dapp, after the page loads, find
 * the wrapped wallet via wallet-standard discovery and call signMessage on
 * it. Verify our wrapper intercepts (counter +1, original called only after
 * verdict).
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');

const log = (...m) => process.stdout.write('[i] ' + m.join(' ') + '\n');

const DAPPS = [
  { name: 'magiceden', url: 'https://magiceden.io' },
  { name: 'jupiter', url: 'https://jup.ag' },
  { name: 'tensor', url: 'https://tensor.trade' },
  { name: 'pump', url: 'https://pump.fun' },
  { name: 'dexscreener', url: 'https://dexscreener.com' },
];

const FAKE_PHANTOM_INIT = `
  (function() {
    let originalSignMessageCalls = 0;
    window.__fakePhantomCalls = () => originalSignMessageCalls;
    let capturedDappRegister = null;
    window.__capturedRegister = () => capturedDappRegister;

    const fakeWallet = {
      name: 'Phantom',
      version: '1.0.0',
      icon: 'data:image/svg+xml;base64,PHN2Zy8+',
      chains: ['solana:mainnet'],
      accounts: [{
        address: 'TestPubKeyAddressForSolanaSimulationPlaceholder1',
        publicKey: new Uint8Array(32),
        chains: ['solana:mainnet'],
        features: ['solana:signMessage', 'standard:connect'],
      }],
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: fakeWallet.accounts }) },
        'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
        'standard:events': { version: '1.0.0', on: () => () => {} },
        'solana:signMessage': {
          version: '1.0.0',
          signMessage: async (input) => {
            originalSignMessageCalls++;
            return [{ signedMessage: input.message, signature: new Uint8Array(64) }];
          },
        },
      },
    };
    // Save the wrapped wallet that the dapp ends up registering, so the test
    // can grab a reference to it after the dance is done.
    window.__capturedWallets = [];

    // Wallet-side: just register fakeWallet whenever any app-ready fires
    window.addEventListener('wallet-standard:app-ready', (event) => {
      try {
        const detail = event.detail;
        if (detail && typeof detail.register === 'function') detail.register(fakeWallet);
      } catch(e) {}
    });

    // Dapp-side: 200ms after page load, dispatch our OWN app-ready with
    // a register that captures the wallets we're handed. The extension
    // hijacks this app-ready, swaps detail.register to a wrapping version,
    // wallets respond, the wrapping wraps and forwards to OUR register —
    // we end up with a reference to the wrapped wallet.
    setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', {
          detail: {
            register: (...wallets) => {
              window.__capturedWallets.push(...wallets);
              return () => {};
            },
          },
        }));
      } catch(e) {}
    }, 200);
  })();
`;

async function testDapp(context, dapp) {
  const page = await context.newPage();
  let pageErrors = 0;
  page.on('pageerror', () => pageErrors++);

  let result = { name: dapp.name };
  try {
    await page.goto(dapp.url, { timeout: 25000, waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 6000));

    const test = await page.evaluate(async () => {
      const w = window;
      if (!w.__solshield) return { err: 'no extension' };
      const captured = w.__capturedWallets || [];
      if (captured.length === 0) return { err: 'no captured wallets', logs: w.__solshield.log.slice(-10) };

      // Find a wallet that's our wrapped Proxy (has features that resolve to
      // a function with __solshield_wrapped marker)
      let target = null;
      for (const wallet of captured) {
        try {
          const fn = wallet?.features?.['solana:signMessage']?.signMessage;
          if (typeof fn === 'function' && fn.__solshield_wrapped) {
            target = wallet;
            break;
          }
        } catch (e) {}
      }
      if (!target) {
        const detail = captured.map((w) => {
          try {
            const fn = w?.features?.['solana:signMessage']?.signMessage;
            return { name: w?.name, hasSignFn: typeof fn === 'function', wrapped: !!fn?.__solshield_wrapped };
          } catch (e) { return { err: e.message }; }
        });
        return { err: 'no wrapped wallet in captured', captured: detail };
      }

      const beforeCalls = w.__fakePhantomCalls();
      const beforeIntercepts = w.__solshield.interceptions.total;

      const message = new TextEncoder().encode('Authenticate to your account ' + Math.random());
      let signError;
      try {
        await Promise.race([
          target.features['solana:signMessage'].signMessage({ message, account: target.accounts[0] }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('hard-15s')), 15000)),
        ]);
      } catch (e) { signError = e.message; }

      const afterCalls = w.__fakePhantomCalls();
      const afterIntercepts = w.__solshield.interceptions.total;

      return {
        wrappedWalletFound: true,
        before: { calls: beforeCalls, intercepts: beforeIntercepts },
        after: { calls: afterCalls, intercepts: afterIntercepts },
        signError,
        intercepted: afterIntercepts > beforeIntercepts,
      };
    });

    result.test = test;
    result.pageErrors = pageErrors;
    result.success = test.intercepted === true;
  } catch (err) {
    result.error = err.message;
    result.success = false;
  } finally {
    await page.close();
  }
  return result;
}

async function main() {
  log('extension:', EXTENSION_PATH);
  const context = await chromium.launchPersistentContext('', {
    headless: false,
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
  if (!context.serviceWorkers()[0]) { log('FAIL: no SW'); await context.close(); process.exit(1); }
  log('SW up');
  await new Promise((r) => setTimeout(r, 3000));

  await context.addInitScript({ content: FAKE_PHANTOM_INIT });

  const results = [];
  for (const dapp of DAPPS) {
    log(`\n--- ${dapp.name} (${dapp.url}) ---`);
    const r = await testDapp(context, dapp);
    results.push(r);
    if (r.test) {
      log(`  intercepted: ${r.test.intercepted ? 'YES ✓' : 'NO ✗'}`);
      if (r.test.before) {
        log(`  intercepts ${r.test.before.intercepts}→${r.test.after.intercepts}, original calls ${r.test.before.calls}→${r.test.after.calls}`);
      }
      if (r.test.signError) log(`  signError: ${r.test.signError}`);
      if (r.test.err) log(`  test err: ${r.test.err}`);
      if (r.test.captured) log(`  captured: ${JSON.stringify(r.test.captured)}`);
    }
    if (r.error) log(`  ERROR: ${r.error}`);
  }

  log('\n=== SUMMARY ===');
  const passed = results.filter((r) => r.success).length;
  log(`${passed}/${results.length} dapps INTERCEPTED successfully`);
  for (const r of results) {
    log(`  ${r.success ? '✓' : '✗'} ${r.name.padEnd(15)} intercepts=${r.test?.before?.intercepts ?? 'n/a'}→${r.test?.after?.intercepts ?? 'n/a'}`);
  }

  await context.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { log('runner threw:', e.message); console.error(e); process.exit(2); });
