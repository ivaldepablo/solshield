/**
 * v0.4.4 multi-wallet coverage matrix.
 *
 * For each real wallet (downloaded from CWS by download-real-wallets.mjs)
 * we launch a fresh persistent browser context with ONLY SolShield + that
 * wallet loaded — no cross-extension race conditions.
 *
 * For each wallet we visit two HTTP fixtures:
 *   1. /standard.html — installs a wallet-standard register-wallet listener
 *      so we can count how many wallets the wallet registered, and verify
 *      SolShield's __solshield.hooks.walletStandardWallets count went up.
 *   2. /legacy.html  — probes a long list of legacy window.* globals that
 *      different wallets use (window.solana, window.solflare, window.phantom,
 *      window.glow, window.coinbaseSolana, window.trustwallet.solana,
 *      window.coin98.sol, window.mathwallet.solana, ...).
 *
 * We then read __solshield.walletNames and __solshield.hooks to grade
 * coverage per wallet. We also screenshot each fixture and capture the
 * relevant log entries.
 *
 * Run:
 *   node apps/extension/test/run-multi-wallet-coverage.mjs
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOLSHIELD_PATH = resolve(__dirname, '..', 'build', 'chrome-mv3-prod');
const REAL_WALLETS_DIR = resolve(__dirname, 'real-wallets');
const SCREENSHOT_DIR = resolve(__dirname, 'screenshots');

const log = (...m) => process.stdout.write('[multi] ' + m.join(' ') + '\n');

/**
 * Wallet target catalogue. `legacyGlobals` is the list of window.* paths to
 * probe for that wallet — based on each wallet's documented inpage script.
 * If SolShield wraps any of those globals via its early defineProperty
 * interceptor we'll see __solshield.hooks.legacy* flip true.
 */
const WALLETS = [
  {
    name: 'phantom',
    expectName: 'Phantom',
    legacyGlobals: ['phantom.solana', 'solana'],
  },
  {
    name: 'solflare',
    expectName: 'Solflare',
    legacyGlobals: ['solflare', 'solana'],
  },
  {
    name: 'backpack',
    expectName: 'Backpack',
    legacyGlobals: ['backpack', 'solana'],
  },
  {
    name: 'glow',
    expectName: 'Glow',
    legacyGlobals: ['glow', 'glowSolana', 'solana'],
  },
  {
    name: 'trust',
    expectName: 'Trust',
    legacyGlobals: ['trustwallet.solana', 'trustWallet.solana', 'trustwallet', 'solana'],
  },
  {
    name: 'coinbase',
    expectName: 'Coinbase',
    // Coinbase ships a Solana provider as window.coinbaseSolana plus the
    // EVM as window.coinbaseWalletExtension. Solana lives at .coinbaseSolana.
    legacyGlobals: ['coinbaseSolana', 'coinbaseWalletExtension', 'solana'],
  },
  {
    name: 'mathwallet',
    expectName: 'Math',
    // MathWallet exposes window.solana with the .isMathWallet flag (its own
    // multichain provider object lives at window.martian on Aptos but on
    // Solana it just patches window.solana directly).
    legacyGlobals: ['solana'],
  },
  {
    name: 'coin98',
    expectName: 'Coin98',
    // Coin98 uses window.coin98.sol; it ALSO mirrors as window.solana.
    legacyGlobals: ['coin98.sol', 'coin98Wallet.sol', 'solana'],
  },
];

const RELEVANT_TAGS = new Set([
  'boot',
  'wrap-wallet',
  'register-wallet',
  'dispatch-hijack',
  'install-sticky',
  'patch-provider',
  'sealed',
  'defineProperty',
]);

/* ────────── HTTP fixtures ────────── */

const STANDARD_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>multi-wallet ws fixture</title></head>
<body>
<h1>wallet-standard fixture</h1>
<pre id="out"></pre>
<script>
  window.__wallets__ = [];
  window.addEventListener('wallet-standard:register-wallet', (e) => {
    try {
      const detail = e.detail;
      if (typeof detail === 'function') {
        detail({
          register: (...wallets) => {
            for (const w of wallets) window.__wallets__.push(w);
            return () => {};
          },
        });
      }
    } catch {}
  });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', {
    detail: {
      register: (...wallets) => {
        for (const w of wallets) window.__wallets__.push(w);
        return () => {};
      },
    },
  }));
  // Allow time for the wallet's own register dispatch.
  setTimeout(() => {
    const out = document.getElementById('out');
    out.textContent = 'wallets=' + window.__wallets__.length + '\\n' +
      window.__wallets__.map((w) => {
        try { return '- ' + (w.name || '?') + ' [' + Object.keys(w.features || {}).join(',') + ']'; }
        catch { return '- (throws)'; }
      }).join('\\n');
  }, 5000);
