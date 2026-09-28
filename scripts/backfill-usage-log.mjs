// Rebuild the usage log's past from the fridge's change log.
//
//   node scripts/backfill-usage-log.mjs           # dry run: shows what it would write
//   node scripts/backfill-usage-log.mjs --apply   # writes it
//
// Matt, 2026-09-28, after a talk-through where he said one and a half cases of
// Diet Coke and nothing was suggested: "we have the receipts, so you know what
// I bought, and then you can see from the most recent fridge report how much
// is left ... it should be able to figure that out already".
//
// It could not, because the usage log only started that morning: one count is
// not a rate. But the fridge's change log goes back to August, and it holds
// most of what the usage log would have recorded had it existed:
//
//   - a talk-through's ADDS. The first read-through (2026-09-20) wrote one
//     timer per package, so the number of "added" lines for a food that second
//     IS the count. Later ones write one timer carrying `quantity`, which is
//     read off the timer when it still exists.
//   - a talk-through's REMOVALS: not mentioned, or said to be out of it. Zero.
//   - a receipt's ADDS: a purchase on that day, amount unknown (receipts did
//     not read quantities until 2026-09-28). A receipt scanned BEFORE that
//     day's talk-through is skipped: the talk-through already counted it.
//   - the most recent tick with no amount, when the ticked row is still on the
//     list: its quantity, converted the way the app now converts every tick.
//
// A food a talk-through merely confirmed wrote no line and so cannot be
// recovered. Nothing already in the log is overwritten, field by field, so it
// is safe to re-run. Names that match no catalog food are listed at the end:
// the log is keyed by catalog id, so those foods cannot learn anything until
// the names agree.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  catalogIdsByName,
  packagesBought,
  predictRunOut,
  runningLowFoods,
  runningLowNote,
  sortedEntries
} from '../src/store/usage.js'
import { normalizeFoodName } from '../src/store/fridge/scanReview.js'
import { toISODate } from '../src/store/schedule.js'

const run = promisify(execFile)
const apply = process.argv.includes('--apply')

const PROJECT = 'meal-hat'
const HAT = 'mattgrosso-gmail-com'
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = join(REPO, 'backups')

