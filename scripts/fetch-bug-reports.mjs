#!/usr/bin/env node
//
// Show in-app bug reports, newest first.
//
//   yarn fetch-bug-reports          unresolved only
//   yarn fetch-bug-reports --all    everything, resolved included
//
// Mark one done with `yarn resolve-bug-report <id>`.
//
// Reads through the Firebase CLI rather than the Admin SDK. The `bugReports`
// node is write-only under the security rules, so reading it needs credentials
// that bypass them — the CLI's own project-owner login does, which means no
// service-account key to generate, store or keep out of git. Verified: the CLI
// reads paths that return 401 to every client.
//
// The tradeoff is that this depends on `firebase login` still being valid. If
// it lapses the command says so rather than failing obscurely.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const PROJECT = 'meal-hat';
const showAll = process.argv.includes('--all');

async function readBugReports () {
  try {
    const { stdout } = await run('firebase', ['database:get', '/bugReports', '--project', PROJECT], {
      maxBuffer: 32 * 1024 * 1024
    });
    return JSON.parse(stdout || 'null');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('The `firebase` CLI is not on PATH. Install it, or run via a shell that has it.');
    } else {
      console.error('Could not read bug reports. Is `firebase login` still valid?');
      console.error(String(error.stderr || error.message).trim());
    }
    process.exit(1);
  }
}

const data = await readBugReports();

if (!data) {
  console.log('No bug reports yet.');
  process.exit(0);
}

const all = Object.entries(data);
const resolvedCount = all.filter(([, report]) => report && report.resolved).length;
const entries = showAll ? all : all.filter(([, report]) => report && !report.resolved);

// Newest first. createdAt is a server timestamp (a number); a report that was
// stashed offline and re-stamped still has one, but fall back to
// clientCreatedAt so a malformed row sorts somewhere sane instead of throwing.
entries.sort((a, b) => (b[1]?.createdAt || b[1]?.clientCreatedAt || 0) - (a[1]?.createdAt || a[1]?.clientCreatedAt || 0));

if (!entries.length) {
  console.log(`No unresolved bug reports (${resolvedCount} resolved — rerun with --all to see them).`);
  process.exit(0);
}

for (const [id, report] of entries) {
  const stamp = report.createdAt || report.clientCreatedAt;
  const when = stamp ? new Date(stamp).toLocaleString() : 'unknown time';

  console.log('');
  console.log('─'.repeat(72));
  console.log(`report ${id} — ${when}${report.resolved ? '  [RESOLVED]' : ''}`);
  if (report.queuedOffline) console.log('filed offline, sent later');
  console.log(`from ${report.reporterEmail || 'unknown'}`);
  console.log('');
  console.log(report.transcript || '(no text)');

  if (report.appState) {
    try {
      const state = JSON.parse(report.appState);
      console.log('');
      console.log(Object.entries(state).map(([k, v]) => `  ${k}: ${v}`).join('\n'));
    } catch {
      console.log(`\n  appState (unparseable): ${report.appState}`);
    }
  }

  console.log(`\n  ${report.screenSize || '?'} @${report.devicePixelRatio || '?'}x — ${report.userAgent || 'unknown UA'}`);
}

console.log('');
console.log('─'.repeat(72));
console.log(
  `${entries.length} report(s) shown` +
  (showAll ? '' : ` (${resolvedCount} resolved hidden — rerun with --all)`)
);