</script>
</body></html>`;

const LEGACY_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>multi-wallet legacy fixture</title></head>
<body>
<h1>legacy fixture</h1>
<pre id="out"></pre>
<script>
  // Probe a wide list of known legacy globals after a short settling period
  // (some wallets inject through dynamic <script> insertion which lands a
  // few hundred ms after document_start).
  function probe() {
    const probes = [
      'solana', 'solflare', 'backpack', 'phantom', 'glow', 'glowSolana',
      'trustwallet', 'trustWallet', 'coinbaseSolana', 'coinbaseWalletExtension',
      'mathwallet', 'coin98', 'coin98Wallet', 'sollet', 'nightly',
    ];
    const found = {};
    for (const path of probes) {
      try {
        const v = window[path];
        if (v == null) { found[path] = null; continue; }
        const t = typeof v;
        const keys = (t === 'object') ? Object.keys(v).slice(0, 30) : null;
        const sub = {};
        if (t === 'object') {
          for (const sk of ['solana', 'sol', 'isSolana', 'isPhantom', 'isSolflare',
                            'isBackpack', 'isGlow', 'isCoinbase', 'isCoin98',
                            'isMathWallet', 'isTrust', 'isTrustWallet',
                            'signMessage', 'signTransaction']) {
            if (sk in v) sub[sk] = typeof v[sk];
          }
        }
        found[path] = { type: t, keys, sub };
      } catch (e) {
        found[path] = { error: String(e && e.message ? e.message : e) };
      }
    }
    document.getElementById('out').textContent = JSON.stringify(found, null, 2);
    window.__legacyProbe = found;
  }
  // Wait long enough for slow async-loader wallets (MathWallet) to inject.
  setTimeout(probe, 5000);
</script>
</body></html>`;

async function startFixtureServer() {
  return new Promise((resolveSrv) => {
    const server = createServer((req, res) => {
      const url = req.url || '/';
      if (url.startsWith('/standard')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(STANDARD_HTML);
        return;
      }
      if (url.startsWith('/legacy')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(LEGACY_HTML);
        return;
      }
      res.writeHead(204);
      res.end();
    });
    // Bind on 127.0.0.1 but advertise as `localhost` — Glow and MathWallet
    // restrict their content_scripts to *://*/* and *://localhost/* and
    // explicitly skip raw 127.0.0.1, so we MUST use the hostname `localhost`
    // for the navigation URL.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolveSrv({
        server,
        baseUrl: `http://localhost:${addr.port}`,
      });
    });
  });
}

async function readDiag(page) {
  return page.evaluate((relTags) => {
    const rel = new Set(relTags);
    const s = window.__solshield;
    if (!s) return { exists: false };
    return {
      exists: true,
      version: s.version,
      safeMode: s.safeMode,
      safeModeReason: s.safeModeReason,
      walletNames: Array.isArray(s.walletNames) ? s.walletNames.slice() : [],
      walletStandardWallets: s.hooks?.walletStandardWallets ?? 0,
      legacyWindowSolana: !!s.hooks?.legacyWindowSolana,
      legacyPhantom: !!s.hooks?.legacyPhantom,
      legacySolflare: !!s.hooks?.legacySolflare,
      errorsTotal: (s.errors || []).length,
      recentErrors: (s.errors || []).slice(-5).map((e) => ({
        phase: e.phase, message: e.message,
      })),
      relevantLog: (s.log || [])
        .filter((entry) => rel.has(entry.tag))
        .slice(-25)
        .map((entry) => ({ tag: entry.tag, level: entry.level, msg: entry.msg })),
    };
  }, Array.from(RELEVANT_TAGS));
}

