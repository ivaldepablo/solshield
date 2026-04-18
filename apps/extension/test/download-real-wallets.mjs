/**
 * Download REAL wallet CRX files from the Chrome Web Store.
 *
 * Each CRX is a small CRX3 header (12 bytes magic + uint32 LE version +
 * uint32 LE header_size) followed by a protobuf header of `header_size`
 * bytes, followed by a regular ZIP. We strip the CRX header and unzip the
 * payload into apps/extension/test/real-wallets/<name>/.
 *
 * Usage:
 *   node apps/extension/test/download-real-wallets.mjs
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, 'real-wallets');

const log = (...m) => process.stdout.write('[dl-wallets] ' + m.join(' ') + '\n');

const WALLETS = [
  { name: 'phantom', id: 'bfnaelmomeimhlpmgjnjophhpkkoljpa' },
  { name: 'solflare', id: 'bhhhlbepdkbapadjdnnojkbgioiodbic' },
  { name: 'backpack', id: 'aflkmfhebedbjioipglgcbcmnbpgliof' },
  // v0.4.4 multi-wallet coverage matrix:
  { name: 'glow', id: 'ojbcfhjmpigfobfclfflafhblgemeidi' },
  { name: 'trust', id: 'egjidjbpglichdcondbcbdnbeeppgdph' },
  { name: 'coinbase', id: 'hnfanknocfeofbddgcijnmhnfnkdnaad' },
  { name: 'mathwallet', id: 'afbcbjpbpfadlkmhmclhkeeodmamcflc' },
  { name: 'coin98', id: 'aeachknmefphepccionboohckonoeemg' },
  // Brave Wallet ships built-in with the Brave browser; there is no CWS CRX.
];

const CRX_URL = (id) =>
  `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0.0.0&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;

/**
 * Strip the CRX3 header from a CRX file and write the inner ZIP.
 * Layout:
 *   bytes 0..3   = "Cr24"
 *   bytes 4..7   = version (uint32 LE) — always 3 for crx3
 *   bytes 8..11  = header_size (uint32 LE)
 *   bytes 12..(12 + header_size - 1) = protobuf header (signatures etc)
 *   bytes (12 + header_size)..end = ZIP payload
 */
function extractCrx(crxPath, zipPath) {
  const buf = readFileSync(crxPath);
  if (buf.length < 16) throw new Error('crx too short: ' + buf.length);
  const magic = buf.subarray(0, 4).toString('ascii');
  if (magic !== 'Cr24') throw new Error('bad magic: ' + magic);
  const version = buf.readUInt32LE(4);
  if (version !== 3 && version !== 2) throw new Error('unsupported crx version ' + version);
  let zipStart;
  if (version === 3) {
    const headerSize = buf.readUInt32LE(8);
    zipStart = 12 + headerSize;
  } else {
    // crx2: 4 magic + 4 version + 4 pubKeyLen + 4 sigLen + pubkey + sig
    const pubKeyLen = buf.readUInt32LE(8);
    const sigLen = buf.readUInt32LE(12);
    zipStart = 16 + pubKeyLen + sigLen;
  }
  const zip = buf.subarray(zipStart);
  // Sanity-check: ZIP local file header magic is 0x04034b50 (PK\x03\x04).
  if (zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) {
    throw new Error(
      'zip magic missing at offset ' + zipStart + ' got ' + zip.subarray(0, 4).toString('hex'),
    );
  }
  writeFileSync(zipPath, zip);
  return { zipStart, zipBytes: zip.length, version };
}

function downloadOne(wallet) {
  const crxPath = resolve(OUT_DIR, wallet.name + '.crx');
  const zipPath = resolve(OUT_DIR, wallet.name + '.zip');
  const extractDir = resolve(OUT_DIR, wallet.name);

  // SKIP_EXISTING=1 (default) keeps already-extracted wallets; FORCE=1 redownloads.
  const skipExisting = process.env.FORCE !== '1';
  if (existsSync(extractDir)) {
    if (skipExisting && existsSync(resolve(extractDir, 'manifest.json'))) {
      log(wallet.name, 'already extracted at', extractDir, '— skipping (FORCE=1 to redownload)');
      const raw = readFileSync(resolve(extractDir, 'manifest.json'), 'utf8');
      let manifest;
      try { manifest = JSON.parse(raw); }
      catch { manifest = { name: '?', version: '?' }; }
      return { wallet: wallet.name, name: manifest.name, version: manifest.version, dir: extractDir, skipped: true };
    }
    log(wallet.name, 'already extracted, removing for fresh download');
    rmSync(extractDir, { recursive: true, force: true });
  }

  log(wallet.name, 'downloading from CWS...');
  // -L follows redirects, -A sets a chrome user-agent because the CWS
  // sometimes refuses curl's default UA.
  execSync(
    `curl -sSL -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' -o '${crxPath}' '${CRX_URL(wallet.id)}'`,
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );

  const sz = readFileSync(crxPath).length;
  log(wallet.name, 'crx size:', sz, 'bytes');
  if (sz < 1024) {
    throw new Error(wallet.name + ' crx looks tiny — CWS likely returned an error page');
  }

  const meta = extractCrx(crxPath, zipPath);
  log(wallet.name, 'crx v' + meta.version, 'zip starts @', meta.zipStart, 'zip size:', meta.zipBytes);

  mkdirSync(extractDir, { recursive: true });
  // -o to overwrite, -q quiet
  execSync(`unzip -o -q '${zipPath}' -d '${extractDir}'`, { stdio: ['ignore', 'pipe', 'inherit'] });

  // Validate manifest
  const manifestPath = resolve(extractDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    // Some wallets pack manifest in a sub-dir; look one level deeper.
    log(wallet.name, 'manifest.json not at root — searching one level deep');
    const subdirs = execSync(`ls '${extractDir}'`).toString().split('\n').filter(Boolean);
    log(wallet.name, 'extracted entries:', subdirs.join(', '));
    throw new Error(wallet.name + ' manifest.json missing in ' + extractDir);
  }
  const raw = readFileSync(manifestPath, 'utf8');
  // Some wallets ship manifest.json with trailing commas / comments — best-effort parse.
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    // try stripping comments
    const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    try {
      manifest = JSON.parse(stripped);
    } catch (e2) {
      log(wallet.name, 'manifest.json parse failed:', e.message);
      manifest = { name: '<unparseable>', version: '<unparseable>' };
    }
  }
  log(
    wallet.name,
    'OK ✓ manifest:',
    'name="' + (manifest.name || manifest.short_name || '?') + '"',
    'version=' + (manifest.version || '?'),
    'mv=' + (manifest.manifest_version || '?'),
  );
  return { wallet: wallet.name, name: manifest.name, version: manifest.version, dir: extractDir };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  log('output dir:', OUT_DIR);

  const results = [];
  for (const w of WALLETS) {
    try {
      results.push(downloadOne(w));
    } catch (e) {
      log(w.name, 'FAILED:', e.message);
      results.push({ wallet: w.name, error: e.message });
    }
  }

  log('\n=== SUMMARY ===');
  for (const r of results) {
    if (r.error) log('  ✗', r.wallet, '—', r.error);
    else log('  ✓', r.wallet.padEnd(10), r.name, 'v' + r.version, '→', r.dir);
  }
  const ok = results.filter((r) => !r.error).length;
  process.exit(ok === results.length ? 0 : 1);
}

main();
