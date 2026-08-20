#!/usr/bin/env node
//
// Mark one or more bug reports resolved.
//
//   yarn resolve-bug-report <id> [<id>…]
//
// Ids come from `yarn fetch-bug-reports`. Resolved reports are hidden from that
// listing unless you pass --all; nothing is deleted.
//
// Writes through the Firebase CLI for the same reason the fetch script reads
// through it — see the note there.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const PROJECT = 'meal-hat';
// Filter on '--', NOT '-'. Every Firebase push key starts with a hyphen
// ("-P-Rh_RSEksCgkxaNZdr"), so treating a single leading dash as a flag threw
// away every real id and left the script permanently unusable.
const ids = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

if (!ids.length) {
  console.error('Usage: yarn resolve-bug-report <id> [<id>…]');
  console.error('Get ids from `yarn fetch-bug-reports`.');
  process.exit(1);
}

let failed = 0;

for (const id of ids) {
  // Reject anything that isn't a plain push key rather than interpolating it
  // into a database path. These come off a terminal, and a stray "/" or ".."
  // would write somewhere else entirely.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    console.error(`skipped ${id} — not a valid report id`);
    failed += 1;
    continue;
  }

  try {
    // `database:update` merges, so this sets `resolved` without disturbing the
    // transcript or the snapshot. -f skips the confirmation prompt, which would
    // otherwise hang a non-interactive run.
    await run('firebase', [
      'database:update', `/bugReports/${id}`, '-d', JSON.stringify({ resolved: true }), '--project', PROJECT, '-f'
    ]);
    console.log(`resolved ${id}`);
  } catch (error) {
    console.error(`could not resolve ${id}: ${String(error.stderr || error.message).trim()}`);
    failed += 1;
  }
}

process.exit(failed ? 1 : 0);