async function testOneWallet(wallet, baseUrl) {
  const walletDir = resolve(REAL_WALLETS_DIR, wallet.name);
  if (!existsSync(walletDir)) {
    return { wallet: wallet.name, skipped: true, reason: 'not downloaded' };
  }

  log(`\n========== ${wallet.name.toUpperCase()} ==========`);
  log(`  loading: ${walletDir}`);

  const extList = [SOLSHIELD_PATH, walletDir].join(',');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extList}`,
      `--load-extension=${extList}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const result = {
    wallet: wallet.name,
    expectName: wallet.expectName,
    legacyGlobals: wallet.legacyGlobals,
    standard: {},
    legacy: {},
    walletNames: [],
    walletStandardWallets: 0,
    legacyHooks: {},
    notes: [],
  };

  try {
    // Wait up to 10s for both extension service workers to come up.
    for (let i = 0; i < 50; i++) {
      if (context.serviceWorkers().length >= 1) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (context.serviceWorkers().length < 1) {
      result.notes.push('no service worker for SolShield/wallet — extension load FAILED');
      await context.close();
      return result;
    }
    // Some wallets (Coin98, Trust, MathWallet's dynamic-import loader) take
    // several seconds to spin up before the inpage script lands.
    await new Promise((r) => setTimeout(r, 6000));

    /* === wallet-standard fixture === */
    {
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      try {
        await page.goto(`${baseUrl}/standard.html`, {
          timeout: 15000, waitUntil: 'domcontentloaded',
        });
        // Wait for both: wallet's own dispatch + the fixture's setTimeout.
        // MathWallet's dynamic-import injects ~3-4s after document_start, so
        // give the slow ones extra room.
        await new Promise((r) => setTimeout(r, 7000));
        const sp = resolve(SCREENSHOT_DIR, `coverage-${wallet.name}-standard.png`);
        await page.screenshot({ path: sp }).catch(() => {});
        result.standard.screenshot = sp;
        result.standard.diag = await readDiag(page);
        result.standard.wallets = await page.evaluate(() =>
          (window.__wallets__ || []).map((w) => {
            try {
              return {
                name: w.name || '?',
                features: Object.keys(w.features || {}),
              };
            } catch (e) {
              return { name: '(throws)', error: String(e && e.message) };
            }
          })
        );
        result.standard.pageErrors = pageErrors;
      } catch (e) {
        result.standard.error = e.message;
      } finally {
        await page.close().catch(() => {});
      }
    }

    /* === legacy probe fixture === */
    {
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      try {
        await page.goto(`${baseUrl}/legacy.html`, {
          timeout: 15000, waitUntil: 'domcontentloaded',
        });
        await new Promise((r) => setTimeout(r, 7000));
        const sp = resolve(SCREENSHOT_DIR, `coverage-${wallet.name}-legacy.png`);
        await page.screenshot({ path: sp }).catch(() => {});
        result.legacy.screenshot = sp;
        result.legacy.diag = await readDiag(page);
        result.legacy.probe = await page.evaluate(() => window.__legacyProbe || null);
        result.legacy.pageErrors = pageErrors;
      } catch (e) {
        result.legacy.error = e.message;
      } finally {
        await page.close().catch(() => {});
      }
    }

    // Aggregate
    const wsDiag = result.standard.diag;
    const legDiag = result.legacy.diag;
    const merged = new Set([
      ...(wsDiag?.walletNames || []),
      ...(legDiag?.walletNames || []),
    ]);
    result.walletNames = Array.from(merged);
    result.walletStandardWallets = Math.max(
      wsDiag?.walletStandardWallets ?? 0,
      legDiag?.walletStandardWallets ?? 0,
    );
    result.legacyHooks = {
      windowSolana: legDiag?.legacyWindowSolana ?? wsDiag?.legacyWindowSolana,
      phantom: legDiag?.legacyPhantom ?? wsDiag?.legacyPhantom,
      solflare: legDiag?.legacySolflare ?? wsDiag?.legacySolflare,
    };
    result.errors = (wsDiag?.errorsTotal ?? 0) + (legDiag?.errorsTotal ?? 0);
    result.safeMode = wsDiag?.safeMode || legDiag?.safeMode;
    result.safeModeReason = wsDiag?.safeModeReason || legDiag?.safeModeReason;
    if (legDiag?.recentErrors?.length) result.recentErrors = legDiag.recentErrors;

    log(`  __solshield walletNames: [${result.walletNames.join(', ') || '(empty)'}]`);
    log(`  __solshield walletStandardWallets count: ${result.walletStandardWallets}`);
    log(`  legacyHooks: ${JSON.stringify(result.legacyHooks)}`);
    log(`  errors: ${result.errors}, safeMode: ${result.safeMode}`);
    log(`  page __wallets__ (standard fixture): ${JSON.stringify(result.standard.wallets || [])}`);
    if (result.legacy.probe) {
      const populated = Object.entries(result.legacy.probe)
        .filter(([, v]) => v != null)
        .map(([k, v]) => k + (v.sub && Object.keys(v.sub).length ? '{' + Object.keys(v.sub).join(',') + '}' : ''));
      log(`  legacy globals populated: [${populated.join(', ') || '(none)'}]`);
    }
    if (result.recentErrors?.length) {
      for (const e of result.recentErrors) log(`  ERR[${e.phase}]: ${e.message}`);
    }
  } finally {
    await context.close().catch(() => {});
  }

  return result;
}

