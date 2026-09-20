// Put back the shopping-list rows the UTC-midnight bug dropped.
//
//   node scripts/add-missing-meal-rows.mjs           # dry run
//   node scripts/add-missing-meal-rows.mjs --apply   # writes it
//
// Matt, 2026-09-20: "I didn't say that we have sausage but it isn't on the
// shopping list. Something missed."
//
// `aggregateMealIngredients` compared `new Date(assignedDate) >= today`, and a
// bare 'YYYY-MM-DD' parses as UTC MIDNIGHT — 8pm the previous day in his
// timezone. So a meal drawn for TODAY sorted before local midnight and its
// ingredients silently never reached the list. Every day, all year. That day's
// meal was Sausage Pasta, and sausage, penne and tomato sauce were the three
// things missing.
//
// The third time this exact trap has been paid for here: `formatDate` and
// `nextMealId` both carry a comment about it, the fix landed in schedule.js,
// and this function never got it.
//
// The CODE is fixed. But the shopping list is a STORED node that only
// regenerates when meals are drawn or the schedule is edited, so his current
// list stays wrong until the next draw — which is after the shop. Hence this.
//
// It writes the same row shape `generateShoppingListFromMeals` writes, keyed
// by a fresh uuid, and MERGES rather than setting: the shopping-list write
// invariant in CLAUDE.md is that a full-node write clobbers manual items and
// anything added on another device. It only ever ADDS rows for groceries that
// have no unpurchased row already, so running it twice is harmless.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { aggregateMealIngredients } from '../src/store/ingredients.js'

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

let meals, drawn, catalog, shoppingList
try {
  meals = (await get(`/${HAT}/meals`)) || {}
  drawn = (await get(`/${HAT}/drawnMeals`)) || {}
  catalog = (await get(`/${HAT}/grocery-catalog`)) || {}
  shoppingList = (await get(`/${HAT}/shopping-list`)) || {}
} catch (error) {
  console.error('Could not read. Is `firebase login` still valid?')
  console.error(error.stderr || error.message)
  process.exit(1)
}

const getMeal = (id) => Object.values(meals).find((m) => m.id === id)
const wanted = aggregateMealIngredients({
  drawnMeals: Object.values(drawn),
  getMeal,
  catalog
})

// A grocery with ANY row is already accounted for — INCLUDING a purchased one.
//
// The first cut of this skipped purchased rows, on the theory that a tick
// belonged to a previous shop. It would have re-added six things Matt had
// ticked off minutes earlier and sent him back round the shop for cheddar he
// already had in the trolley. A tick is the most recent statement there is
// about a row; adding a second row for the same grocery contradicts it.
//
// What this script is for is the rows that were never derived AT ALL.
const alreadyListed = new Set(
  Object.values(shoppingList).filter(Boolean).map((row) => row.groceryId)
)

const additions = {}
const plan = []

Object.values(wanted).forEach((item) => {
  if (alreadyListed.has(item.id)) return
  const entry = catalog[item.id]
  const id = randomUUID()
  additions[id] = {
    id,
    groceryId: item.id,
    quantity: item.quantity,
    units: item.units || item.defaultUnits || '',
    aisle: item.aisle || item.defaultAisle || 0,
    location: item.location || (entry && entry.defaultLocation) || null,
    source: 'meal',
    mealId: item.mealId,
    purchased: false
  }
  const meal = getMeal(item.mealId)
  plan.push(`ADD ${item.name} x${item.quantity} ${additions[id].units} (for ${meal?.name || 'a drawn meal'})`)
})

if (!plan.length) {
  console.log('Nothing missing — the list already covers every upcoming meal.')
  process.exit(0)
}

console.log(plan.join('\n'))

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write it.')
  process.exit(0)
}

mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = join(BACKUP_DIR, `shopping-list-${stamp}.json`)
writeFileSync(backup, JSON.stringify(shoppingList, null, 2))
console.log(`\nBacked up to ${backup}`)

// One merge, not a set. `update()` folds these keys in and leaves every other
// row — manual items, other devices' additions — exactly where it found them.
await run('firebase', [
  'database:update', `/${HAT}/shopping-list`,
  '--project', PROJECT, '--force', '--data', JSON.stringify(additions)
])

console.log(`\nAdded ${plan.length} row(s).`)
