// Fold the duplicate cheese and parmesan entries together, and give the
// survivors the names the fridge already uses.
//
//   node scripts/merge-duplicate-groceries.mjs           # dry run
//   node scripts/merge-duplicate-groceries.mjs --apply   # writes it
//
// The last of the name gaps between the meals and the fridge. `align-fridge-
// names.mjs` fixed the twelve where a template pointed at nothing; these three
// are the reverse — the catalog holds two entries for one food, so a timer can
// only ever decrement one of them.
//
//   Parmesean (5 meals) + Parmesan Cheese (1 meal)
//       One food, spelled twice. The template is `Parmesan cheese`, which
//       matches the second, so a parmesan timer decremented Caesar Salad and
//       none of the other five. Parmesean dies; its `serving` unit moves to the
//       survivor, which had none and is about to inherit five recipes counted
//       in servings.
//
//   Sliced Cheese (2 meals) -> American Cheese Slices
//       Matt's American cheese, under a name no template matches. Meanwhile
//       `fridge-american-cheese-slices` — invented by the migration from a
//       template, used by no meal — held the name and the 30-day shelf life.
//       The real entry takes both and the invented one goes.
//
//   Carrie Sliced Cheese -> Sliced Cheddar
//       Not American cheese: sliced cheddar, and a different thing again from
//       the shredded `Cheddar Cheese` two meals already use. Renamed to say so.
//
// The deprecated `grocery-items` / `non-meal-grocery-items` nodes still hold
// copies of these records and are deliberately NOT touched. Nothing reads them
// — `migrateToUnifiedSystem` no longer exists in the store, despite what
// CLAUDE.md still says — so rewriting dead data would only make it look live.

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

const PARMESEAN = '167a1c25-7478-4de6-b499-b048d79bb1b8'
const PARMESAN = '906c2caf-d985-4318-81ff-92ae479f4c37'
const SLICED_CHEESE = '447b2893-91af-412a-bde9-5c125e27b793'
const FRIDGE_AMERICAN = 'fridge-american-cheese-slices'
const CARRIE = '49cc35c1-25cc-47d7-99a1-6fc0d3c5368d'

// A duplicate to retire, and the entry that absorbs it.
const MERGES = [
  {
    from: PARMESEAN,
    into: PARMESAN,
    // Fields the survivor lacks and the dying entry has. Never overwrites a
    // value the survivor already holds — the survivor is the one that keeps
    // its identity, and a merge should not quietly re-decide its aisle.
    inherit: ['defaultUnits']
  },
  {
    from: FRIDGE_AMERICAN,
    into: SLICED_CHEESE,
    inherit: ['shelfLifeDays']
  }
]

const RENAMES = [
  { id: SLICED_CHEESE, to: 'American Cheese Slices' },
  { id: CARRIE, to: 'Sliced Cheddar' }
]

