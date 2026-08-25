#!/usr/bin/env node
//
// Turn on, and republish, a hat's Magic Mirror feed from the command line.
//
//   node scripts/publish-mirror-feed.mjs                    (dry run, default hat)
//   node scripts/publish-mirror-feed.mjs --write
//   node scripts/publish-mirror-feed.mjs --hat some-other-hat --write
//
// The app publishes this feed on its own — on every draw, and at most once
// every six hours on open. This script exists for the two cases the app cannot
// cover:
//
//   1. BOOTSTRAP. The mirror needs its URL before anybody has pressed "Turn on
//      the mirror feed" in the app, and the mirror is a wall display with no
//      keyboard. Running this once mints the secret and publishes the first
//      feed, so the URL can be pasted into the mirror's config.
//   2. REPAIR. If the feed ever goes stale because nobody has opened the app,
//      this refreshes it without anyone having to.
//
// Reads and writes through the Firebase CLI, whose project-owner login bypasses
// security rules — the same approach the bug-report and backfill scripts use.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';

import { buildMirrorFeed } from '../src/assets/javascript/mirrorFeed.js';

const PROJECT = 'meal-hat';
const DATABASE_URL = 'https://meal-hat-default-rtdb.firebaseio.com';
const WRITE = process.argv.includes('--write');

const hatArgIndex = process.argv.indexOf('--hat');
const HAT = hatArgIndex === -1 ? 'mattgrosso-gmail-com' : process.argv[hatArgIndex + 1];

if (!HAT) {
  console.error('--hat needs a hat name.');
  process.exit(1);
}

const fbGet = (path) => {
  const out = execFileSync(
    'firebase',
    ['database:get', path, '--project', PROJECT],
    { maxBuffer: 64 * 1024 * 1024 }
  ).toString();
  return JSON.parse(out || 'null');
};

const fbSet = (path, value) => {
  // database:set reads from stdin or a file; a file avoids any shell quoting
  // question about meal names with apostrophes in them.
  const tmp = `/tmp/meal-hat-mirror-${Date.now()}.json`;
  writeFileSync(tmp, JSON.stringify(value));
  try {
    execFileSync(
      'firebase',
      ['database:set', path, tmp, '--project', PROJECT, '--force'],
      { maxBuffer: 64 * 1024 * 1024 }
    );
  } finally {
    unlinkSync(tmp);
  }
};

// ── the secret ──────────────────────────────────────────────────────────────
// Reused if the hat already has one. Minting a fresh secret on every run would
// silently invalidate the URL already sitting in the mirror's config.
let secret = fbGet(`/${HAT}/mirrorFeedKey`);

if (typeof secret === 'string' && secret.length >= 16) {
  console.log(`${HAT}: feed already on.`);
} else {
  secret = randomBytes(16).toString('hex');
  console.log(`${HAT}: minting a new feed key.`);
  if (WRITE) fbSet(`/${HAT}/mirrorFeedKey`, secret);
}

// ── the feed ────────────────────────────────────────────────────────────────
const drawnMeals = fbGet(`/${HAT}/drawnMeals`);
const meals = fbGet(`/${HAT}/meals`);
const feed = buildMirrorFeed(drawnMeals, meals);

console.log(`\n${feed.upcoming.length} upcoming meal(s) in the window:`);
feed.upcoming.forEach((row) => console.log(`  ${row.assignedDate}  ${row.meal.name}`));

const url = `${DATABASE_URL}/mirrorFeed/${HAT}/${secret}.json`;

if (!WRITE) {
  console.log('\nDRY RUN — nothing written. Re-run with --write.');
  console.log(`Would publish to: ${url}`);
  process.exit(0);
}

fbSet(`/mirrorFeed/${HAT}/${secret}`, feed);

console.log(`\nPublished. Mirror feed URL:\n  ${url}`);
