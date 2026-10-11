// What the shopping list should hold, worked out from scratch every time the
// list is opened.
//
// Matt, 2026-10-11, after a few weeks of lists that were wrong in different
// ways: "one side is what we have, one side is what we need." So:
//
//   NEED  the ingredients of every meal on the schedule from today on (drawn
//         from the hat, or a Learn to Cook night), plus the REGULARS — foods
//         flagged "keep stocked" (`staple`) that the house is about to run
//         out of, at the rhythm it actually uses them (Diet Coke).
//   HAVE  the kitchen snapshot: the fridge's timers, which a talk-through
//         rewrites ("take that as an accurate snapshot").
//
// The NEED half is stored as rows; the HAVE half is subtracted when the list
// is drawn (staples.js `partitionStaples`), so the order he does things in
// never matters: "I should be able to draw meals and then go through the
// cupboard. It is when I hit shopping list that I need you to make these
// choices."
//
// IT MUST BE SAFE TO RUN ANY NUMBER OF TIMES. "Sometimes I open the list in
// order to generate it. Sometimes I just open the list because I just got to
// the store ... we don't reset things just because I've opened it twice."
// Three rules make that true:
//
//   1. Every derived row has a FIXED id — `meal-<groceryId>`,
//      `stock-<groceryId>` — so rebuilding rewrites the same row instead of
//      deleting it and minting a new one. (The old uuid-per-rebuild is how
//      two phones could leave duplicates, and how a tick could land on a row
//      another phone had just deleted.)
//   2. A tick survives: a meal row stays bought while what was bought still
//      covers what the meals need (purchases.js), and a regular bought today
//      is not asked for again today.
//   3. Only what changed is written. Opening the list a second time with
//      nothing new writes nothing at all.
//
// What this never touches: a row he added himself and has not bought. Those
// are his, and stay until he ticks or deletes them.
//
// What it clears: anything ticked off on an EARLIER day that is not a meal
// row. That was a past trip; the usage log already learned from it. Before
// this, the Bought section held 33 rows going back weeks.
//
// Pure: no Firebase, no clock beyond `now`.

import { aggregateMealIngredients } from './ingredients.js';
import { withPreservedPurchases } from './purchases.js';
import { predictRunOut, RUNNING_LOW_HORIZON_DAYS } from './usage.js';
import { stapleIsDue, daysSincePurchase, DEFAULT_STAPLE_INTERVAL_DAYS } from './staples.js';
import { toISODate, todayISO } from './schedule.js';

export const mealRowId = (groceryId) => `meal-${groceryId}`;
export const stockRowId = (groceryId) => `stock-${groceryId}`;

const addDays = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + days));
};

// A regular is bought by the PACKAGE — one case, one carton. Its catalog
// units are often the recipe's ("eggs", "cloves"), and "1 eggs" on the list
// would ask for a single egg; those show as a bare 1.
const PACKAGE_WORDS = /^(case|bag|bottle|jar|box|carton|loaf|can|pack|package|tub|block|lb|pound|gallon)s?$/i;
export const packageUnits = (units) => (PACKAGE_WORDS.test(String(units || '').trim()) ? units : '');

/**
 * Is this regular about to run out? Returns why, or null.
 *
 * Measured evidence first: how fast the house goes through it (talk-through
 * counts and purchases, usage.js). Due when it runs out within a week — one
 * shopping trip. Failing a rate, the old staple rule: not seen in the house,
 * and longer than its interval since it was last bought.
 */
export function regularDue (entry, log = {}, now = new Date(), onHandUntil = {}, mealUse = []) {
  if (!entry || !entry.staple || entry.fridgeOnly) return null;

  const prediction = predictRunOut(log || {}, now, mealUse);
  if (prediction) {
    const horizon = addDays(todayISO(now), RUNNING_LOW_HORIZON_DAYS);
    if (prediction.runsOutOn > horizon) return null;
    return {
      runsOutOn: prediction.runsOutOn,
      ...(prediction.perWeek ? { perWeek: Math.round(prediction.perWeek * 10) / 10 } : {}),
      ...(prediction.everyDays ? { everyDays: prediction.everyDays } : {})
    };
  }

  if (!stapleIsDue(entry, now, onHandUntil)) return null;
  const interval = Number(entry.stapleIntervalDays) > 0 ? Number(entry.stapleIntervalDays) : DEFAULT_STAPLE_INTERVAL_DAYS;
  const since = daysSincePurchase(entry, now);
  return since === null ? { neverBought: true } : { everyDays: interval };
}