const get = async (path) => {
  const { stdout } = await run('firebase', ['database:get', path, '--project', PROJECT], {
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(stdout || 'null')
}

let catalog, meals, shoppingList
try {
  catalog = (await get(`/${HAT}/grocery-catalog`)) || {}
  meals = (await get(`/${HAT}/meals`)) || {}
  shoppingList = (await get(`/${HAT}/shopping-list`)) || {}
} catch (error) {
  console.error('Could not read. Is `firebase login` still valid?')
  console.error(error.stderr || error.message)
  process.exit(1)
}

const problems = []

// --- Plan ---------------------------------------------------------------------

const catalogPatch = {}
const mealMoves = []
const listMoves = []
const plan = []

MERGES.forEach(({ from, into, inherit }) => {
  const dying = catalog[from]
  const survivor = catalog[into]
  if (!survivor) { problems.push(`survivor ${into} is not in the catalog`); return }
  if (!dying) return // already merged; this script is safe to run twice

  const gained = []
  inherit.forEach((field) => {
    if (survivor[field] === undefined && dying[field] !== undefined) {
      catalogPatch[`${into}/${field}`] = dying[field]
      gained.push(`${field}=${JSON.stringify(dying[field])}`)
    }
  })

  // Every reference has to move before the entry can go, or the shopping list
  // renders a row whose grocery no longer exists.
  Object.entries(meals).forEach(([mealKey, meal]) => {
    (meal.ingredients || []).forEach((ingredient, index) => {
      if (ingredient.groceryItemId !== from) return
      mealMoves.push({
        path: `${HAT}/meals/${mealKey}/ingredients/${index}`,
        mealName: meal.name || mealKey,
        quantity: ingredient.quantity,
        into
      })
    })
  })

  Object.entries(shoppingList).forEach(([rowKey, row]) => {
    if (row.groceryId !== from) return
    // Meal rows are rebuilt from the schedule anyway, but `withPreservedPurchases`
    // matches on groceryId — so repointing rather than deleting is what carries a
    // ticked-off item through the merge instead of putting it back on the list.
    listMoves.push({
      path: `${HAT}/shopping-list/${rowKey}`,
      quantity: row.quantity,
      purchased: Boolean(row.purchased),
      into
    })
  })

  catalogPatch[from] = null // Firebase deletes a key written as null.
  plan.push({ dying, survivor, gained })
})

RENAMES.forEach(({ id, to }) => {
  const entry = catalog[id]
  if (!entry) { problems.push(`cannot rename ${id}: not in the catalog`); return }
  if (entry.name === to) return

  // A rename onto a name something else already holds would recreate exactly the
  // duplication this script exists to remove. The merges above run first, so an
  // entry retired here no longer counts.
  const retired = new Set(Object.keys(catalogPatch).filter((k) => catalogPatch[k] === null))
  const clash = Object.values(catalog).find(
    (other) => other?.id !== id && !retired.has(other?.id) &&
      String(other?.name || '').trim().toLowerCase() === to.trim().toLowerCase()
  )
  if (clash) { problems.push(`cannot rename ${entry.name} -> ${to}: ${clash.id} already has that name`); return }

  catalogPatch[`${id}/name`] = to
  plan.push({ rename: { from: entry.name, to } })
})

if (problems.length) {
  console.log('REFUSED — nothing written:')
  problems.forEach((line) => console.log(`  ${line}`))
  process.exit(1)
}

// --- Report -------------------------------------------------------------------

plan.forEach((step) => {
  if (step.rename) {
    console.log(`Rename  ${step.rename.from}  ->  ${step.rename.to}`)
    return
  }
  console.log(`Merge   ${step.dying.name}  ->  ${step.survivor.name}`)
  if (step.gained.length) console.log(`        survivor gains ${step.gained.join(', ')}`)
})
console.log('')

if (mealMoves.length) {
  console.log(`${mealMoves.length} meal ingredient${mealMoves.length === 1 ? '' : 's'} repointed:`)
  mealMoves.forEach((move) => console.log(`  ${move.mealName.padEnd(26)} x${move.quantity}`))
  console.log('')
}
if (listMoves.length) {
  console.log(`${listMoves.length} shopping-list row${listMoves.length === 1 ? '' : 's'} repointed:`)
  listMoves.forEach((move) =>
    console.log(`  x${move.quantity}${move.purchased ? ', already ticked off — flag preserved' : ''}`))
  console.log('')
}

if (!Object.keys(catalogPatch).length && !mealMoves.length && !listMoves.length) {
  console.log('Nothing to do.')
  process.exit(0)
}

if (!apply) {
  console.log('Dry run. Re-run with --apply to write it.')
  process.exit(0)
}

// --- Write --------------------------------------------------------------------

mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(join(BACKUP_DIR, `grocery-catalog-${stamp}.json`), JSON.stringify(catalog, null, 2))
writeFileSync(join(BACKUP_DIR, `meals-${stamp}.json`), JSON.stringify(meals, null, 2))
writeFileSync(join(BACKUP_DIR, `shopping-list-${stamp}.json`), JSON.stringify(shoppingList, null, 2))
console.log(`Backed up the catalog, meals and shopping list to ${BACKUP_DIR}`)

const update = async (path, value) => {
  const file = join(BACKUP_DIR, `.patch-${path.replace(/\W+/g, '_')}-${stamp}.json`)
  writeFileSync(file, JSON.stringify(value))
  await run('firebase', ['database:update', `/${path}`, file, '--project', PROJECT, '--force'], {
    maxBuffer: 64 * 1024 * 1024
  })
}

try {
  // References first, catalog last. If this stops halfway the worst state is a
  // meal pointing at the survivor while the duplicate still exists — untidy and
  // harmless. The other order strands rows on a grocery that has been deleted.
  for (const move of mealMoves) await update(move.path, { groceryItemId: move.into })
  for (const move of listMoves) await update(move.path, { groceryId: move.into })
  await update(`${HAT}/grocery-catalog`, catalogPatch)
} catch (error) {
  console.error('A write failed. The backups above still stand.')
  console.error(error.stderr || error.message)
  process.exit(1)
}

console.log('')
console.log('Done. Every meal grocery now answers to exactly one name.')
