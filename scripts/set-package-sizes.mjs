// Give every grocery a `packageSize`, so cooking a meal spends the right
// fraction of what's in the fridge instead of clearing the whole timer.
//
//   node scripts/set-package-sizes.mjs           # dry run
//   node scripts/set-package-sizes.mjs --apply   # writes it
//
// WHY THIS EXISTS. `planMealConsumption` needs to know how much of a food comes
// in one package (see the long note at the top of src/store/fridge/consume.js).
// Without it every meal is assumed to use one WHOLE package, so a recipe
// calling for "1 Bottle" of olive oil clears the olive oil timer. Not one entry
// in the catalog had the field — 0 of 112 — so every "Made it" was running on
// that assumption.
//
// THE NUMBERS ARE MATT'S, taken 2026-08-30. He gave most of them as USES PER
// PURCHASE ("we get about 25 meals out of a bottle of olive oil"), which is the
// natural way to think about it but is NOT what the field holds. packageSize is
// in the recipe's own unit, so:
//
//     packageSize = uses per purchase x what one recipe asks for
//
// Olive oil is 25 either way because the recipe asks for 1 Bottle. Basil is
// not: 30 uses of 2 tbsp is a 60 tbsp jar. Every converted row is marked
// below with the arithmetic, so a wrong number is a visibly wrong number rather
// than an unexplained one.
//
// ERR LARGE, NOT SMALL. A packageSize that is too big means a timer survives a
// meal it should have cleared, which costs a glance at the fridge. Too small
// deletes a timer on food that is still there, which is the thing this app
// exists to prevent. Every guess here rounds toward the generous end.

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

// Keyed by catalog NAME rather than id, because the names are what Matt read
// off the table when he set these. Resolved to ids below, and a name that no
// longer resolves is reported rather than skipped.
const PACKAGE_SIZES = {
  // --- The recipe already counts whole packages -------------------------------
  Avocado: 1,
  'Breaded Chicken': 1,
  'Cherry Tomatoes': 1,
  'Fresh Spinach': 1,
  Ham: 1,                        // recipe wants 0.25 lb of a 1 lb package
  Lemon: 1,
  'Mozzarella Pearls': 1,
  Olives: 1,
  Orzo: 1,
  'Penne or Ziti': 1,
  'Premade tomato sauce': 1,     // the 28 oz jar; see the meal fix below
  'Refried Beans': 1,
  'Rotini or Farfalle': 1,
  Sausage: 1,
  Shells: 1,
  Spaghetti: 1,
  'Tomato Sauce': 1,             // the little can, used to make sauce from scratch
  Tortellini: 1,
  'Ziti or similar shape': 1,

  // --- Standard package, meal uses part of it ---------------------------------
  'Barilla Oven-Ready Lasagna': 9,   // oz; one box is 9 oz and one lasagna uses it
  'Bread Flour': 17,                 // cups in a 5 lb bag
  'Cheddar Cheese': 2,               // cups in an 8 oz bag of shredded
  'Cottage cheese': 24,              // oz tub
  Eggs: 12,
  Flour: 17,
  'Frozen Spinach': 16,              // oz
  Garlic: 10,                        // cloves in a head
  'Hamburger Buns': 8,
  'Hot Dog Buns': 8,
  'Hot Dogs': 8,
  'Lettuce (not iceberg)': 15,       // leaves off a head
  Mozzarella: 2,                     // cups in an 8 oz bag
  Ricotta: 15,                       // oz container
  'Sandwich Bread': 20,              // slices in a loaf
  Tortilla: 10,
  'Veggie Dogs': 8,

  // --- Matt's numbers, converted where the recipe asks for more than one -------
  Basil: 60,                     // 30 uses x 2 tbsp
  'Beef patties': 4,             // a package is 4; the recipe asks for 3 (see note)
  Bullion: 16,                   // 8 uses x 2 cubes
  'Caesar Dressing': 6,          // salads per bottle
  'Carrie Sliced Cheese': 25,    // 5 meals x 5 slices
  'Chicken Patties': 4,          // one package per meal, recipe asks for 4
  Croutons: 4,                   // salads per bag
  'Hot Sauce': 40,               // inert until the meal records a quantity (see note)
  Mushrooms: 5,
  'Olive Oil': 25,
  Parmesean: 10,
  'Parmesan Cheese': 10,
  Pepperoni: 4,
  Pesto: 2,
  'Sliced Cheese': 48,           // "huge packages", ~6 slices a meal
  'Veggie patties': 4,           // box of 4, recipe asks for 2
  Vinegar: 25
}

// --- The tomato sauce split --------------------------------------------------
//
// `Tomato Sauce` was carrying two different products. Baked ziti asked for 28
// of it, which is not 28 cans — it is the 28 OUNCE jar of premade sauce, a
// quantity recorded in the jar's ounces while the catalog entry's unit says
// "can". Homemade Pizza and Sausage Pasta ask for 1, and those genuinely are
// one little can of sauce to cook down.
//
// The catalog already has a separate `Premade tomato sauce` entry, in jars,
// which Lasagna uses correctly at 1. So Baked ziti moves onto it and asks for
// one jar. That leaves `Tomato Sauce` meaning exactly one thing, which is what
// lets its packageSize be 1.
//
// This also fixes the shopping list independently of the fridge: Baked ziti has
// been asking for "28 can Tomato Sauce".
const MEAL_FIXES = [
  {
    meal: '1736720921133-7cbc2c94-107e-47e5-9989-03154fc838c0',
    mealName: 'Baked ziti',
    index: 3,
    fromId: '48032361-e160-40f4-948a-431e14a33a0b', // Tomato Sauce (can)
    toId: '01704e2f-4454-48b1-9f7e-ee706a922daa',   // Premade tomato sauce (jar)
    fromQuantity: 28,
    toQuantity: 1
  }
]

