// Fold the four spellings of "hamburger buns" back into one food.
//
//   node scripts/merge-hamburger-buns.mjs           # dry run
//   node scripts/merge-hamburger-buns.mjs --apply   # writes it
//
// Matt, 2026-09-20: "Yeah, you can combine those hamburger buns."
//
// The talk-through surfaced it: a single spoken "hamburger buns" matched TWO
// live timers, and the shopping list read the house as holding two packages
// when it holds one. Underneath was the same name-join breakage CLAUDE.md
// already documents twice, in its worst form yet:
//
//   timers      "Hamburger Buns"  expires 2026-11-26   (a 76-day bun)
//               "Hamburger buns"  expires 2026-09-24   (a 13-day bun)
//   templates   "Hamburger Buns"  76 days
//               "Hamburger buns"  13 days
//               "Hamburger bund"  12 days   <- a typo, learned as a food
//               "Hamburgers"       7 days   <- NOT buns. Left alone.
//   catalog     "Hamburger Buns"         76 days, used by 2 meals
//               "fridge-hamburger-bund"  12 days, used by NOTHING
//
// WHICH TIMER SURVIVES: the one expiring soonest. A spoilage tracker errs
// early, and 76 days is not a thing that happens to a bun.
//
// WHICH SHELF LIFE: 13 days, not 76. The 76 is the documented drift — edit
// mode re-taught the template every time a timer was extended, and buns,
// sandwich bread, cheddar and spinach all crept up. Only the buns are touched
// here, because only the buns were asked about. The other three are still
// long and still waiting on Matt's word.
//
// ALL THREE COPIES OF THE NUMBER MOVE TOGETHER — the template, the catalog's
// `shelfLifeDays`, and the catalog's `shelfLifeSyncedDays`. That last one is
// the base the two-way sync uses to tell "they changed it" from "we changed
// it": leave it at 76 and the next signed-in visit reads the template as an
// edit, or worse, pushes 76 back onto the template. Setting all three to the
// same number makes the next reconcile a no-op, which is the point.
//
// AND THE ORPHAN CATALOG ENTRY HAS TO GO WITH ITS TEMPLATE. Deleting the
// "Hamburger bund" template alone would achieve nothing: `reconcileShelfLives`
// publishes a template for every catalog entry that has a shelf life, so the
// typo would simply come back on the next visit.

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

const SURVIVING_NAME = 'Hamburger Buns'
const SHELF_LIFE_DAYS = 13
const ORPHAN_CATALOG_ID = 'fridge-hamburger-bund'

// Spellings that are the same food. "Hamburgers" is deliberately absent: that
// is the patties, a different thing with a different shelf life.
const IS_BUNS = (name) => /^hamburger\s*(buns?|bund)$/i.test(String(name || '').trim())

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

let fridgeKey, timers, templates, catalog, meals, shoppingList
try {
  fridgeKey = await get(`/${HAT}/fridgeKey`)
  if (!fridgeKey) throw new Error('this hat has no fridge')
  timers = (await get(`/fridge/${fridgeKey}/timers`)) || {}
  templates = (await get(`/fridge/${fridgeKey}/templates`)) || {}
  catalog = (await get(`/${HAT}/grocery-catalog`)) || {}
  meals = (await get(`/${HAT}/meals`)) || {}
  shoppingList = (await get(`/${HAT}/shopping-list`)) || {}
} catch (error) {
  console.error('Could not read. Is `firebase login` still valid?')
  console.error(error.stderr || error.message)
  process.exit(1)
}

// --- Plan ---------------------------------------------------------------------

const bunTimers = Object.entries(timers)
  .filter(([, timer]) => IS_BUNS(timer?.title))
  .sort((a, b) => new Date(a[1].expiryDate) - new Date(b[1].expiryDate))

const bunTemplates = Object.entries(templates).filter(([key, t]) => IS_BUNS(t?.title || key))

