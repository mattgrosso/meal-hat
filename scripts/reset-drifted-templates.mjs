// Forget what the app thinks it learned about a food, and merge its spellings.
//
//   node scripts/reset-drifted-templates.mjs           # dry run
//   node scripts/reset-drifted-templates.mjs --apply   # writes it
//
// Matt, 2026-09-20, ruling on them one at a time: reset Sandwich Bread (76
// days), Cheddar Cheese (74) and Veggie Dogs (82), and merge the two pairs of
// spellings.
//
// These are the edit-mode drift. Extending a dying loaf used to re-teach the
// template the timer's whole new lifespan, and the next extension compounded
// it — nothing ever observed a loaf lasting 76 days. `shelfLife.js` now folds
// an observation into a running mean instead, so this cannot recur; it does
// nothing for the four foods that already ran away, which is what this fixes.
//
// RESETTING MEANS DELETING, NOT CORRECTING. A guess from the model plus the
// anchor machinery will land on a real number within a couple of sightings,
// and any figure typed in here would just be a different unfounded one. The
// app is better at "how long does bread keep" than this script is.
//
// TWO THINGS HAVE TO GO TOGETHER OR NEITHER WORKS:
//
//   1. The catalog's `shelfLifeDays` carries the same drifted number, and
//      `reconcileShelfLives` publishes a template for every catalog entry
//      that has one. Delete the template alone and the next signed-in visit
//      puts 76-day bread straight back. `shelfLifeSyncedDays` — the base the
//      two-way sync compares against — goes with it.
//   2. A food spelled two ways is a severed join, twice over: a timer matches
//      only one spelling, and the shopping list joins on the CATALOG's. So the
//      spelling that survives is whatever the catalog uses — "Sandwich Bread"
//      with a capital B, but "Veggie patties" with a small p. Follow the
//      catalog, not what looks tidier.

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

// Foods to forget entirely: every template spelling goes, and the catalog's
// shelf life with it.
//
// EMPTY ON PURPOSE, AND THIS IS THE INTERESTING PART OF THIS SCRIPT.
//
// It held ['Sandwich Bread', 'Cheddar Cheese', 'Veggie Dogs'] and did its job
// on 2026-09-20. Hours later Matt's read-through re-created all three from
// real sightings — Cheddar at 7 days, Veggie Dogs at 21 — which is exactly
// what forgetting them was FOR. Re-running the script at that point would have
// deleted the good new values and started the cycle again.
//
// A "forget this" instruction is not idempotent the way a merge is. A merge
// describes a state the data should be in and can be reapplied forever; a
// reset describes a moment. So the list is emptied once it has run, and the
// record of what it did lives in git rather than in a constant that will fire
// again the next time somebody runs this for an unrelated reason.
const RESET = []

// Foods to keep, but with one spelling. The value is what the household has
// learned and is NOT in question here — only the duplication is.
const MERGE_ONLY = ['Veggie patties', 'Cherry Tomatoes', 'Parmesan Cheese', 'Refried Beans']

// Foods where the two spellings DISAGREED and Matt picked a number.
//
// "Hot Dogs" said 21 days and "Hot dogs" said 5 — one food, two beliefs, and
// merging cannot avoid choosing. He took the short one: a spoilage tracker
// errs early everywhere else, 5 days matches an opened pack, and if a sealed
// pack really keeps three weeks the app learns that back the first time he
// extends one. Which is the whole point of beliefs being nudged rather than
// set.
const SET_DAYS = { 'Hot Dogs': 5 }

// Timers on the wall carrying a drifted date. These do NOT fix themselves: a
// talk-through CONFIRMS a tracked food rather than restarting its clock —
// deliberately, so a weekly walk cannot keep a dying carton of milk alive
// forever — so a wrong expiry survives every future read-through. Deleting
// them means the next talk-through re-adds them with sane dates.
//
// Emptied for the same reason as RESET, and more urgently: it held
// ['Sandwich Bread', 'Cheddar Cheese'], and by the time this ran again those
// names matched BRAND NEW timers from Matt's read-through. Naming a food here
// deletes whatever currently carries that name, which is only ever safe in
// the same breath as putting it there.
const DROP_TIMERS_FOR = []