// Field order and undefined-vs-missing must not make two equal rows look
// different, or rule 3 (write only what changed) quietly stops holding.
function same (a, b) {
  const clean = (row) => JSON.stringify(Object.keys(row || {}).sort()
    .filter((key) => row[key] !== undefined && row[key] !== null)
    .map((key) => [key, row[key]]));
  return clean(a) === clean(b);
}

/**
 * The writes that bring the stored list to what it should be.
 *
 * Returns `{ updates, rows }`: `updates` is a Firebase multi-path patch for
 * `shopping-list` (id -> row, or null to delete) holding ONLY the changes;
 * `rows` is the list as it will stand afterwards.
 */
export function planShoppingList ({
  stored = {},
  drawnMeals = [],
  getMeal = () => null,
  catalog = {},
  usageLog = {},
  onHandUntil = {},
  mealUseById = {},
  now = new Date()
} = {}) {
  const today = todayISO(now);
  const storedRows = Object.entries(stored || {})
    .filter(([, row]) => row && typeof row === 'object')
    .map(([id, row]) => ({ ...row, id }));

  const desired = {};

  // NEED, part one: the meals.
  const mealIngredients = aggregateMealIngredients({ drawnMeals, getMeal, catalog, now });
  const fresh = Object.values(mealIngredients).map((item) => ({
    id: mealRowId(item.id),
    groceryId: item.id,
    quantity: item.quantity,
    units: item.units || item.defaultUnits || '',
    aisle: item.aisle || item.defaultAisle || 0,
    location: item.location || item.defaultLocation || null,
    source: 'meal',
    mealId: item.mealId || null,
    purchased: false
  }));
  const previousMealRows = storedRows.filter((row) => row.source === 'meal');
  withPreservedPurchases(fresh, previousMealRows).forEach((row) => {
    if (row.purchased) {
      const before = previousMealRows.find((old) => old.groceryId === row.groceryId && old.purchased);
      row.purchasedOn = toISODate(before?.purchasedOn) || today;
    }
    desired[row.id] = row;
  });

  // Bought today, any kind of row: dealt with for this trip.
  const boughtToday = new Set(storedRows
    .filter((row) => row.purchased && toISODate(row.purchasedOn) === today)
    .map((row) => row.groceryId));
  // His own open rows: already asked for, by him.
  const openByHand = new Set(storedRows
    .filter((row) => row.source === 'manual' && !row.runningLow && !row.purchased)
    .map((row) => row.groceryId));

  // NEED, part two: the regulars.
  Object.entries(catalog || {}).forEach(([groceryId, entry]) => {
    if (!entry || !entry.staple) return;
    const mealRow = desired[mealRowId(groceryId)];
    const due = regularDue(entry, usageLog?.[groceryId], now, onHandUntil, mealUseById[groceryId]);

    if (mealRow) {
      // A meal wants it too: one row, not two. The verdict rides on the meal
      // row so the list can say it is running low (and not hide it in the
      // cupboard just because the meal only needs a spoonful).
      if (due && !mealRow.purchased) mealRow.runningLow = due;
      else if (!due) mealRow.stocked = true;
      return;
    }
    if (!due || boughtToday.has(groceryId) || openByHand.has(groceryId)) return;

    desired[stockRowId(groceryId)] = {
      id: stockRowId(groceryId),
      groceryId,
      quantity: 1,
      units: packageUnits(entry.defaultUnits),
      aisle: entry.defaultAisle || 0,
      location: entry.defaultLocation || null,
      source: 'stock',
      purchased: false,
      runningLow: due
    };
  });

  // Rows this plan owns: meal rows, regulars, and the running-low rows the
  // talk-through used to add by hand (source 'manual' + runningLow).
  const owned = (row) => row.source === 'meal' || row.source === 'stock' || Boolean(row.runningLow);

  const updates = {};
  storedRows.forEach((row) => {
    if (desired[row.id]) return;
    // A regular ticked off today stays in Bought for the rest of the trip.
    if (row.purchased && toISODate(row.purchasedOn) === today && row.source !== 'meal') return;
    if (owned(row)) {
      updates[row.id] = null;
      return;
    }
    // His own rows: kept until bought, then cleared the day after.
    if (row.purchased && toISODate(row.purchasedOn) !== today) updates[row.id] = null;
  });

  Object.values(desired).forEach((row) => {
    const existing = stored?.[row.id];
    if (!existing || !same({ ...existing, id: row.id }, row)) updates[row.id] = row;
  });

  const rows = {};
  storedRows.forEach((row) => { if (updates[row.id] !== null) rows[row.id] = row; });
  Object.entries(updates).forEach(([id, row]) => { if (row) rows[id] = row; });

  return { updates, rows };
}
