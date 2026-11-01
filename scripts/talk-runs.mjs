#!/usr/bin/env node
//
// Read the kept talk-throughs and the corrections made to them, to find the
// misses that keep coming back and fix them in the reader's instructions
// (buildTranscriptPrompt in aws-lambda/perishable-vision.js).
//
//   yarn talk-runs                 the last 10 read-throughs, one line each
//   yarn talk-runs --last          the newest one in full
//   yarn talk-runs --run <id>      one in full
//   yarn talk-runs --lessons       every correction, newest first
//   --hat <name>                   another hat (default: Matt's own)
//
// "Lost by Meal Hat" is the column worth watching. Those are foods the READER
// heard and returned that never reached the report — the name matching
// dropped them — as opposed to a food the reader never heard at all, which
// only shows up as a correction. Telling those two apart is why runs are kept.
//
// Reads through the Firebase CLI, like fetch-bug-reports: its project-owner
// login bypasses the rules, so no service-account key. Needs `firebase login`.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PROJECT = 'meal-hat';
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const HAT = option('--hat') || 'mattgrosso-gmail-com';

async function read (path, extra = []) {
  try {
    const { stdout } = await run('firebase', ['database:get', path, '--project', PROJECT, ...extra], {
      maxBuffer: 64 * 1024 * 1024
    });
    return JSON.parse(stdout || 'null');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('The `firebase` CLI is not on PATH.');
    } else {
      console.error('Could not read. Is `firebase login` still valid?');
      console.error(String(error.stderr || error.message).trim());
    }
    process.exit(1);
  }
}

const norm = (name) => {
  const lower = String(name || '').trim().toLowerCase();
  return lower.endsWith('s') ? lower.slice(0, -1) : lower;
};
const list = (value) => Array.isArray(value) ? value.filter(Boolean) : Object.values(value || {});
const when = (iso) => iso ? new Date(iso).toLocaleString() : '?';

// Reader items whose food is nowhere in the report. A food the reader heard
// and Meal Hat then lost, which is a matching problem, not a hearing one.
function lostByMealHat (stored) {
  const report = stored.report || {};
  const reached = new Set([
    ...list(report.added).flatMap((row) => [row.name, row.readAs]),
    ...list(report.confirmed).map((row) => row.title)
  ].filter(Boolean).map(norm));
  return list(stored.reader?.items).filter((item) =>
    !reached.has(norm(item.name)) && !reached.has(norm(item.knownFoodMatch)));
}

function summary (id, stored) {
  const report = stored.report || {};
  const words = String(stored.transcript || '').trim().split(/\s+/).filter(Boolean).length;
  const lost = lostByMealHat(stored);
  const flagged = Object.keys(stored.flagged || {}).length;
  return `${id}  ${when(stored.at)}  ${words} words  ` +
    `reader: ${list(stored.reader?.items).length} items, ${list(stored.reader?.outOf).length} out of, ${list(stored.reader?.unclear).length} unclear  ` +
    `report: +${list(report.added).length} ✓${list(report.confirmed).length} −${list(report.removed).length}` +
    `${lost.length ? `  LOST BY MEAL HAT: ${lost.map((i) => i.name).join(', ')}` : ''}` +
    `${flagged ? `  flagged: ${flagged}` : ''}`;
}

async function detail (id) {
  const stored = await read(`/${HAT}/talk-runs/${id}`);
  if (!stored) {
    console.log(`No run ${id}.`);
    return;
  }
  // Lessons are a few short lines each; reading them all and filtering keeps
  // this off an unindexed server-side query.
  const lessons = list(await read(`/${HAT}/talk-lessons`)).filter((lesson) => lesson.runId === id);
  const report = stored.report || {};

  console.log(`\n${summary(id, stored)}\n`);
  console.log('WHAT HE SAID\n');
  console.log(stored.transcript || '(nothing kept)');
  console.log('\nWHAT THE READER RETURNED\n');
  list(stored.reader?.items).forEach((item) => {
    const match = item.knownFoodMatch ? ` [matched ${item.knownFoodMatch}]` : ' [no match]';
    console.log(`  + "${item.heard}" -> ${item.name} x${item.quantity} ${item.counted}${match}${item.perishable ? '' : ' (pantry)'}`);
  });
  list(stored.reader?.outOf).forEach((item) => console.log(`  - out of: "${item.heard}" -> ${item.name}`));
  list(stored.reader?.unclear).forEach((row) => console.log(`  ? "${row.heard}" — ${row.why}`));
  console.log('\nWHAT MEAL HAT DID\n');
  list(report.added).forEach((row) => console.log(`  added ${row.name}${row.readAs ? ` (reader said ${row.readAs})` : ''}`));
  list(report.confirmed).forEach((row) => console.log(`  already had ${row.title}${row.quantity ? `, now ${row.quantity}` : ''}`));
  list(report.removed).forEach((row) => console.log(`  removed ${row.title}${row.saidOutOf ? ' (said out of)' : ''}${stored.kept?.[row.id] ? ' — then put back with We have it' : ''}`));
  const lost = lostByMealHat(stored);
  if (lost.length) {
    console.log('\nLOST BY MEAL HAT (heard by the reader, never reached the report)\n');
    lost.forEach((item) => console.log(`  "${item.heard}" -> ${item.name}`));
  }
  if (lessons.length) {
    console.log('\nCORRECTIONS\n');
    lessons.forEach((lesson) => console.log(`  ${lesson.kind}: ${lesson.heard ? `"${lesson.heard}" ` : ''}${lesson.readAs ? `read as ${lesson.readAs} ` : ''}${lesson.said ? `— ${lesson.said}` : ''}`));
  }
  console.log('');
}

if (flag('--lessons')) {
  const lessons = list(await read(`/${HAT}/talk-lessons`))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!lessons.length) console.log('No corrections yet.');
  lessons.forEach((lesson) => console.log(
    `${when(lesson.at)}  ${lesson.kind}  ${lesson.heard ? `"${lesson.heard}" ` : ''}${lesson.readAs ? `read as ${lesson.readAs} ` : ''}${lesson.said ? `— ${lesson.said}` : ''}`
  ));
} else if (option('--run')) {
  await detail(option('--run'));
} else {
  const runs = await read(`/${HAT}/talk-runs`, ['--order-by-key', '--limit-to-last', flag('--last') ? '1' : '10']);
  const entries = Object.entries(runs || {}).reverse();
  if (!entries.length) {
    console.log('No read-throughs kept yet.');
  } else if (flag('--last')) {
    await detail(entries[0][0]);
  } else {
    entries.forEach(([id, stored]) => console.log(summary(id, stored)));
  }
}