function gradeWallet(r) {
  const wsWrap = r.walletStandardWallets > 0 || (r.standard?.wallets?.length ?? 0) > 0;
  // legacy wrap: for now we have only legacyPhantom / legacySolflare flags;
  // for other wallets we infer presence from legacy probe + lack of error.
  const matchedLegacy = (r.legacyHooks?.windowSolana || r.legacyHooks?.phantom ||
                         r.legacyHooks?.solflare) === true;
  const populatedGlobals = r.legacy?.probe
    ? Object.entries(r.legacy.probe).filter(([, v]) => v != null && v.type === 'object').map(([k]) => k)
    : [];
  const legacyExposed = populatedGlobals.length > 0;
  // walletNames includes the wallet name (case-insensitive substring match
  // against expectName).
  const detected = r.walletNames.some((n) =>
    typeof n === 'string' && n.toLowerCase().includes((r.expectName || '').toLowerCase())
  );
  return {
    wsWrap,
    legacyWrap: matchedLegacy,
    legacyExposed,
    populatedGlobals,
    detected,
    pass: (wsWrap || legacyExposed) && r.errors === 0 && !r.safeMode,
  };
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  log('SolShield  :', SOLSHIELD_PATH);
  log('wallets dir:', REAL_WALLETS_DIR);

  const { server, baseUrl } = await startFixtureServer();
  log('fixtures   :', baseUrl);

  const results = [];
  for (const w of WALLETS) {
    try {
      results.push(await testOneWallet(w, baseUrl));
    } catch (e) {
      log(`  ${w.name} threw: ${e.message}`);
      results.push({ wallet: w.name, error: e.message });
    }
  }

  log('\n\n=========== COVERAGE MATRIX ===========');
  // | Wallet | wallet-standard wrap | legacy wrap | overlay shows | popup blocked | notes |
  log('| Wallet      | ws-wrap | legacy-wrap | legacy-exposed | detected-name | errors | notes |');
  log('|-------------|---------|-------------|----------------|---------------|--------|-------|');
  for (const r of results) {
    if (r.skipped) {
      log(`| ${r.wallet.padEnd(11)} | SKIP    | SKIP        | SKIP           | SKIP          | -      | ${r.reason} |`);
      continue;
    }
    if (r.error) {
      log(`| ${r.wallet.padEnd(11)} | ERR     | ERR         | ERR            | ERR           | -      | ${r.error} |`);
      continue;
    }
    const g = gradeWallet(r);
    log(
      `| ${r.wallet.padEnd(11)} | ${g.wsWrap ? 'PASS   ' : 'FAIL   '} | ` +
      `${g.legacyWrap ? 'PASS       ' : 'no         '} | ` +
      `${g.legacyExposed ? 'YES           ' : 'no            '} | ` +
      `${g.detected ? 'YES          ' : 'no           '} | ` +
      `${String(r.errors).padEnd(6)} | ` +
      `${(g.populatedGlobals.length ? 'globals=' + g.populatedGlobals.join(',') : '')}` +
      `${r.safeMode ? ' SAFE-MODE:' + r.safeModeReason : ''} |`,
    );
  }

  log('\n=========== PER-WALLET DIAGNOSTIC ===========');
  for (const r of results) {
    if (r.skipped || r.error) continue;
    const g = gradeWallet(r);
    log(`\n${r.wallet}:`);
    log(`  ws-wrap: ${g.wsWrap ? 'YES (count=' + r.walletStandardWallets + ')' : 'NO'}`);
    log(`  legacy: hooks=${JSON.stringify(r.legacyHooks)} exposed=${g.populatedGlobals.join(',') || 'none'}`);
    log(`  detected name: ${g.detected ? 'YES' : 'NO'} (walletNames=[${r.walletNames.join(', ')}])`);
    if (r.standard?.wallets?.length) {
      log(`  standard fixture wallets: ${JSON.stringify(r.standard.wallets)}`);
    }
    if (r.legacy?.probe) {
      const populated = Object.entries(r.legacy.probe).filter(([, v]) => v != null);
      for (const [k, v] of populated) {
        if (v.sub && Object.keys(v.sub).length) {
          log(`    window.${k}: keys=[${(v.keys || []).slice(0,8).join(',')}] flags=[${Object.entries(v.sub).map(([sk,st]) => sk+':'+st).join(',')}]`);
        }
      }
    }
    if (r.recentErrors?.length) {
      for (const e of r.recentErrors) log(`  ERR[${e.phase}] ${e.message}`);
    }
  }

  server.close();

  const fails = results.filter((r) => !r.skipped && !r.error && !gradeWallet(r).pass);
  const passes = results.filter((r) => !r.skipped && !r.error && gradeWallet(r).pass);
  log(`\n\n${passes.length}/${results.length} wallets PASS coverage criteria; ${fails.length} FAIL.`);
  if (fails.length) {
    log('\nFAIL DETAILS:');
    for (const r of fails) {
      const g = gradeWallet(r);
      log(`  - ${r.wallet}: wsWrap=${g.wsWrap} legacyWrap=${g.legacyWrap} legacyExposed=${g.legacyExposed} detected=${g.detected} errors=${r.errors} safeMode=${r.safeMode}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  log('runner threw:', e.message);
  console.error(e);
  process.exit(2);
});
