// One-time migration: move perishable's fridge into meal-hat.
//
//   node scripts/migrate-fridge.mjs           # dry run: prints the whole plan
//   node scripts/migrate-fridge.mjs --apply   # writes it
//
// Three things happen, and they are independent:
//
//   1. Timers, templates and history are copied from perishable's
//      `households/<key>` into meal-hat's `fridge/<key>`. The KEY VALUE IS
//      REUSED — the scan Lambda authenticates against it, so a fresh key would
//      mean re-issuing that too for no gain.
//   2. The hat gets a `fridgeKey` pointer so a signed-in phone can find its
//      own fridge without being handed the secret in a URL.
//   3. The grocery catalog absorbs shelf life. This is the actual point of the
//      merge: `lastPurchased` plus a 60-day default is a GUESS at whether the
//      olive oil is still there, and the fridge holds the answer.
//
// Runs through the Firebase CLI's project-owner login (no service-account
// key), like the bug-report scripts. That login bypasses security rules, which
// is why this works before the fridge rules are deployed.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeName } from '../src/store/ingredients.js'
import { templateKey } from '../src/store/fridge/paths.js'

const run = promisify(execFile)
const apply = process.argv.includes('--apply')

const PERISHABLE = 'perishable-df421'
const MEAL_HAT = 'meal-hat'
const FRIDGE_KEY = '0rhAwAvV---IB6oZyvWVbGWJBdaO7awf'
const HAT = 'mattgrosso-gmail-com'

// The 16 pairs the name matcher could not decide on its own, resolved by Matt
// on 2026-08-29. Recorded here rather than applied by a cleverer heuristic,
// because four of them are matches a heuristic WOULD have made and should not
// have — `Peppers` onto the spice `Pepper` being the clearest.
//
// template title -> catalog name, or null to refuse the match and let the
// template become a food of its own.
const RESOLVED = {
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

  // Distinct foods, not variants — Matt's call. The template names the
  // specific one, so it lands there and the general entry keeps no shelf life.
  'Fresh Mozzarella Pearls': 'Mozzarella Pearls',
  Spinach: 'Fresh Spinach',

  // Refused. Each becomes its own catalog entry.
  Peppers: null,        // matched the SPICE (`Pepper`, Box/can, aisle 12)
  'Sausage Pasta': null, // a cooked dish, not the ingredient
  'Ice Cream': null,     // matched `Ice Cream Sandwiches`
  Cherries: null        // matched a shopping instruction, not a food
}

// A food that lives in the fridge but is never shopped for.
//
// Inferred ONLY from a "leftover" prefix, deliberately. The tempting rule —
// "any template with no catalog entry is fridge-only" — would have flagged
// Grapes, Potatoes, Watermelon, English muffins and nine others that are
// perfectly ordinary groceries. Wrongly hiding something from the shopping
// list is the expensive direction, the same reasoning that makes every
// uncertain staple resolve to "on the list".
const isFridgeOnly = (title) => /^leftover\b/i.test(String(title || '').trim())

