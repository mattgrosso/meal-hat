// Marks a bug report resolved AND tells the reporter, in plain language,
// what was wrong and what changed. The notice lands at
// `bugReportResolutions/<reporterUid>/<reportId>`, where the app shows it on
// the reporter's next launch (src/utils/bugResolutions.js). Pattern ported from
// Cinema Roll (Matt, 2026-09-21).
//
//   yarn resolve-bug-report <reportId> --understood "..." --fixed "..."
//   yarn resolve-bug-report <id> [id...] --silent      # no notice
//
// Write the two texts for a smart 12-year-old: no jargon, no file names.
// The reporter sees exactly these words. --silent is for duplicates, QA
// noise and self-filed reports; resolving without choosing is refused.
//
// Uses the Firebase CLI (`firebase login`), like fetch-bug-reports.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PROJECT = 'meal-hat';
const APP = 'meal-hat';
const REPORTS = '/bugReports';
const RESOLUTIONS = '/bugReportResolutions';

const args = process.argv.slice(2);
const ids = [];
let understood = null;
let fixed = null;
let silent = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--understood') understood = args[++i] ?? null;
  else if (args[i] === '--fixed') fixed = args[++i] ?? null;
  else if (args[i] === '--silent') silent = true;
  else if (args[i].startsWith('--')) { console.error(`Unknown flag ${args[i]}`); process.exit(1); }
  else ids.push(args[i]);
}
const usage = () => {
  console.error('Usage: yarn resolve-bug-report <reportId> --understood "..." --fixed "..."');
  console.error('       yarn resolve-bug-report <reportId> [reportId...] --silent');
  process.exit(1);
};
if (!ids.length) usage();
if (!silent && (!understood?.trim() || !fixed?.trim())) {
  console.error('Refusing to resolve without telling the reporter what happened.');
  usage();
}
if (!silent && ids.length > 1) {
  console.error('A notice describes ONE report - resolve them one at a time, or pass --silent.');
  process.exit(1);
}

const fb = (...a) => run('firebase', [...a, '--project', PROJECT]);
const emailToMemberKey = (email) => (typeof email === 'string' && email
  ? ['.', '$', '#', '[', ']', '/'].reduce((key, c) => key.split(c).join('-'), email.trim().toLowerCase())
  : null);
const snippetOf = (text, limit = 280) => {
  const t = (text || '').trim();
  return t.length <= limit ? t : `${t.slice(0, limit - 1).trimEnd()}…`;
};

for (const id of ids) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) { console.error(`skipped ${id} - not a valid report id`); continue; }
  try {
    const { stdout } = await fb('database:get', `${REPORTS}/${id}`);
    const report = JSON.parse(stdout || 'null');
    if (!report) { console.error(`No report found with id ${id} - skipping.`); continue; }
    const resolvedAt = Date.now();
    const change = { resolved: true, resolvedAt };
    if (!silent) change.resolution = { understood, fixed };
    await fb('database:update', `${REPORTS}/${id}`, '--data', JSON.stringify(change), '--force');
    console.log(`Marked ${id} resolved.`);
    if (silent) continue;
    // Reports carry the reporter's email, not a uid; the notice is keyed by
    // the same email transform the rules apply to auth.token.email.
    const memberKey = emailToMemberKey(report.reporterEmail);
    if (!memberKey) {
      console.warn(`  ! ${id} has no reporter email - resolved, but there is nobody to notify.`);
      continue;
    }
    const notice = {
      app: APP, understood, fixed, reportSnippet: snippetOf(report.transcript), reportedAt: report.createdAt || null, resolvedAt, seen: false,
    };
    await fb('database:set', `${RESOLUTIONS}/${memberKey}/${id}`, '--data', JSON.stringify(notice), '--force');
    console.log("  Notice queued - they'll see it on their next launch.");
  } catch (error) {
    console.error(`Failed to resolve ${id}: ${String(error.stderr || error.message).trim()}`);
  }
}
process.exit(0);
