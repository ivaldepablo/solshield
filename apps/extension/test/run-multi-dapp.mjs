/**
 * Multi-dapp test: load each dapp with our extension + injected fake Phantom,
 * verify our wrap fires.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');

const log = (...m) => process.stdout.write('[multi] ' + m.join(' ') + '\n');

const DAPPS = [
  { name: 'magiceden', url: 'https://magiceden.io' },
  { name: 'jupiter', url: 'https://jup.ag' },
  { name: 'tensor', url: 'https://tensor.trade' },
  { name: 'raydium', url: 'https://raydium.io' },
  { name: 'drift', url: 'https://app.drift.trade' },
  { name: 'pump', url: 'https://pump.fun' },
  { name: 'orca', url: 'https://www.orca.so' },
  { name: 'dexscreener', url: 'https://dexscreener.com' },
];

const FAKE_PHANTOM_INIT = `
  (function() {
    let originalSignMessageCalls = 0;
    window.__fakePhantomCalls = () => originalSignMessageCalls;
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
    const walletCallback = (api) => { try { api.register(fakeWallet); } catch(e) {} };
    try { window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: walletCallback })); } catch(e) {}
    window.addEventListener('wallet-standard:app-ready', (event) => {
      try {
        const detail = event.detail;
        if (detail && typeof detail.register === 'function') detail.register(fakeWallet);
      } catch(e) {}
    });
  })();
`;

async function testDapp(context, dapp) {
  const page = await context.newPage();
  let pageErrors = 0;
  page.on('pageerror', () => pageErrors++);

  let result = { name: dapp.name, url: dapp.url };
  try {
    await page.goto(dapp.url, { timeout: 25000, waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 6000));

    const status = await page.evaluate(() => {
      const w = window;
      if (!w.__solshield) return null;
      return {
        version: w.__solshield.version,
        walletNames: w.__solshield.walletNames,
        walletStandardWallets: w.__solshield.hooks?.walletStandardWallets,
        legacyWindowSolana: w.__solshield.hooks?.legacyWindowSolana,
        appReadyHijacks: w.__solshield.log.filter((e) => e.tag === 'dispatch-hijack' && e.msg.includes('caught')).length,
        registerWalletCatches: w.__solshield.log.filter((e) => e.tag === 'register-wallet').length,
        wrapWalletEvents: w.__solshield.log.filter((e) => e.tag === 'wrap-wallet').length,
        errors: w.__solshield.errors.length,
        recentErrors: w.__solshield.errors.slice(-3),
      };
    });

    result.status = status;
    result.pageErrors = pageErrors;
    result.success = !!status && status.walletStandardWallets > 0;
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
    log(`\n--- testing ${dapp.name} (${dapp.url}) ---`);
    const r = await testDapp(context, dapp);
    results.push(r);
    log(`  result: ${r.success ? 'WRAP OK' : 'WRAP FAIL'}`);
    if (r.status) {
      log(`  wallets wrapped: ${r.status.walletStandardWallets}, names: ${JSON.stringify(r.status.walletNames)}`);
      log(`  app-ready hijacks: ${r.status.appReadyHijacks}, register-wallet catches: ${r.status.registerWalletCatches}`);
      log(`  errors: ${r.status.errors}, page errors: ${r.pageErrors}`);
    }
    if (r.error) log(`  ERROR: ${r.error}`);
  }

  log('\n=== SUMMARY ===');
  const passed = results.filter((r) => r.success).length;
  log(`${passed}/${results.length} dapps wrapped successfully`);
  for (const r of results) {
    log(`  ${r.success ? '✓' : '✗'} ${r.name.padEnd(15)} wallets=${r.status?.walletStandardWallets ?? 'n/a'} hijacks=${r.status?.appReadyHijacks ?? 'n/a'} errs=${r.status?.errors ?? 'n/a'}`);
  }

  await context.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { log('runner threw:', e.message); console.error(e); process.exit(2); });