const survivor = Object.values(catalog).find(
  (entry) => entry?.name?.trim().toLowerCase() === SURVIVING_NAME.toLowerCase()
)

if (!survivor) {
  console.error(`No catalog entry named "${SURVIVING_NAME}". Nothing safe to merge into.`)
  process.exit(1)
}

// The orphan must be an orphan. If any meal or list row ever started using it,
// this script has to move those references first, and it does not do that.
const orphanUsers = [
  ...Object.values(meals).filter((m) => (m.ingredients || []).some((i) => i.groceryItemId === ORPHAN_CATALOG_ID)),
  ...Object.values(shoppingList).filter((r) => r.groceryId === ORPHAN_CATALOG_ID)
]

const plan = []
const writes = []
const deletes = []

const [keep, ...drop] = bunTimers

if (keep) {
  plan.push(`KEEP timer ${keep[0]} — expires ${String(keep[1].expiryDate).slice(0, 10)} (soonest)`)
  if (keep[1].title !== SURVIVING_NAME) {
    plan.push(`  rename "${keep[1].title}" -> "${SURVIVING_NAME}"`)
    writes.push([`/fridge/${fridgeKey}/timers/${keep[0]}/title`, SURVIVING_NAME])
  }
}
drop.forEach(([id, timer]) => {
  plan.push(`DROP timer ${id} — "${timer.title}", expires ${String(timer.expiryDate).slice(0, 10)}`)
  deletes.push(`/fridge/${fridgeKey}/timers/${id}`)
})

bunTemplates.forEach(([key, template]) => {
  if (key === SURVIVING_NAME) {
    if (template.days !== SHELF_LIFE_DAYS) {
      plan.push(`TEMPLATE "${key}" — ${template.days} days -> ${SHELF_LIFE_DAYS}`)
      writes.push([`/fridge/${fridgeKey}/templates/${key}/days`, SHELF_LIFE_DAYS])
    }
    return
  }
  plan.push(`DROP template "${key}" (${template.days} days)`)
  deletes.push(`/fridge/${fridgeKey}/templates/${key}`)
})

;[['shelfLifeDays', survivor.shelfLifeDays], ['shelfLifeSyncedDays', survivor.shelfLifeSyncedDays]]
  .forEach(([field, current]) => {
    if (current === SHELF_LIFE_DAYS) return
    plan.push(`CATALOG ${survivor.name}.${field} — ${current ?? 'unset'} -> ${SHELF_LIFE_DAYS}`)
    writes.push([`/${HAT}/grocery-catalog/${survivor.id}/${field}`, SHELF_LIFE_DAYS])
  })

if (catalog[ORPHAN_CATALOG_ID]) {
  if (orphanUsers.length) {
    console.error(`${ORPHAN_CATALOG_ID} is used by ${orphanUsers.length} record(s). Not an orphan — stopping.`)
    process.exit(1)
  }
  plan.push(`DROP catalog entry ${ORPHAN_CATALOG_ID} (used by nothing)`)
  deletes.push(`/${HAT}/grocery-catalog/${ORPHAN_CATALOG_ID}`)
}

console.log(plan.length ? plan.join('\n') : 'Nothing to do — already merged.')

if (!plan.length) process.exit(0)

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write it.')
  process.exit(0)
}

// --- Apply --------------------------------------------------------------------

mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = join(BACKUP_DIR, `hamburger-buns-${stamp}.json`)
writeFileSync(backup, JSON.stringify({ fridgeKey, timers, templates, catalog }, null, 2))
console.log(`\nBacked up to ${backup}`)

// Writes before deletes. A half-applied run that has renamed the survivor but
// not yet dropped the duplicate is a cosmetic problem; one that has dropped
// the duplicate and not yet fixed the survivor has lost the good record.
for (const [path, value] of writes) {
  await set(path, value)
  console.log(`  wrote ${path}`)
}
for (const path of deletes) {
  await remove(path)
  console.log(`  removed ${path}`)
}

console.log('\nDone.')
