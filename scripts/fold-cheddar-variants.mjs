// Fold "Shredded Cheddar Cheese" and "Grated Cheddar Cheese" back into the
// catalog's "Cheddar Cheese".
//
//   node scripts/fold-cheddar-variants.mjs           # dry run
//   node scripts/fold-cheddar-variants.mjs --apply   # writes it
//
// Report 2026-10-11: "it says that I need cheddar cheese, even though I
// definitely said that I had a full package of shredded cheddar". The
// 2026-09-28 talk-through named the bag "Shredded Cheddar Cheese" (and a
// second mention "Grated Cheddar Cheese"); reconcile then minted catalog foods
// for both, so every talk-through since was offered the variant names and
// kept matching them. The meals ask for "Cheddar Cheese" — names are the
// join — so the bag on the shelf never covered the row. talkReview's
// `asCatalogName` stops a new variant forming; this repairs the old ones.
//
// Neither variant is used by a meal or a shopping-list row (checked below,
// refused if that changes). Each takes with it:
//   - its timers, RENAMED rather than deleted — the bag is real;
//   - its template — the survivor's shelf life stands;
//   - its usage log, folded in per day by the HIGHER count: one food said
//     under two names on the same day is one reading, and the name that went
//     unsaid logged a zero by absence, not because the bag was gone.
//
// Like the scripts beside it: dry by default, backups before any write, and a
// state it describes (safe to run twice).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { timersPath, templatesPath, templateKey } from '../src/store/fridge/paths.js'

const run = promisify(execFile)
const apply = process.argv.includes('--apply')

const PROJECT = 'meal-hat'
const HAT = 'mattgrosso-gmail-com'
const SURVIVOR = 'dff498c5-8a4a-41e5-8574-3f0ca1d54dc0' // Cheddar Cheese
const VARIANTS = ['fridge-shredded-cheddar-cheese', 'fridge-grated-cheddar-cheese']

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = join(REPO, 'backups')

const get = async (path) => {
  const { stdout } = await run('firebase', ['database:get', path, '--project', PROJECT], {
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(stdout || 'null')
}

let fridgeKey, catalog, meals, shoppingList, timers, templates, usage
try {
  fridgeKey = await get(`/${HAT}/fridgeKey`)
  catalog = (await get(`/${HAT}/grocery-catalog`)) || {}
  meals = (await get(`/${HAT}/meals`)) || {}
  shoppingList = (await get(`/${HAT}/shopping-list`)) || {}
  timers = (await get(`/${timersPath(fridgeKey)}`)) || {}
  templates = (await get(`/${templatesPath(fridgeKey)}`)) || {}
  usage = {}
  for (const id of [SURVIVOR, ...VARIANTS]) usage[id] = (await get(`/${HAT}/usage-log/${id}`)) || {}
} catch (error) {
  console.error('Could not read. Is `firebase login` still valid?')
  console.error(error.stderr || error.message)
  process.exit(1)
}

const survivor = catalog[SURVIVOR]
if (!survivor) { console.log(`REFUSED: ${SURVIVOR} is not in the catalog`); process.exit(1) }

const lower = (s) => String(s || '').trim().toLowerCase()
const variants = VARIANTS.map((id) => catalog[id]).filter(Boolean)
const variantNames = new Set(variants.map((entry) => lower(entry.name)))
const used = JSON.stringify(meals) + JSON.stringify(shoppingList)
const inUse = variants.filter((entry) => used.includes(entry.id))
if (inUse.length) {
  console.log(`REFUSED — now referenced by a meal or list row: ${inUse.map((e) => e.name).join(', ')}`)
  process.exit(1)
}

const timerPatch = {}
Object.entries(timers).forEach(([id, timer]) => {
  if (!variantNames.has(lower(timer.title))) return
  timerPatch[`${id}/title`] = survivor.name
  console.log(`Timer   ${timer.title}  ->  ${survivor.name} (until ${timer.expiryDate.slice(0, 10)})`)
})

const templatePatch = {}
Object.entries(templates).forEach(([key, template]) => {
  if (!variantNames.has(lower(template.title))) return
  templatePatch[key] = null
  console.log(`Template ${template.title} (${template.days} days) dropped; ${survivor.name} keeps its own`)
})
const survivorTemplate = templates[templateKey(survivor.name)]
if (!survivorTemplate) console.log(`(no "${survivor.name}" template — a new one forms on the next sighting)`)

const merged = { ...usage[SURVIVOR] }
VARIANTS.forEach((id) => {
  Object.entries(usage[id]).forEach(([day, reading]) => {
    const into = { ...(merged[day] || {}) }
    if (reading.count !== undefined) into.count = Math.max(into.count ?? 0, reading.count)
    if (into.bought === undefined && reading.bought !== undefined) {
      into.bought = reading.bought
      if (reading.boughtCount !== undefined) into.boughtCount = reading.boughtCount
    }
    merged[day] = into
  })
})
const usagePatch = { [SURVIVOR]: merged, ...Object.fromEntries(VARIANTS.map((id) => [id, null])) }
console.log(`Usage   ${survivor.name}: ${JSON.stringify(usage[SURVIVOR])}`)
console.log(`     -> ${JSON.stringify(merged)}`)

const catalogPatch = Object.fromEntries(variants.map((entry) => [entry.id, null]))
variants.forEach((entry) => console.log(`Catalog ${entry.name} removed`))

if (!variants.length && !Object.keys(timerPatch).length && !Object.keys(templatePatch).length) {
  console.log('Nothing to do.')
  process.exit(0)
}
if (!apply) {
  console.log('\nDry run. Re-run with --apply to write it.')
  process.exit(0)
}

mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(join(BACKUP_DIR, `cheddar-fold-${stamp}.json`),
  JSON.stringify({ catalog, timers, templates, usage }, null, 2))
console.log(`\nBacked up to ${BACKUP_DIR}`)

const update = async (path, value) => {
  if (!Object.keys(value).length) return
  const file = join(BACKUP_DIR, `.patch-${path.replace(/\W+/g, '_')}-${stamp}.json`)
  writeFileSync(file, JSON.stringify(value))
  await run('firebase', ['database:update', `/${path}`, file, '--project', PROJECT, '--force'], {
    maxBuffer: 64 * 1024 * 1024
  })
}

try {
  // Timers first: the bag counts as cheddar the moment this lands. Templates
  // and catalog together after, so reconcile never sees one without the other.
  await update(timersPath(fridgeKey), timerPatch)
  await update(`${HAT}/usage-log`, usagePatch)
  await update(templatesPath(fridgeKey), templatePatch)
  await update(`${HAT}/grocery-catalog`, catalogPatch)
} catch (error) {
  console.error('A write failed. The backup above still stands.')
  console.error(error.stderr || error.message)
  process.exit(1)
}
console.log('Done.')
