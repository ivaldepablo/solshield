/**
 * Test the SolShield extension against the REAL magiceden.io.
 *
 * Loads the extension, navigates to magic eden, waits for it to fully load,
 * then inspects:
 *   - window.__solshield (to see what hooks are installed)
 *   - The wallets the dapp received via @wallet-standard
 *   - Whether those wallets carry our __solshield_wrapped marker on
 *     features['solana:signMessage'].signMessage
 *
 * If the dapp's wallet's signMessage is NOT wrapped, our hook lost the race
 * with magic eden's wallet-standard discovery. That's the bug to fix.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');

const log = (...m) => process.stdout.write('[me] ' + m.join(' ') + '\n');

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

  // Wait for service worker
  for (let i = 0; i < 30; i++) {
    if (context.serviceWorkers()[0]) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!context.serviceWorkers()[0]) {
    log('FAIL: no service worker');
    await context.close();
    process.exit(1);
  }
  log('service worker up');

  // Wait extra for dynamic content script registration
  await new Promise((r) => setTimeout(r, 3000));

  const page = await context.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('SolShield') || t.includes('solshield') || t.includes('register-wallet') || t.includes('wrap-wallet')) {
      log('CONSOLE:', m.type(), t);
    }
  });
  page.on('pageerror', (e) => log('PAGE_ERROR:', e.message));

  log('navigating to magiceden.io...');
  try {
    await page.goto('https://magiceden.io', { timeout: 30000, waitUntil: 'domcontentloaded' });
  } catch (err) {
    log('navigation failed:', err.message);
  }

  log('waiting 8s for full load + wallet discovery...');
  await new Promise((r) => setTimeout(r, 8000));

  // Inspect everything
  const result = await page.evaluate(() => {
    const out = { url: location.href };
    const w = window;

    out.solshieldStatus = w.__solshield
      ? {
          version: w.__solshield.version,
          safeMode: w.__solshield.safeMode,
          walletNames: w.__solshield.walletNames,
          walletStandardWallets: w.__solshield.hooks?.walletStandardWallets,
          legacyWindowSolana: w.__solshield.hooks?.legacyWindowSolana,
          legacyPhantom: w.__solshield.hooks?.legacyPhantom,
          interceptions: w.__solshield.interceptions,
          errors: w.__solshield.errors,
          log: w.__solshield.log.slice(-30),
        }
      : null;

    // Try to read navigator.wallets (the wallet-standard registry)
    try {
      const reg = w.navigator?.wallets;
      if (reg && typeof reg.get === 'function') {
        const wallets = reg.get();
        out.navigatorWalletsCount = wallets.length;
        out.navigatorWallets = wallets.map((wallet) => {
          const features = wallet.features || {};
          const signMsgFeat = features['solana:signMessage'];
          const signMsgFn = signMsgFeat?.signMessage;
          return {
            name: wallet.name,
            hasSignMessage: typeof signMsgFn === 'function',
            signMessageWrapped: signMsgFn?.__solshield_wrapped === true,
          };
        });
      } else {
        out.navigatorWallets = 'no navigator.wallets';
      }
    } catch (e) {
      out.navigatorWalletsErr = e.message;
    }

    // Check window.solana
    try {
      const sol = w.solana;
      out.windowSolana = sol
        ? {
            isPhantom: sol.isPhantom,
            hasSignMessage: typeof sol.signMessage === 'function',
            signMessageWrapped: sol.signMessage?.__solshield_wrapped === true,
          }
        : 'no window.solana';
    } catch (e) {
      out.windowSolanaErr = e.message;
    }

    return out;
  });

  log('=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));

  await new Promise((r) => setTimeout(r, 2000));
  await context.close();
}

main().catch((e) => {
  log('runner threw:', e.message);
  console.error(e);
  process.exit(2);
});