const get = async (path, project) => {
  const { stdout } = await run('firebase', ['database:get', path, '--project', project], {
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(stdout || 'null')
}

const tmp = mkdtempSync(join(tmpdir(), 'fridge-migrate-'))
const writeNode = async (path, value, { merge = false } = {}) => {
  const file = join(tmp, `${path.replace(/\W+/g, '_')}.json`)
  writeFileSync(file, JSON.stringify(value))
  const command = merge ? 'database:update' : 'database:set'
  await run('firebase', [command, path, file, '--project', MEAL_HAT, '--force'], {
    maxBuffer: 64 * 1024 * 1024
  })
}

// --- Read both sides ---------------------------------------------------------

const timers = (await get(`/households/${FRIDGE_KEY}/timers`, PERISHABLE)) || {}
const templates = (await get(`/households/${FRIDGE_KEY}/templates`, PERISHABLE)) || {}
const history = (await get(`/households/${FRIDGE_KEY}/history`, PERISHABLE)) || {}
const catalog = (await get(`/${HAT}/grocery-catalog`, MEAL_HAT)) || {}

// Perishable stays live until the merge ships, so anything copied now goes
// stale the next time someone adds a timer at the kitchen wall. This is
// therefore built to run TWICE: once now to prove it works end to end, and
// again at cutover to pick up the drift.
//
// The re-run needs saying out loud, though. `--refresh` re-copies the fridge
// node from perishable, which is the right thing at cutover and destroys
// anything added on the meal-hat side in the meantime.
const refresh = process.argv.includes('--refresh')
const existingFridge = await get(`/fridge/${FRIDGE_KEY}`, MEAL_HAT)
if (existingFridge && !refresh) {
  console.error(`fridge/${FRIDGE_KEY} already exists in meal-hat.`)
  console.error('Re-run with --refresh to replace it with perishable\'s current state.')
  console.error('That discards anything written on the meal-hat side since the last copy.')
  process.exit(1)
}

// --- Work out where each template's shelf life belongs ------------------------

const byName = new Map()
Object.values(catalog).forEach((entry) => {
  if (entry?.name) byName.set(normalizeName(entry.name), entry)
})

const updates = []   // existing catalog entry gains a shelf life
const creations = [] // template has no catalog home; becomes one
const skipped = []   // template carries no usable number

for (const template of Object.values(templates)) {
  const title = String(template?.title || '').trim()
  if (!title || !Number.isInteger(template?.days)) {
    skipped.push({ title, reason: 'no whole-day shelf life on the template' })
    continue
  }

  // An explicit decision always wins over the matcher, including a refusal.
  let target = null
  if (Object.prototype.hasOwnProperty.call(RESOLVED, title)) {
    const resolvedName = RESOLVED[title]
    if (resolvedName) {
      target = byName.get(normalizeName(resolvedName))
      if (!target) {
        skipped.push({ title, reason: `resolved to "${resolvedName}", which is no longer in the catalog` })
        continue
      }
    }
  } else {
    target = byName.get(normalizeName(title)) || null
  }

  if (target) {
    updates.push({ title, days: template.days, entry: target })
  } else {
    creations.push({ title, days: template.days, fridgeOnly: isFridgeOnly(title) })
  }
}

// --- Collisions --------------------------------------------------------------
//
// Two templates can land on ONE catalog entry — perishable learned both
// "Cucumber" and "Cucumbers", and `Crackers` was resolved onto `Ritz Crackers`
// which could equally have had its own template. Left alone, the last write
// through the loop would decide the shelf life, silently and by iteration
// order.
//
// Agreeing duplicates collapse. Disagreeing ones are REFUSED rather than
// guessed at: a wrong shelf life is invisible for weeks and then shows up as
// food that expired early or late.
const byTarget = new Map()
updates.forEach((u) => {
  const list = byTarget.get(u.entry.id) || []
  list.push(u)
  byTarget.set(u.entry.id, list)
})

const collapsed = []
const conflicts = []
for (const list of byTarget.values()) {
  if (list.length === 1) { collapsed.push(list[0]); continue }

  const distinct = [...new Set(list.map((u) => u.days))]
  if (distinct.length === 1) {
    collapsed.push({ ...list[0], mergedFrom: list.map((u) => u.title) })
  } else {
    conflicts.push(list)
  }
}
updates.length = 0
updates.push(...collapsed)

// --- Report ------------------------------------------------------------------

console.log(`Fridge key      ${FRIDGE_KEY}`)
console.log(`Hat             ${HAT}`)
console.log(`Timers          ${Object.keys(timers).length}`)
console.log(`Templates       ${Object.keys(templates).length}`)
console.log(`History lines   ${Object.keys(history).length}`)
console.log(`Catalog entries ${Object.keys(catalog).length}`)
console.log()
console.log(`Shelf life onto existing foods: ${updates.length}`)
updates.forEach((u) => console.log(
  `  ${u.entry.name} <- ${u.mergedFrom ? u.mergedFrom.join(' + ') : u.title} (${u.days}d)`
))

if (conflicts.length) {
  console.log()
  console.log(`CONFLICTS — ${conflicts.length} catalog entr${conflicts.length === 1 ? 'y' : 'ies'} claimed by templates that disagree.`)
  console.log('Not written. Decide the shelf life and add it to RESOLVED, or edit the food afterwards.')
  conflicts.forEach((list) => {
    console.log(`  ${list[0].entry.name}:`)
    list.forEach((u) => console.log(`    ${u.title} says ${u.days}d`))
  })
}
console.log()
console.log(`New foods from templates: ${creations.length}`)
creations.forEach((c) => {
  const id = `fridge-${templateKey(c.title).replace(/\s+/g, '-').toLowerCase()}`
  const already = Boolean(catalog[id])
  console.log(
    `  ${c.title} (${c.days}d)${c.fridgeOnly ? '  [fridge only]' : ''}` +
    (already ? '  [already exists — shelf life only]' : '')
  )
})
if (skipped.length) {
  console.log()
  console.log(`Skipped: ${skipped.length}`)
  skipped.forEach((s) => console.log(`  ${s.title} — ${s.reason}`))
}
const untouched = Object.keys(catalog).length - updates.length
console.log()
console.log(`${untouched} catalog entries keep no shelf life, which is fine.`)

if (!apply) {
  console.log()
  console.log('Dry run. Nothing written. Re-run with --apply.')
  process.exit(0)
}

// --- Write -------------------------------------------------------------------

// The fridge node first. If anything below fails, the wall display still has
// somewhere to point.
await writeNode(`/fridge/${FRIDGE_KEY}`, { timers, templates, history })
console.log(`\nWrote fridge/${FRIDGE_KEY}`)

await writeNode(`/${HAT}/fridgeKey`, FRIDGE_KEY)
console.log(`Wrote ${HAT}/fridgeKey`)

// The catalog is MERGED, never set. Writing the whole node from a computed
// object would clobber concurrent edits and anything added on another device —
// the invariant CLAUDE.md spells out for shopping-list and grocery-catalog.
const catalogPatch = {}
updates.forEach((u) => {
  catalogPatch[`${u.entry.id}/shelfLifeDays`] = u.days
})
creations.forEach((c) => {
  const id = `fridge-${templateKey(c.title).replace(/\s+/g, '-').toLowerCase()}`

  // A food this script created on an earlier run is NOT a new food any more.
  //
  // The four RESOLVED refusals (Peppers, Cherries, Ice Cream, Sausage Pasta)
  // are always creations by construction — refusing the match is the whole
  // point — so on a --refresh they would come back through here and be written
  // as a WHOLE OBJECT at the same id. Firebase's update() replaces a child it
  // is given an object for, so an aisle or units added to Peppers in the
  // meantime would vanish silently. Once the entry exists, only the shelf life
  // is ours to touch.
  if (catalog[id]) {
    catalogPatch[`${id}/shelfLifeDays`] = c.days
    return
  }

  catalogPatch[id] = {
    id,
    name: c.title,
    shelfLifeDays: c.days,
    ...(c.fridgeOnly ? { fridgeOnly: true } : {})
  }
})

await writeNode(`/${HAT}/grocery-catalog`, catalogPatch, { merge: true })
console.log(`Merged ${updates.length} shelf lives and ${creations.length} new foods into the catalog`)
console.log('\nDone.')
