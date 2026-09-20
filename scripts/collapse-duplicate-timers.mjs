// Fold N identical timer cards into one card carrying a count.
//
//   node scripts/collapse-duplicate-timers.mjs           # dry run
//   node scripts/collapse-duplicate-timers.mjs --apply   # writes it
//
// Matt, 2026-09-20, looking at the wall after his first real read-through:
// "I'm seeing lots of duplicates. I see four entries for hot dogs. I see five
// entries for hot dog buns. I see three entries for pesto."
//
// My bug, and a decision I wrote a confident comment justifying: `talkPayload`
// emitted one timer PER PACKAGE, on the theory that a timer had always meant
// one physical thing and that splitting them was what let half a haul be eaten
// later. The data model never needed that — `consume.js` decrements
// `timer.quantity` and `packagesOnHand` sums it, so one timer holding six is
// understood everywhere something cares. Six identical cards bought nothing
// and cost the wall its entire job, which is to be readable from across a
// room. 120 timers, 79 actual foods, 41 cards of pure noise.
//
// The code is fixed; this repairs what it already wrote.
//
// WHICH ROW SURVIVES: the one expiring SOONEST. The duplicates are near-
// identical by construction (same read-through, same second) but where they
// differ at all, a spoilage tracker errs early. The survivor takes the total
// count of everything folded into it.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const apply = process.argv.includes('--apply')

const PROJECT = 'meal-hat'
const HAT = 'mattgrosso-gmail-com'
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = join(REPO, 'backups')

const norm = (name) => String(name || '').trim().toLowerCase()

const get = async (path) => {
  const { stdout } = await run('firebase', ['database:get', path, '--project', PROJECT], {
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(stdout || 'null')
}
const set = async (path, value) => {
  await run('firebase', ['database:set', path, '--project', PROJECT, '--force', '--data', JSON.stringify(value)])
}
const remove = async (path) => {
  await run('firebase', ['database:remove', path, '--project', PROJECT, '--force'])
}

let fridgeKey, timers
try {
  fridgeKey = await get(`/${HAT}/fridgeKey`)
  if (!fridgeKey) throw new Error('this hat has no fridge')
  timers = (await get(`/fridge/${fridgeKey}/timers`)) || {}
} catch (error) {
  console.error('Could not read. Is `firebase login` still valid?')
  console.error(error.stderr || error.message)
  process.exit(1)
}

const groups = new Map()
Object.entries(timers).forEach(([id, timer]) => {
  if (!timer?.title) return
  const key = norm(timer.title)
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push({ id, ...timer })
})

const plan = []
const writes = []
const deletes = []

for (const [, rows] of groups) {
  if (rows.length < 2) continue
  rows.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))
  const [keep, ...drop] = rows

  // Every row's own count, so a group that already had quantities folds
  // correctly rather than being counted as one apiece.
  const total = rows.reduce((n, row) => n + (Number(row.quantity) > 0 ? Number(row.quantity) : 1), 0)

  plan.push(
    `${keep.title}: ${rows.length} cards -> 1 card x${total}` +
    ` (keeping ${String(keep.expiryDate).slice(0, 10)}, the soonest)`
  )
  writes.push([`/fridge/${fridgeKey}/timers/${keep.id}/quantity`, total])
  drop.forEach((row) => deletes.push(`/fridge/${fridgeKey}/timers/${row.id}`))
}

if (!plan.length) {
  console.log('Nothing to do — no duplicate cards.')
  process.exit(0)
}

console.log(plan.join('\n'))
console.log(`\n${Object.keys(timers).length} timers -> ${Object.keys(timers).length - deletes.length}`)

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write it.')
  process.exit(0)
}

mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = join(BACKUP_DIR, `duplicate-timers-${stamp}.json`)
writeFileSync(backup, JSON.stringify({ fridgeKey, timers }, null, 2))
console.log(`\nBacked up to ${backup}`)

// Counts before deletions: a half-applied run that has set a quantity but not
// yet removed its duplicates over-counts, which is recoverable by re-running.
// The other order loses food.
for (const [path, value] of writes) await set(path, value)
console.log(`  set ${writes.length} quantities`)
for (const path of deletes) await remove(path)
console.log(`  removed ${deletes.length} duplicate cards`)

console.log('\nDone.')