const get = async (path) => {
  const { stdout } = await run('firebase', ['database:get', path, '--project', PROJECT], {
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(stdout || 'null')
}

let catalog
let meals
try {
  catalog = (await get(`/${HAT}/grocery-catalog`)) || {}
  meals = (await get(`/${HAT}/meals`)) || {}
} catch (error) {
  console.error('Could not read. Is `firebase login` still valid?')
  console.error(error.stderr || error.message)
  process.exit(1)
}

const byName = new Map()
Object.values(catalog).forEach((entry) => {
  if (entry?.name) byName.set(String(entry.name).trim().toLowerCase(), entry)
})

// --- Plan the catalog writes -------------------------------------------------

const writes = []
const unresolved = []
const unchanged = []

Object.entries(PACKAGE_SIZES).forEach(([name, size]) => {
  const entry = byName.get(name.trim().toLowerCase())
  if (!entry) {
    unresolved.push(name)
    return
  }
  if (entry.packageSize === size) {
    unchanged.push(name)
    return
  }
  writes.push({ id: entry.id, name: entry.name, from: entry.packageSize ?? null, size })
})

// --- Plan the meal writes ----------------------------------------------------

const mealWrites = []
const mealRefused = []

MEAL_FIXES.forEach((fix) => {
  const meal = meals[fix.meal]
  if (!meal) {
    mealRefused.push(`${fix.mealName}: no such meal`)
    return
  }
  const ingredient = (meal.ingredients || [])[fix.index]
  if (!ingredient) {
    mealRefused.push(`${fix.mealName}: no ingredient at index ${fix.index}`)
    return
  }
  // Both halves checked, because an ingredient list can be reordered by an edit
  // on any device and a positional write into the wrong row is silent.
  if (ingredient.groceryItemId !== fix.fromId || ingredient.quantity !== fix.fromQuantity) {
    mealRefused.push(
      `${fix.mealName}: ingredient ${fix.index} is not the row this expects ` +
      `(found ${ingredient.groceryItemId} x${ingredient.quantity}) — it has been edited since`
    )
    return
  }
  mealWrites.push({ ...fix, path: `${HAT}/meals/${fix.meal}/ingredients/${fix.index}` })
})

// --- Report ------------------------------------------------------------------

if (unresolved.length) {
  console.log('NOT FOUND in the catalog — nothing written for these:')
  unresolved.forEach((name) => console.log(`  ${name}`))
  console.log('')
}
if (mealRefused.length) {
  console.log('MEAL FIX REFUSED:')
  mealRefused.forEach((line) => console.log(`  ${line}`))
  console.log('')
}

console.log(`${writes.length} packageSize value${writes.length === 1 ? '' : 's'} to write` +
  (unchanged.length ? `, ${unchanged.length} already correct` : '') + ':')
console.log('')
writes
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name))
  .forEach((write) => {
    const was = write.from === null ? '' : ` (was ${write.from})`
    console.log(`  ${write.name.padEnd(30)} ${String(write.size).padStart(3)}${was}`)
  })
console.log('')

mealWrites.forEach((fix) => {
  console.log(`Meal fix — ${fix.mealName}: ingredient ${fix.index} moves from`)
  console.log(`  Tomato Sauce x${fix.fromQuantity}  ->  Premade tomato sauce x${fix.toQuantity}`)
  console.log('')
})

if (!writes.length && !mealWrites.length) {
  console.log('Nothing to do.')
  process.exit(0)
}

if (!apply) {
  console.log('Dry run. Re-run with --apply to write it.')
  process.exit(0)
}

// --- Write -------------------------------------------------------------------
//
// MERGED, never set. Writing a whole grocery-catalog node from a computed
// object clobbers concurrent edits and anything added on another device — the
// invariant CLAUDE.md spells out under "Shopping-list write invariant".

mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(join(BACKUP_DIR, `grocery-catalog-${stamp}.json`), JSON.stringify(catalog, null, 2))
writeFileSync(join(BACKUP_DIR, `meals-${stamp}.json`), JSON.stringify(meals, null, 2))
console.log(`Backed up the catalog and meals to ${BACKUP_DIR}`)

const update = async (path, value) => {
  const file = join(BACKUP_DIR, `.patch-${path.replace(/\W+/g, '_')}-${stamp}.json`)
  writeFileSync(file, JSON.stringify(value))
  await run('firebase', ['database:update', `/${path}`, file, '--project', PROJECT, '--force'], {
    maxBuffer: 64 * 1024 * 1024
  })
}

try {
  const patch = {}
  writes.forEach((write) => { patch[`${write.id}/packageSize`] = write.size })
  if (Object.keys(patch).length) await update(`${HAT}/grocery-catalog`, patch)

  for (const fix of mealWrites) {
    await update(fix.path, { groceryItemId: fix.toId, quantity: fix.toQuantity })
  }
} catch (error) {
  console.error('A write failed. The backups above still stand.')
  console.error(error.stderr || error.message)
  process.exit(1)
}

console.log('')
console.log(`Wrote ${writes.length} package sizes and ${mealWrites.length} meal fix(es).`)
console.log('')
console.log('Two things to know about the numbers, neither of them broken:')
console.log('  Beef patties  — package is 4, recipe asks for 3, so a cookout leaves')
console.log('                  a quarter-package timer rather than clearing it.')
console.log('  Hot Sauce     — Quesadillas records no quantity at all, so consumption')
console.log('                  skips it entirely and the 40 never comes into play.')
