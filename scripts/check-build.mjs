#!/usr/bin/env node
//
// Run by `yarn deploy` between the build and the upload. Reads dist/ and stops
// the deploy if the build would quietly switch auto-update off.
//
//   node scripts/check-build.mjs            (checks ./dist)
//
// Each of these used to be a by-hand step in CLAUDE.md ("after any build,
// check the worker"), and every one of them fails SILENTLY in production: the
// app looks healthy and deploys simply never reach an open phone or the
// kitchen wall.
//
//  1. The worker is service-worker.js. That is what registerServiceWorker.js
//     registers and what every installed phone checks for updates at; the
//     vite-plugin-pwa default sw.js would strand them on the old worker.
//  2. It precaches exactly one entry, /index.html, WITH a revision. That
//     revision is what makes the worker's bytes change between builds; an
//     empty manifest produces an identical worker every time, and a wider one
//     brings back the 2026-08-19 install race.
//  3. index.html loads js/app.<hex>.js, the name appUpdate.js's
//     ENTRY_BUNDLE_PATTERN looks for, and that file is in dist/. Rollup's
//     default base64 hash alphabet would never match it.

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Stricter than ENTRY_BUNDLE_PATTERN on purpose: that one accepts any
// lowercase alphanumeric, so a build that drifts off hex still has to be
// caught here, before it ships, rather than by a pattern loose enough to pass.
const HEX_ENTRY_BUNDLE = /js\/app\.[0-9a-f]+\.js/;

/** Every problem with the build in `dist`, as plain sentences. Empty = ship it. */
export function checkBuild (dist) {
  const problems = [];
  const read = (name) => (existsSync(join(dist, name)) ? readFileSync(join(dist, name), 'utf8') : null);

  const worker = read('service-worker.js');
  if (worker === null) {
    problems.push('dist/service-worker.js is missing. Installed phones check that exact name for updates.');
  } else {
    const match = worker.match(/precacheAndRoute\((\[[\s\S]*?\])/);
    if (!match) {
      problems.push('service-worker.js has no precacheAndRoute() call, so it will not change between builds.');
    } else {
      let entries = null;
      try {
        // The minified manifest is a JS literal with bare keys.
        entries = JSON.parse(match[1].replace(/([{,])\s*([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":'));
      } catch {
        problems.push(`Could not read the precache list in service-worker.js: ${match[1].slice(0, 200)}`);
      }
      if (entries) {
        const urls = entries.map((e) => (typeof e === 'string' ? e : e && e.url));
        if (entries.length !== 1 || urls[0] !== '/index.html') {
          problems.push(`service-worker.js must precache exactly /index.html, and it precaches: ${urls.join(', ') || 'nothing'}.`);
        } else if (!entries[0] || typeof entries[0] !== 'object' || !entries[0].revision) {
          problems.push('service-worker.js precaches /index.html with no revision, so the worker will come out the same every build.');
        }
      }
    }
  }
  if (existsSync(join(dist, 'sw.js'))) {
    problems.push('dist/sw.js exists. The worker must be service-worker.js; nothing registers sw.js.');
  }

  const html = read('index.html');
  if (html === null) {
    problems.push('dist/index.html is missing.');
  } else {
    const bundle = html.match(HEX_ENTRY_BUNDLE)?.[0];
    if (!bundle) {
      problems.push('index.html loads no js/app.<hex>.js bundle, which is the name auto-update compares.');
    } else if (!existsSync(join(dist, bundle))) {
      problems.push(`index.html loads ${bundle}, which is not in dist/.`);
    }
  }

  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(process.argv[2] || 'dist');
  const problems = checkBuild(dist);
  if (problems.length) {
    console.error('\n✗ The build would break auto-update. Nothing was uploaded.\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('');
    process.exit(1);
  }
  console.log('✓ Build checked: service-worker.js precaches /index.html with a revision, and the app bundle name matches auto-update.');
}
