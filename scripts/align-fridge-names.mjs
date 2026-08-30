// Rename the twelve templates that still carry perishable's names, so the
// fridge and the catalog speak about food in the same words.
//
//   node scripts/align-fridge-names.mjs           # dry run
//   node scripts/align-fridge-names.mjs --apply   # writes it
//
// WHAT WENT WRONG. `scripts/migrate-fridge.mjs` held a RESOLVED map — the
// sixteen pairs Matt decided by hand, `Mozzarella Cheese` -> `Mozzarella` and
// so on. It used that map to push each template's shelf life onto the right
// CATALOG entry, which was the job it was written to do, and it did it: every
// one of these twelve agrees with its catalog entry to the day.
//
// But it never renamed the template itself. So the fridge still says
// "Mozzarella Cheese" while the catalog says "Mozzarella", and two things
// downstream join those two worlds by EXACT name:
//
//   - `planMealConsumption` matches a timer to a catalog entry with
//     `entry.name.trim().toLowerCase() === timer.title.trim().toLowerCase()`.
//     Under the old names it finds nothing, so "Made it" quietly declines to
//     touch food that is sitting right there. Fifteen of the fifty-three
//     groceries used in meals can currently be matched at all.
//   - `reconcileShelfLives` treats a template no catalog entry claims as a
//     food the catalog has never heard of, and INVENTS one. It has never run
//     in production — nothing in the catalog carries `shelfLifeSyncedDays` —
//     so the damage is still in the future: the next time a signed-in phone
//     opens /fridge it would mint `fridge-mozzarella-cheese`,
//     `fridge-lettuce`, `fridge-hotdogs` and nine more duplicates of foods the
//     catalog already has.
//
// So this runs BEFORE that visit, and before any timer reset. Renaming the
// templates closes both holes at once, because a timer written by a scan takes
// its title from the template it matched.
//
// Runs through the Firebase CLI's project-owner login, like the scripts beside
// it.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { templatesPath, templateKey } from '../src/store/fridge/paths.js'

const run = promisify(execFile)
const apply = process.argv.includes('--apply')

const PROJECT = 'meal-hat'
const FRIDGE_KEY = '0rhAwAvV---IB6oZyvWVbGWJBdaO7awf'
const HAT = 'mattgrosso-gmail-com'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = join(REPO, 'backups')

// Lifted verbatim from migrate-fridge.mjs's RESOLVED, minus the four entries
// Matt refused (Peppers, Sausage Pasta, Ice Cream, Cherries) — those became
// catalog foods of their own and already match.
//
// Not re-derived by a name matcher. These are the pairs a heuristic got wrong
// once already; they are Matt's answers and they stay written down.
const RENAMES = {
  Cucumbers: 'Cucumber',
  Hotdogs: 'Hot Dogs',
  'Hotdogs buns': 'Hot Dog Buns',
  Lemons: 'Lemon',
  Tortillas: 'Tortilla',
  Lettuce: 'Lettuce (not iceberg)',
  'Mozzarella Cheese': 'Mozzarella',
  'Fresh Tortellini': 'Tortellini',
  'Breaded Chicken Cutlets': 'Breaded Chicken',
  Crackers: 'Ritz Crackers',
  'Fresh Mozzarella Pearls': 'Mozzarella Pearls',
  Spinach: 'Fresh Spinach'
}

const get = async (path) => {
  const { stdout } = await run('firebase', ['database:get', path, '--project', PROJECT], {
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(stdout || 'null')
}

let templates
let catalog
try {
  templates = (await get(`/${templatesPath(FRIDGE_KEY)}`)) || {}
  catalog = (await get(`/${HAT}/grocery-catalog`)) || {}
} catch (error) {
  console.error('Could not read. Is `firebase login` still valid?')
  console.error(error.stderr || error.message)
  process.exit(1)
}

const catalogByName = new Map()
Object.values(catalog).forEach((entry) => {
  if (entry?.name) catalogByName.set(String(entry.name).trim().toLowerCase(), entry)
})

// --- Work out the plan, refusing anything that does not check out ------------

const moves = []
const refused = []

Object.entries(RENAMES).forEach(([from, to]) => {
  const fromKey = templateKey(from)
  const toKey = templateKey(to)
  const template = templates[fromKey]

  // Already done, or never existed. Either way there is nothing to move, and
  // that makes this script safe to run twice.
  if (!template) return

  const entry = catalogByName.get(to.trim().toLowerCase())
  if (!entry) {
    // The destination has to exist, or the rename simply relocates the problem.
    refused.push(`${from} -> ${to}: no catalog entry by that name`)
    return
  }

  const existing = templates[toKey]
  if (existing && existing.days !== template.days) {
    // A template already sits at the destination and disagrees. That is a real
    // decision about how long a food lasts, and it is not this script's to make.
    refused.push(
      `${from} (${template.days}d) -> ${to}: a template already there says ${existing.days}d`
    )
    return
  }

  moves.push({
    from,
    to,
    fromKey,
    toKey,
    days: template.days,
    // A merge rather than a move: same value already at the destination, so
    // this only drops the stale key.
    merges: Boolean(existing),
    catalogDays: entry.shelfLifeDays ?? null
  })
})

if (refused.length) {
  console.log('REFUSED — needs a decision, nothing was written:')
  refused.forEach((line) => console.log(`  ${line}`))
  console.log('')
}

if (!moves.length) {
  console.log('Nothing to rename. The fridge and the catalog already agree.')
  process.exit(refused.length ? 1 : 0)
}

console.log(`${moves.length} template${moves.length === 1 ? '' : 's'} to rename:`)
console.log('')
moves.forEach((move) => {
  const note = move.merges
    ? 'merges into an identical template already there'
    : move.catalogDays === move.days
      ? 'catalog agrees'
      : `catalog says ${move.catalogDays ?? 'nothing'} — publishing the fridge's ${move.days}d`
  console.log(`  ${`${move.from} -> ${move.to}`.padEnd(50)} ${move.days}d  (${note})`)
})
console.log('')

if (!apply) {
  console.log('Dry run. Re-run with --apply to write it.')
  process.exit(0)
}

// --- Write ------------------------------------------------------------------
//
// Whole node at once, via database:update, so a half-finished rename cannot
// leave a food under two names. Backed up first: templates are the only copy of
// shelf lives the wall tablet can reach.

mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = join(BACKUP_DIR, `fridge-templates-${stamp}.json`)
writeFileSync(backup, JSON.stringify(templates, null, 2))
console.log(`Backed up to ${backup}`)

const patch = {}
moves.forEach((move) => {
  patch[move.toKey] = { title: move.to, days: move.days, createdAt: new Date().toISOString() }
  patch[move.fromKey] = null // Firebase deletes a key written as null.
})

const file = join(BACKUP_DIR, `.rename-patch-${stamp}.json`)
writeFileSync(file, JSON.stringify(patch))

try {
  await run('firebase', [
    'database:update', `/${templatesPath(FRIDGE_KEY)}`, file, '--project', PROJECT, '--force'
  ], { maxBuffer: 64 * 1024 * 1024 })
} catch (error) {
  console.error('The write failed. Templates are unchanged; the backup above still stands.')
  console.error(error.stderr || error.message)
  process.exit(1)
}

console.log('')
console.log(`Renamed ${moves.length}. Every template now names a catalog food.`)
console.log('Next signed-in visit to /fridge will reconcile cleanly instead of')
console.log('inventing duplicates.')
