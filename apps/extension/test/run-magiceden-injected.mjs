/**
 * Test the SolShield extension on REAL magiceden.io with an INJECTED fake
 * Phantom wallet. We inject a fake wallet via wallet-standard:register-wallet
 * BEFORE magic eden's JS runs, so Magic Eden discovers our fake wallet just
 * like it would discover real Phantom.
 *
 * Then we ask magic eden to call signMessage on the wallet (or simulate the
 * call ourselves) and verify our wrapper held the call.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');

const log = (...m) => process.stdout.write('[me-i] ' + m.join(' ') + '\n');

const FAKE_PHANTOM_INIT = `
  (function() {
    let originalSignMessageCalls = 0;
    window.__fakePhantomCalls = () => originalSignMessageCalls;

    const fakeWallet = {
      name: 'Phantom',
      version: '1.0.0',
      icon: 'data:image/svg+xml;base64,PHN2Zy8+',
      chains: ['solana:mainnet', 'solana:devnet'],
      accounts: [{
        address: 'TestPubKeyAddressForSolanaSimulationPlaceholder1',
        publicKey: new Uint8Array(32),
        chains: ['solana:mainnet'],
        features: ['solana:signMessage', 'standard:connect'],
      }],
      features: {
        'standard:connect': {
          version: '1.0.0',
          connect: async () => ({ accounts: fakeWallet.accounts }),
        },
        'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
        'standard:events': { version: '1.0.0', on: () => () => {} },
        'solana:signMessage': {
          version: '1.0.0',
          signMessage: async (input) => {
            originalSignMessageCalls++;
            console.log('[FAKE-PHANTOM] signMessage called! count=' + originalSignMessageCalls);
            return [{ signedMessage: input.message, signature: new Uint8Array(64) }];
          },
        },
      },
    };

    // Dispatch register-wallet so any wallet-standard:app-ready listener
    // (the dapp uses this) discovers our fake Phantom.
    const walletCallback = (api) => {
      try { api.register(fakeWallet); } catch (e) {}
    };

    // Dispatch immediately so dapps loading after us see the wallet.
    try {
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: walletCallback }));
    } catch (e) {}

    // Listen for app-ready events from dapps and respond by calling register.
    window.addEventListener('wallet-standard:app-ready', (event) => {
      try {
        const detail = event.detail;
        if (detail && typeof detail.register === 'function') {
          detail.register(fakeWallet);
        }
      } catch (e) {}
    });
  })();
`;

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
  if (!context.serviceWorkers()[0]) {
    log('FAIL: no service worker');
    await context.close();
    process.exit(1);
  }
  log('service worker up, sw url:', context.serviceWorkers()[0].url());

  await new Promise((r) => setTimeout(r, 3000));

  // Inject fake Phantom on every page BEFORE any other scripts run.
  await context.addInitScript({ content: FAKE_PHANTOM_INIT });

  const page = await context.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('SolShield') || t.includes('FAKE-PHANTOM') || t.includes('register-wallet')) {
      log('CONSOLE:', m.type(), t);
    }
  });

  log('navigating to magiceden.io...');
  try {
    await page.goto('https://magiceden.io', { timeout: 30000, waitUntil: 'domcontentloaded' });
  } catch (err) {
    log('navigation failed:', err.message);
  }

  log('waiting 10s for full load + wallet discovery...');
  await new Promise((r) => setTimeout(r, 10000));

  const result = await page.evaluate(() => {
    const out = { url: location.href };
    const w = window;

    out.fakePhantomCalls = w.__fakePhantomCalls ? w.__fakePhantomCalls() : 'not exposed';
    out.solshieldStatus = w.__solshield
      ? {
          version: w.__solshield.version,
          walletNames: w.__solshield.walletNames,
          walletStandardWallets: w.__solshield.hooks?.walletStandardWallets,
          interceptions: w.__solshield.interceptions,
          errors: w.__solshield.errors,
          log: w.__solshield.log.slice(-30),
        }
      : null;

    return out;
  });

  log('=== RESULT BEFORE SIGN ATTEMPT ===');
  console.log(JSON.stringify(result, null, 2));

  // Now try to find the wrapped wallet in navigator.wallets and call signMessage.
  // If our wrapper fires, originalSignMessageCalls should NOT increment (we hold
  // the call until verdict). After verdict (which will be safe for a clean msg),
  // we DO call original, so count should go to 1.
  log('attempting to call signMessage on a wallet from navigator.wallets...');
  const signResult = await page.evaluate(async () => {
    try {
      const reg = navigator?.wallets;
      if (!reg || typeof reg.get !== 'function') return { err: 'no navigator.wallets registry' };
      const wallets = reg.get();
      const phantom = wallets.find((w) => w.name === 'Phantom');
      if (!phantom) return { err: 'no Phantom in registry', count: wallets.length, names: wallets.map((w) => w.name) };

      const signFn = phantom.features['solana:signMessage']?.signMessage;
      const isWrapped = signFn?.__solshield_wrapped === true;

      const beforeCount = window.__fakePhantomCalls();
      const beforeIntercepts = window.__solshield.interceptions.total;

      let signResult, signError;
      try {
        const result = await Promise.race([
          signFn({
            message: new TextEncoder().encode('Authenticate to your account. Random nonce: ' + Math.random()),
            account: phantom.accounts[0],
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('hard-timeout-15s')), 15000)),
        ]);
        signResult = 'resolved';
      } catch (e) {
        signError = e.message;
      }

      const afterCount = window.__fakePhantomCalls();
      const afterIntercepts = window.__solshield.interceptions.total;

      return {
        isWrapped,
        before: { count: beforeCount, intercepts: beforeIntercepts },
        after: { count: afterCount, intercepts: afterIntercepts },
        signResult,
        signError,
      };
    } catch (e) {
      return { err: e.message };
    }
  });

  log('=== SIGN RESULT ===');
  console.log(JSON.stringify(signResult, null, 2));

  log('=== FINAL SOLSHIELD LOG ===');
  const finalLog = await page.evaluate(() => window.__solshield?.log.slice(-15) || null);
  console.log(JSON.stringify(finalLog, null, 2));

  await new Promise((r) => setTimeout(r, 2000));
  await context.close();
}

main().catch((e) => {
  log('runner threw:', e.message);
  console.error(e);
  process.exit(2);
});
