#!/usr/bin/env node
//
// One-time: give every existing hat a joinCode and a members list, so that
// tightening the security rules cannot lock anybody out.
//
//   node scripts/backfill-hat-membership.mjs --dry-run   (default: prints only)
//   node scripts/backfill-hat-membership.mjs --write
//
// MUST run, and be verified, BEFORE the membership rules are deployed. After
// the rules land, a user who is not in a hat's members list cannot read it and
// cannot add themselves without the joinCode — which is the entire point, and
// also exactly why the grandfathering has to be complete first.
//
// Membership is keyed by Firebase Auth **uid**, not by the email-derived
// database key: rules can test `auth.uid`, and they have no way to apply the
// app's punctuation-stripping to an email to reconstruct a key.
//
// Who belongs to a hat is derived from two sources, unioned:
//   1. every user whose own `meal-hats-list` names that hat
//   2. the user whose email maps to the hat key (their own default hat), even
//      if their list somehow omits it
//
// Reads and writes through the Firebase CLI, whose project-owner login bypasses
// security rules — the same approach the bug-report scripts use.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';

const PROJECT = 'meal-hat';
const WRITE = process.argv.includes('--write');

const fb = (args, { json = true } = {}) => {
  const out = execFileSync('firebase', [...args, '--project', PROJECT], { maxBuffer: 64 * 1024 * 1024 }).toString();
  return json ? JSON.parse(out || 'null') : out;
};

// The app's own key derivation, copied so this script agrees with it exactly.
const emailToKey = (email) => email.replaceAll(/[-!$%@^&*()_+|~=`{}[\]:";'<>?,./]/g, '-');

// ── auth: email -> uid ──────────────────────────────────────────────────────
const tmp = `/tmp/meal-hat-auth-${Date.now()}.json`;
execFileSync('firebase', ['auth:export', tmp, '--format=json', '--project', PROJECT]);
const authUsers = JSON.parse(readFileSync(tmp)).users || [];
unlinkSync(tmp);

const uidByKey = new Map();
const emailByUid = new Map();
authUsers.forEach((u) => {
  if (u.email) {
    uidByKey.set(emailToKey(u.email), u.localId);
    emailByUid.set(u.localId, u.email);
  }
});

// ── the sharing graph ───────────────────────────────────────────────────────
const roots = Object.keys(fb(['database:get', '/', '--shallow']) || {});

const membersByHat = new Map();
const add = (hat, uid, why) => {
  if (!uid) return;
  if (!membersByHat.has(hat)) membersByHat.set(hat, new Map());
  if (!membersByHat.get(hat).has(uid)) membersByHat.get(hat).set(uid, why);
};

for (const key of roots) {
  // A user's own hat is theirs, list or no list.
  add(key, uidByKey.get(key), 'own hat');

  let list = null;
  try {
    list = fb(['database:get', `/${key}/meal-hats-list`]);
  } catch { /* not an account node, or no list */ }

  const hats = Array.isArray(list) ? list : (list ? Object.values(list) : []);
  hats.filter(Boolean).forEach((hat) => add(hat, uidByKey.get(key), `listed by ${key}`));
}

// ── report, then optionally write ───────────────────────────────────────────
const existing = new Set(roots);
let planned = 0;
const orphanHats = [];

console.log(`${roots.length} top-level keys, ${authUsers.length} auth accounts\n`);

for (const [hat, members] of [...membersByHat].sort()) {
  if (!existing.has(hat)) { orphanHats.push(hat); continue; }
  console.log(`${hat}  (${members.size} member${members.size === 1 ? '' : 's'})`);
  for (const [uid, why] of members) console.log(`    ${uid}   ${why}`);
  planned += 1;
}

// A hat someone lists that does not exist yet is not an error — they can create
// it — but it must not be given members, or a stranger inherits them.
if (orphanHats.length) console.log(`\nlisted but non-existent, skipped: ${orphanHats.join(', ')}`);

// Existing keys nobody claims. Left completely alone: writing members would be
// guessing, and a hat with no members is unreadable rather than open.
const unclaimed = roots.filter((r) => !membersByHat.has(r));
if (unclaimed.length) console.log(`\nno owner found, NOT touched: ${unclaimed.join(', ')}`);

if (!WRITE) {
  console.log(`\nDry run. ${planned} hat(s) would be updated. Re-run with --write.`);
  process.exit(0);
}

for (const [hat, members] of membersByHat) {
  if (!existing.has(hat)) continue;

  const current = fb(['database:get', `/${hat}/joinCode`]);
  // Never regenerate an existing code — that would invalidate links already
  // shared with people.
  const joinCode = current || randomBytes(9).toString('base64url');

  const payload = { joinCode, members: {} };
  // email is a label for the members roster in the app — rules key on uid.
  for (const uid of members.keys()) {
    payload.members[uid] = { joined: true, code: joinCode, email: emailByUid.get(uid) || null };
  }

  execFileSync('firebase', [
    'database:update', `/${hat}`, '-d', JSON.stringify(payload), '--project', PROJECT, '-f'
  ]);
  console.log(`updated ${hat} (${members.size} member(s))`);
}

console.log('\nDone. Verify before deploying the membership rules.');
