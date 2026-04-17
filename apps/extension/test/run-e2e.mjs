/**
 * End-to-end smoke test for the SolShield browser extension.
 *
 * Spins up Chromium with our packed extension loaded, points it at a fixture
 * page that simulates a Phantom-like Wallet Standard wallet, and verifies the
 * extension's hooks fire as expected. Runs entirely headless so I can iterate
 * without bothering the user every time.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const FIXTURE_PATH = resolve(__dirname, 'fixture-page.html');
const PORT = 7331;

function log(msg, ...rest) {
  process.stdout.write(`[e2e] ${msg}${rest.length ? ' ' + rest.join(' ') : ''}\n`);
}

function startFixtureServer() {
  const html = readFileSync(FIXTURE_PATH, 'utf8');
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
  return new Promise((resolveStart) => {
    server.listen(PORT, () => resolveStart(server));
  });
}

async function main() {
  log(`extension: ${EXTENSION_PATH}`);
  const server = await startFixtureServer();
  log(`fixture server: http://localhost:${PORT}`);

  // Headless: 'new' is required for extensions in modern Playwright; if it's
  // unsupported, fall back to non-headless (still works, just opens a window).
  let context;
  try {
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
      ],
    });
  } catch (err) {
    log(`launch failed: ${err.message}`);
    server.close();
    process.exit(2);
  }

  // Wait for the service worker to register
  let serviceWorker;
  for (let i = 0; i < 30; i++) {
    serviceWorker = context.serviceWorkers()[0];
    if (serviceWorker) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!serviceWorker) {
    log('FAIL: extension service worker did not start');
    await context.close();
    server.close();
    process.exit(1);
  }
  const extId = serviceWorker.url().split('/')[2];
  log(`service worker up, extension id: ${extId}`);

  // Give the SW time to register dynamic MAIN-world content scripts.
  await new Promise((r) => setTimeout(r, 2000));

  const page = await context.newPage();
  page.on('console', (msg) => log(`page console [${msg.type()}]:`, msg.text()));
  page.on('pageerror', (err) => log(`page error:`, err.message));

  await page.goto(`http://localhost:${PORT}`);
  // Reload once — first navigation after SW startup sometimes misses the
  // dynamic content script. A reload reliably picks it up.
  await page.reload();

  // Wait up to 30s for the test to complete (signMessage may wait for API)
  log('waiting for test result...');
  let result = null;
  for (let i = 0; i < 150; i++) {
    result = await page.evaluate(() => window.__solshieldTestResult || null);
    if (result) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const fixtureOutput = await page.evaluate(() => document.getElementById('result').textContent);
  log('--- fixture page output ---');
  process.stdout.write(fixtureOutput + '\n');
  log('--- end fixture output ---');

  if (!result) {
    log('FAIL: fixture timed out without setting result');
    await context.close();
    server.close();
    process.exit(1);
  }

  log('test result:', JSON.stringify({ ok: result.ok, before: result.beforeIntercepts, after: result.afterIntercepts, walletsWrapped: result.walletsWrapped, walletNames: result.walletNames }, null, 2));

  if (result.errors && result.errors.length > 0) {
    log('errors recorded by extension:');
    for (const e of result.errors) {
      log(`  - [${e.phase}] ${e.message}`);
    }
  }

  if (result.log) {
    log('extension event log:');
    for (const e of result.log) {
      log(`  [${e.level}] ${e.tag}: ${e.msg}`);
    }
  }

  await context.close();
  server.close();
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  log(`runner threw: ${err.message}`);
  console.error(err);
  process.exit(2);
});