const get = async (path) => {
  const { stdout } = await run('firebase', ['database:get', path, '--project', PROJECT], {
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(stdout || 'null')
}
const update = async (path, value) => {
  await run('firebase', ['database:update', path, '--project', PROJECT, '--force', '--data', JSON.stringify(value)])
}

let catalog, usageLog, shoppingList, history, timers
try {
  const fridgeKey = await get(`/${HAT}/fridgeKey`)
  if (!fridgeKey) throw new Error('this hat has no fridge')
  catalog = (await get(`/${HAT}/grocery-catalog`)) || {}
  usageLog = (await get(`/${HAT}/usage-log`)) || {}
  shoppingList = (await get(`/${HAT}/shopping-list`)) || {}
  history = Object.values((await get(`/fridge/${fridgeKey}/history`)) || {})
  timers = Object.values((await get(`/fridge/${fridgeKey}/timers`)) || {})
} catch (error) {
  console.error('Could not read. Is `firebase login` still valid?')
  console.error(error.stderr || error.message)
  process.exit(1)
}

const byName = catalogIdsByName(catalog)
const localDate = (at) => toISODate(new Date(at))
const unmatched = new Map()
const idFor = (title) => {
  const id = byName[normalizeFoodName(title)]
  if (!id) unmatched.set(normalizeFoodName(title), title)
  return id
}

// When each day's talk-through happened (its first line), to order a receipt
// against it.
const talkAt = {}
history.filter((h) => h.source === 'talk').forEach((h) => {
  const date = localDate(h.at)
  if (!talkAt[date] || h.at < talkAt[date]) talkAt[date] = h.at
})

// A timer written within a few seconds of a line is that line's timer.
const timerQuantity = (title, at) => {
  const when = new Date(at).getTime()
  const timer = timers.find((t) => normalizeFoodName(t.title) === normalizeFoodName(title) &&
    Math.abs(new Date(t.createdAt).getTime() - when) < 5000)
  return Number(timer?.quantity) > 0 ? Number(timer.quantity) : 1
}

const lines = {} // `${id}/${date}` -> "added" lines
const onTimer = {} // `${id}/${date}` -> the largest quantity on a matching timer
const removedTo0 = new Set()
const receipts = new Set() // `${id}/${date}`

for (const line of history) {
  if (!line.title || !line.at) continue
  const date = localDate(line.at)
  if (line.source === 'talk' && line.action === 'added') {
    const id = idFor(line.title)
    if (!id) continue
    const key = `${id}/${date}`
    lines[key] = (lines[key] || 0) + 1
    onTimer[key] = Math.max(onTimer[key] || 0, timerQuantity(line.title, line.at))
  } else if (line.source === 'talk' && line.action === 'removed') {
    const id = idFor(line.title)
    if (id) removedTo0.add(`${id}/${date}`)
  } else if (line.source === 'scan' && line.action === 'added') {
    if (talkAt[date] && line.at < talkAt[date]) continue
    const id = idFor(line.title)
    if (id) receipts.add(`${id}/${date}`)
  }
}
// Lines per package on the first read-through, one line carrying a quantity
// since: whichever says more. (Duplicates later folded into one timer carry
// the same total, so the two agree there.)
const counts = {}
Object.keys(lines).forEach((key) => { counts[key] = Math.max(lines[key], onTimer[key]) })
removedTo0.forEach((key) => { if (!(key in counts)) counts[key] = 0 })

const patch = {}
const has = (id, date, field) => {
  const value = usageLog?.[id]?.[date]?.[field]
  return value !== undefined && value !== null
}
Object.entries(counts).forEach(([key, count]) => {
  const [id, date] = key.split('/')
  if (!has(id, date, 'count')) patch[`${id}/${date}/count`] = count
})
receipts.forEach((key) => {
  const [id, date] = key.split('/')
  if (!has(id, date, 'bought')) patch[`${id}/${date}/bought`] = 'receipt'
})

// The latest tick with no amount, from the ticked row still on the list.
Object.entries(usageLog).forEach(([id, log]) => {
  const latest = [...sortedEntries(log)].reverse().find((e) => e.bought)
  if (!latest || has(id, latest.date, 'boughtCount')) return
  const rows = Object.values(shoppingList).filter((row) => row?.groceryId === id && row.purchased)
  const total = rows.reduce((sum, row) => sum + (packagesBought(row, catalog[id]) || 0), 0)
  if (rows.length && rows.every((row) => packagesBought(row, catalog[id]))) {
    patch[`${id}/${latest.date}/boughtCount`] = total
  }
})

// What the log looks like with the patch applied.
const merged = JSON.parse(JSON.stringify(usageLog))
Object.entries(patch).forEach(([path, value]) => {
  const [id, date, field] = path.split('/')
  merged[id] = merged[id] || {}
  merged[id][date] = { ...(merged[id][date] || {}), [field]: value }
})

const nameOf = (id) => catalog[id]?.name || id
const byFood = {}
Object.entries(patch).forEach(([path, value]) => {
  const [id, date, field] = path.split('/')
  ;(byFood[id] = byFood[id] || []).push(`${date} ${field}=${value}`)
})

console.log(`Would write ${Object.keys(patch).length} fields across ${Object.keys(byFood).length} foods:\n`)
Object.entries(byFood)
  .sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b)))
  .forEach(([id, lines]) => console.log(`  ${nameOf(id)}: ${lines.sort().join(', ')}`))

console.log('\nWhat each food predicts once written:\n')
Object.entries(merged)
  .map(([id, log]) => ({ id, prediction: predictRunOut(log) }))
  .filter(({ prediction }) => prediction)
  .sort((a, b) => a.prediction.runsOutOn.localeCompare(b.prediction.runsOutOn))
  .forEach(({ id, prediction }) => {
    console.log(`  ${nameOf(id)}: runs out ${prediction.runsOutOn} (${runningLowNote(prediction).replace('running low — ', '')})`)
  })

const low = runningLowFoods(merged, catalog, shoppingList)
console.log(`\nThe next talk-through would add: ${low.map((f) => nameOf(f.groceryId)).join(', ') || 'nothing (already listed, or not due within a week)'}`)

if (unmatched.size) {
  console.log('\nNames in the fridge that match no catalog food (they cannot learn a rate):')
  ;[...unmatched.values()].sort().forEach((title) => console.log(`  ${title}`))
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write it.')
  process.exit(0)
}
if (!Object.keys(patch).length) {
  console.log('\nNothing to write.')
  process.exit(0)
}

mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = join(BACKUP_DIR, `usage-log-${stamp}.json`)
writeFileSync(backup, JSON.stringify(usageLog, null, 2))
console.log(`\nBacked up to ${backup}`)

await update(`/${HAT}/usage-log`, patch)
console.log('Done.')
