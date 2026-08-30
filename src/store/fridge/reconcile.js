// Keeping the catalog's shelf lives and the fridge's templates in agreement.
//
// WHY THERE ARE TWO COPIES AT ALL, since the whole point of the merge was to
// stop having two:
//
// The unified food record lives at `<hat>/grocery-catalog`, and the rules grant
// that only to hat members, keyed by auth.uid. The kitchen wall tablet holds a
// capability key and an anonymous session — it is a member of nothing, and
// cannot be made one without the sign-in it exists to avoid. So the wall can
// never read the catalog directly.
//
// This is the Magic Mirror problem again and it takes the same answer: the
// authenticated app PUBLISHES what the unauthenticated surface needs.
// `fridge/<key>/templates` is that projection. The catalog is authoritative;
// templates are a cache the wall can reach.
//
// But the wall WRITES too — a scan teaches a shelf life, and that knowledge is
// worth keeping. So this is a two-way sync, and a two-way sync needs a base to
// tell "they changed it" from "we changed it". That base is
// `shelfLifeSyncedDays` on the catalog entry: the value both sides last agreed
// on. With it, each side's edit is detectable on its own, and only a genuine
// simultaneous edit is a conflict.
//
// When both HAVE moved, the fridge wins. It is closer to the food: someone
// stood in the kitchen, photographed the actual item, and confirmed a date.

import { normalizeName } from '../ingredients';
import { templateKey } from './paths';

const isDays = (value) => Number.isInteger(value) && value > 0;

// A food that lives in the fridge but is never shopped for. Inferred only from
// a "leftover" prefix — see scripts/migrate-fridge.mjs for why the broader
// rule was rejected. Erring toward showing something on the shopping list is
// the cheap direction; wrongly hiding it is not.
const isFridgeOnly = (title) => /^leftover\b/i.test(String(title || '').trim());

/**
 * Work out what to write where. Pure: no Firebase, no store, no clock.
 *
 * Returns
 *   toCatalog   — catalog entries adopting a shelf life the fridge learned
 *   toTemplates — templates that need the catalog's value published to them
 *   newFoods    — templates naming a food the catalog has never heard of
 *   conflicts   — both sides moved; the fridge won, and it is worth saying so
 */
export function reconcileShelfLives ({ catalog = {}, templates = {} } = {}) {
  const toCatalog = [];
  const toTemplates = [];
  const newFoods = [];
  const conflicts = [];

  const claimed = new Set();

  Object.values(catalog).forEach((entry) => {
    if (!entry || !entry.name || !entry.id) return;

    const key = templateKey(entry.name);
    const template = templates[key];
    if (template) claimed.add(key);

    const fromFridge = isDays(template?.days) ? template.days : null;
    const inCatalog = isDays(entry.shelfLifeDays) ? entry.shelfLifeDays : null;
    const base = isDays(entry.shelfLifeSyncedDays) ? entry.shelfLifeSyncedDays : null;

    // Neither side knows anything. Most of the catalog is here, and it is fine.
    if (fromFridge === null && inCatalog === null) return;

    // Only the fridge knows: a food the wall learned about a catalog entry that
    // had no shelf life.
    if (inCatalog === null) {
      toCatalog.push({ id: entry.id, name: entry.name, days: fromFridge });
      return;
    }

    // Only the catalog knows: publish it so the wall can use it.
    if (fromFridge === null) {
      toTemplates.push({ title: entry.name, days: inCatalog });
      return;
    }

    // Agreed. Record the base if it was never written, so the NEXT edit is
    // attributable to whichever side made it.
    if (fromFridge === inCatalog) {
      if (base !== inCatalog) toCatalog.push({ id: entry.id, name: entry.name, days: inCatalog });
      return;
    }

    const fridgeMoved = fromFridge !== base;
    const catalogMoved = inCatalog !== base;

    if (fridgeMoved && catalogMoved) {
      // Both. The fridge wins — someone stood in the kitchen and confirmed a
      // real date — but this is worth surfacing rather than swallowing.
      conflicts.push({ id: entry.id, name: entry.name, fromFridge, inCatalog, base });
      toCatalog.push({ id: entry.id, name: entry.name, days: fromFridge });
      return;
    }

    if (fridgeMoved) {
      toCatalog.push({ id: entry.id, name: entry.name, days: fromFridge });
      return;
    }

    // Either the catalog moved, or neither did and they merely disagree with a
    // missing base. Publishing the catalog is right in both cases: it is the
    // authoritative copy.
    toTemplates.push({ title: entry.name, days: inCatalog });
  });

  // Templates naming a food the catalog has never heard of. A scan at the wall
  // can invent one — "Leftover chinese" was never a grocery.
  Object.entries(templates).forEach(([key, template]) => {
    if (claimed.has(key)) return;
    const title = String(template?.title || '').trim();
    if (!title || !isDays(template?.days)) return;

    // Guard against a second catalog entry for a name that only differs by
    // case or spacing — the catalog scan above matches on templateKey, which
    // is not quite the same normalization.
    const alreadyThere = Object.values(catalog).some(
      (entry) => entry?.name && normalizeName(entry.name) === normalizeName(title)
    );
    if (alreadyThere) return;

    newFoods.push({ title, days: template.days, fridgeOnly: isFridgeOnly(title) });
  });

  return { toCatalog, toTemplates, newFoods, conflicts };
}

// The id given to a food the fridge invented. Stable and derived from the name,
// so the same food learned twice cannot become two entries.
export const fridgeFoodId = (title) =>
  `fridge-${templateKey(title).replace(/\s+/g, '-').toLowerCase()}`;