// One food the catalog holds twice, found by Matt: "I said we had frozen
// veggie patties and you've interpreted that, but then still made it seem like
// we needed to buy veggie patties for the meal."
//
// The catalog had `Veggie patties` (packageSize 4, used by real meals) AND
// `Frozen Veggie Patties` (invented by the old migration, used by nothing).
// His read-through matched the second, so the shopping row joining on the
// first never saw it and went on asking him to buy what was in the freezer.
// The same severed join as the hamburger buns and `Hamburger bund`.
//
// The dying name is retitled on any live TIMER rather than deleted — the food
// is in the freezer, it just had the wrong label on it.
const RENAME_INTO = [{ from: 'Frozen Veggie Patties', to: 'Veggie patties' }]

const norm = (name) => String(name || '').trim().toLowerCase()

const get = async (path) => {
  const { stdout } = await run('firebase', ['database:get', path, '--project', PROJECT], {
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(stdout || 'null')
}

const remove = async (path) => {
  await run('firebase', ['database:remove', path, '--project', PROJECT, '--force'])
}

let fridgeKey, templates, catalog, timers, meals
try {
  fridgeKey = await get(`/${HAT}/fridgeKey`)
  if (!fridgeKey) throw new Error('this hat has no fridge')
  templates = (await get(`/fridge/${fridgeKey}/templates`)) || {}
  catalog = (await get(`/${HAT}/grocery-catalog`)) || {}
  timers = (await get(`/fridge/${fridgeKey}/timers`)) || {}
  meals = (await get(`/${HAT}/meals`)) || {}
} catch (error) {
  console.error('Could not read. Is `firebase login` still valid?')
  console.error(error.stderr || error.message)
  process.exit(1)
}

const plan = []
const deletes = []
const writes = []

const templatesNamed = (name) =>
  Object.entries(templates).filter(([key, t]) => norm(t?.title || key) === norm(name))

const catalogNamed = (name) =>
  Object.values(catalog).filter((entry) => norm(entry?.name) === norm(name))

for (const name of RESET) {
  for (const [key, template] of templatesNamed(name)) {
    plan.push(`FORGET template "${key}" (${template.days} days)`)
    deletes.push(`/fridge/${fridgeKey}/templates/${key}`)
  }
  for (const entry of catalogNamed(name)) {
    for (const field of ['shelfLifeDays', 'shelfLifeSyncedDays']) {
      if (entry[field] === undefined) continue
      plan.push(`CLEAR ${entry.name}.${field} (was ${entry[field]}) — or reconcile republishes it`)
      deletes.push(`/${HAT}/grocery-catalog/${entry.id}/${field}`)
    }
  }
}

for (const name of MERGE_ONLY) {
  const survivor = catalogNamed(name)[0]?.name
  if (!survivor) {
    console.error(`No catalog entry named "${name}" — nothing to anchor the spelling to.`)
    process.exit(1)
  }
  const all = templatesNamed(name)
  const keep = all.find(([key, t]) => (t?.title || key) === survivor)
  if (!keep) {
    console.error(`No template spelled exactly "${survivor}" — resolve by hand.`)
    process.exit(1)
  }
  plan.push(`KEEP template "${keep[0]}" (${keep[1].days} days) — the catalog's spelling`)
  for (const [key, template] of all) {
    if (key === keep[0]) continue
    plan.push(`DROP duplicate spelling "${key}" (${template.days} days)`)
    deletes.push(`/fridge/${fridgeKey}/templates/${key}`)
  }
}

// A number Matt chose, written to BOTH copies plus the sync base, so the
// two-way reconcile sees no change and neither side undoes it.
for (const [name, days] of Object.entries(SET_DAYS)) {
  for (const [key, template] of templatesNamed(name)) {
    const survivor = catalogNamed(name)[0]?.name
    if ((template?.title || key) !== survivor) {
      plan.push(`DROP duplicate spelling "${key}" (${template.days} days)`)
      deletes.push(`/fridge/${fridgeKey}/templates/${key}`)
      continue
    }
    if (template.days !== days) {
      plan.push(`SET template "${key}" — ${template.days} -> ${days} days`)
      writes.push([`/fridge/${fridgeKey}/templates/${key}/days`, days])
      writes.push([`/fridge/${fridgeKey}/templates/${key}/mean`, days])
      // The anchor moves too: it is the general claim about the food, and
      // this IS a general claim about the food, deliberately made.
      writes.push([`/fridge/${fridgeKey}/templates/${key}/anchor`, days])
    }
  }
  for (const entry of catalogNamed(name)) {
    for (const field of ['shelfLifeDays', 'shelfLifeSyncedDays']) {
      if (entry[field] === days) continue
      plan.push(`SET ${entry.name}.${field} — ${entry[field] ?? 'unset'} -> ${days}`)
      writes.push([`/${HAT}/grocery-catalog/${entry.id}/${field}`, days])
    }
  }
}

for (const { from, to } of RENAME_INTO) {
  const survivor = catalogNamed(to)[0]
  if (!survivor) {
    console.error(`No catalog entry named "${to}" to merge into.`)
    process.exit(1)
  }
  for (const [id, timer] of Object.entries(timers)) {
    if (norm(timer?.title) !== norm(from)) continue
    plan.push(`RETITLE timer ${id} — "${timer.title}" -> "${survivor.name}"`)
    writes.push([`/fridge/${fridgeKey}/timers/${id}/title`, survivor.name])
  }
  for (const [key, template] of templatesNamed(from)) {
    plan.push(`DROP template "${key}" (${template.days} days) — folded into ${survivor.name}`)
    deletes.push(`/fridge/${fridgeKey}/templates/${key}`)
  }
  for (const entry of catalogNamed(from)) {
    const used = Object.values(meals).some((m) => (m.ingredients || []).some((i) => i.groceryItemId === entry.id))
    if (used) {
      console.error(`${entry.id} is used by a meal — not a safe merge, resolve by hand.`)
      process.exit(1)
    }
    plan.push(`DROP catalog entry ${entry.id} ("${entry.name}", used by no meal)`)
    deletes.push(`/${HAT}/grocery-catalog/${entry.id}`)
  }
}

for (const name of DROP_TIMERS_FOR) {
  for (const [id, timer] of Object.entries(timers)) {
    if (norm(timer?.title) !== norm(name)) continue
    plan.push(`DROP timer ${id} — "${timer.title}" expiring ${String(timer.expiryDate).slice(0, 10)}`)
    deletes.push(`/fridge/${fridgeKey}/timers/${id}`)
  }
}

console.log(plan.length ? plan.join('\n') : 'Nothing to do — already done.')
if (!plan.length) process.exit(0)

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write it.')
  process.exit(0)
}

mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = join(BACKUP_DIR, `drifted-templates-${stamp}.json`)
writeFileSync(backup, JSON.stringify({ fridgeKey, templates, catalog, timers }, null, 2))
console.log(`\nBacked up to ${backup}`)

// Writes before deletes: a half-applied run that has corrected a survivor but
// not yet dropped its duplicate is cosmetic; the other order loses the good
// record.
const set = async (path, value) => {
  await run('firebase', ['database:set', path, '--project', PROJECT, '--force', '--data', JSON.stringify(value)])
}
for (const [path, value] of writes) {
  await set(path, value)
  console.log(`  wrote ${path}`)
}

for (const path of deletes) {
  await remove(path)
  console.log(`  removed ${path}`)
}

console.log('\nDone. These foods will be guessed fresh and re-learn from real sightings.')
