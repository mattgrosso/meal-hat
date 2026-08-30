// Clear every timer in the fridge, so the house can be re-photographed from
// scratch and the dates start honest.
//
//   node scripts/reset-fridge.mjs           # dry run: lists what would go
//   node scripts/reset-fridge.mjs --apply   # backs up, then deletes
//
// TIMERS ONLY. Templates and the catalog's shelf lives are the accumulated
// knowledge — 58 foods the house has taught this app how long they last — and
// they are what makes the re-scan fast: every template match arrives with its
// duration already filled in, so re-photographing the fridge is a few taps
// rather than forty manual answers. Wiping them would throw that away to fix
// a problem they are not part of.
//
// The change log is left alone too. It is bounded, it is the only record of
// what the fridge did before the reset, and a reset is exactly the moment you
// might want to look back at one.
//
// Runs through the Firebase CLI's project-owner login (no service-account
// key), like the bug-report and migration scripts.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { timersPath } from '../src/store/fridge/paths.js'

const run = promisify(execFile)
const apply = process.argv.includes('--apply')

const PROJECT = 'meal-hat'
const FRIDGE_KEY = '0rhAwAvV---IB6oZyvWVbGWJBdaO7awf'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = join(REPO, 'backups')

const path = `/${timersPath(FRIDGE_KEY)}`

const get = async (p) => {
  const { stdout } = await run('firebase', ['database:get', p, '--project', PROJECT], {
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(stdout || 'null')
}

// --- Read what is there ------------------------------------------------------

let timers
try {
  timers = (await get(path)) || {}
} catch (error) {
  console.error('Could not read the fridge. Is `firebase login` still valid?')
  console.error(error.stderr || error.message)
  process.exit(1)
}

const rows = Object.entries(timers).map(([id, timer]) => ({ id, ...timer }))

if (!rows.length) {
  console.log('The fridge is already empty. Nothing to do.')
  process.exit(0)
}

// --- Say exactly what would go -----------------------------------------------

const now = new Date()
const DAY_MS = 24 * 60 * 60 * 1000
const daysLeft = (timer) => {
  const at = new Date(timer.expiryDate).getTime()
  if (Number.isNaN(at)) return null
  return Math.round((at - now.getTime()) / DAY_MS)
}

rows.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))

console.log(`${rows.length} timer${rows.length === 1 ? '' : 's'} in fridge/${FRIDGE_KEY}:`)
console.log('')
rows.forEach((timer) => {
  const left = daysLeft(timer)
  const when = left === null
    ? 'unreadable date'
    : left < 0 ? `expired ${-left}d ago` : `${left}d left`
  console.log(`  ${timer.title.padEnd(28)} ${when}`)
})
console.log('')

// Expired timers are worth calling out separately: they are the ones the reset
// is arguably overdue for, and the ones whose loss costs nothing.
const expired = rows.filter((timer) => (daysLeft(timer) ?? 0) < 0).length
if (expired) console.log(`${expired} of those ${expired === 1 ? 'is' : 'are'} already expired.`)

console.log('Templates and catalog shelf lives are NOT touched — a re-scan will')
console.log('still recognise these foods and fill their durations in for you.')
console.log('')

if (!apply) {
  console.log('Dry run. Re-run with --apply to back these up and delete them.')
  process.exit(0)
}

// --- Back up, then delete ----------------------------------------------------
//
// The backup is written and its path printed BEFORE the delete, so a failure
// anywhere in here still leaves a recoverable file rather than a half-reset
// fridge with nothing to restore from.

mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = now.toISOString().replace(/[:.]/g, '-')
const backup = join(BACKUP_DIR, `fridge-timers-${stamp}.json`)
writeFileSync(backup, JSON.stringify(timers, null, 2))
console.log(`Backed up to ${backup}`)
console.log(`Restore with: firebase database:set ${path} ${backup} --project ${PROJECT}`)
console.log('')

try {
  await run('firebase', ['database:remove', path, '--project', PROJECT, '--force'], {
    maxBuffer: 64 * 1024 * 1024
  })
} catch (error) {
  console.error('The delete failed. The fridge is unchanged and the backup above still stands.')
  console.error(error.stderr || error.message)
  process.exit(1)
}

console.log(`Cleared ${rows.length} timers. Go photograph the fridge.`)
