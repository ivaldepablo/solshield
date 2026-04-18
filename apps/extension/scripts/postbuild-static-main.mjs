/**
 * Plasmo registers MAIN-world content scripts dynamically via
 * chrome.scripting.registerContentScripts from the background SW. That loses
 * the document_start race against statically-registered MAIN-world scripts
 * (like real Phantom).
 *
 * This post-build step rewrites the manifest to include provider-hook as a
 * STATIC content script, so we win the race on cold-loaded tabs. We also
 * neuter the dynamic registration so it doesn't fight the static one.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BUILD = resolve(process.cwd(), 'build', 'chrome-mv3-prod');
const MANIFEST = resolve(BUILD, 'manifest.json');

const files = readdirSync(BUILD);
const providerHook = files.find((f) => f.startsWith('provider-hook') && f.endsWith('.js'));
if (!providerHook) {
  console.error('postbuild: provider-hook bundle not found in build/');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.content_scripts ||= [];

const already = manifest.content_scripts.some((cs) => cs.js?.[0] === providerHook);
if (!already) {
  manifest.content_scripts.unshift({
    matches: ['<all_urls>'],
    js: [providerHook],
    world: 'MAIN',
    run_at: 'document_start',
    all_frames: true,
  });
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`postbuild: added ${providerHook} as static MAIN-world content script`);

// Neuter the dynamic registration so it doesn't try to register the same
// script ID again (which would no-op but spam errors). We replace the
// registerContentScripts call with a no-op.
import { existsSync } from 'node:fs';
const SW = resolve(BUILD, 'static', 'background', 'index.js');
if (existsSync(SW)) {
  let sw = readFileSync(SW, 'utf8');
  // Match: chrome.scripting.registerContentScripts([{...}]).catch(...)
  const before = sw.length;
  sw = sw.replace(/chrome\.scripting\.registerContentScripts\([^)]*\)\.catch\([^)]*\)/g, '0');
  if (sw.length !== before) {
    writeFileSync(SW, sw);
    console.log('postbuild: neutered dynamic registerContentScripts in SW');
  }
}
