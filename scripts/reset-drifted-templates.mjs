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
const RESET = ['Sandwich Bread', 'Cheddar Cheese', 'Veggie Dogs']

// Foods to keep, but with one spelling. The value is what the household has
// learned and is NOT in question here — only the duplication is.
const MERGE_ONLY = ['Veggie patties']

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

let fridgeKey, templates, catalog
try {
  fridgeKey = await get(`/${HAT}/fridgeKey`)
  if (!fridgeKey) throw new Error('this hat has no fridge')
  templates = (await get(`/fridge/${fridgeKey}/templates`)) || {}
  catalog = (await get(`/${HAT}/grocery-catalog`)) || {}
} catch (error) {
  console.error('Could not read. Is `firebase login` still valid?')
  console.error(error.stderr || error.message)
  process.exit(1)
}

const plan = []
const deletes = []

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

console.log(plan.length ? plan.join('\n') : 'Nothing to do — already done.')
if (!plan.length) process.exit(0)

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write it.')
  process.exit(0)
}

mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = join(BACKUP_DIR, `drifted-templates-${stamp}.json`)
writeFileSync(backup, JSON.stringify({ fridgeKey, templates, catalog }, null, 2))
console.log(`\nBacked up to ${backup}`)

for (const path of deletes) {
  await remove(path)
  console.log(`  removed ${path}`)
}

console.log('\nDone. These foods will be guessed fresh and re-learn from real sightings.')
