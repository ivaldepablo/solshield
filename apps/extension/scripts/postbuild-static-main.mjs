/**
 * Plasmo registers MAIN-world content scripts dynamically via
 * chrome.scripting.registerContentScripts from the background SW. That loses
 * the document_start race against statically-registered MAIN-world scripts
 * (like real Phantom). This step:
 *   1. Adds provider-hook to manifest.content_scripts as STATIC main-world.
 *   2. Neuters the dynamic registerContentScripts call in the SW so we
 *      don't get a duplicate registration that races us.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
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
    all_frames: false,
    match_about_blank: false,
  });
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`postbuild: added ${providerHook} as static MAIN-world content script`);

// Find and neuter the chrome.scripting.registerContentScripts call.
// The earlier regex approach failed because the inner array has nested parens.
// Use a parenthesis-balanced match: scan from "chrome.scripting.registerContentScripts(" forward,
// counting parens, find the matching close, then continue past `.catch(...)`.
const SW = resolve(BUILD, 'static', 'background', 'index.js');
if (!existsSync(SW)) {
  console.error('postbuild: SW not found, expected at', SW);
  process.exit(1);
}

let sw = readFileSync(SW, 'utf8');
const target = 'chrome.scripting.registerContentScripts(';
const start = sw.indexOf(target);
if (start === -1) {
  console.log('postbuild: no registerContentScripts found in SW (good — Plasmo may have changed)');
} else {
  // Parse balanced parens from `start + target.length`
  let depth = 1;
  let i = start + target.length;
  while (i < sw.length && depth > 0) {
    const c = sw[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    i++;
  }
  if (depth !== 0) {
    console.error('postbuild: unbalanced parens in SW. Refusing to ship.');
    process.exit(1);
  }
  // Now skip an optional `.catch(...)`
  if (sw.slice(i, i + 7) === '.catch(') {
    let cd = 1;
    i += 7;
    while (i < sw.length && cd > 0) {
      const c = sw[i];
      if (c === '(') cd++;
      else if (c === ')') cd--;
      i++;
    }
    if (cd !== 0) {
      console.error('postbuild: unbalanced parens in .catch() — refusing to ship.');
      process.exit(1);
    }
  }
  // Replace [start..i] with a no-op of the same length-ish. Use `void 0` plus enough chars.
  const replacement = 'void 0';
  sw = sw.slice(0, start) + replacement + sw.slice(i);
  writeFileSync(SW, sw);
  console.log('postbuild: neutered dynamic registerContentScripts in SW');
}

// Sanity check: provider-hook is now in manifest, dynamic call is gone.
const finalManifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const hasMain = finalManifest.content_scripts.some(
  (cs) => cs.world === 'MAIN' && cs.js?.includes(providerHook),
);
const finalSw = readFileSync(SW, 'utf8');
if (!hasMain) {
  console.error('postbuild VERIFY FAILED: no MAIN-world entry in manifest');
  process.exit(1);
}
if (finalSw.includes('chrome.scripting.registerContentScripts(')) {
  console.error('postbuild VERIFY FAILED: registerContentScripts still in SW');
  process.exit(1);
}
console.log('postbuild: verified — MAIN script is static, dynamic call neutered');
