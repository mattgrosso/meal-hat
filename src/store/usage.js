import { toISODate, fromISODate, todayISO } from './schedule.js';
import { normalizeFoodName } from './fridge/scanReview.js';

// How fast the house goes through things, and when each one will run out.
//
// Matt, 2026-09-28: "the best example is ... figure out how quickly we drink
// Diet Coke, and then when I read out the fridge if we're below a specific
// threshold it could kind of anticipate that we're gonna run out of Diet Coke
// and add it to the shopping list."
//
// Nothing could learn a rate before this: the catalog keeps only the LAST
// purchase date, and the fridge's change log is capped and carries no counts.
// So the hat now keeps a small per-food log at `usage-log/<groceryId>/<date>`:
//
//   { count }        how many he said there were in a talk-through (0 = out of it)
//   { bought }       it was bought: a shopping-list row ticked off ('manual' |
//                    'meal'), or a line on a scanned receipt ('receipt')
//   { boughtCount }  how many were bought, in the same packages he counts in,
//                    when that is known
//
// One entry per food per DAY, merged, so a second talk-through the same day
// simply corrects the first rather than looking like a day of consumption.
//
// THE DIRECTION RULE, same as every other rule touching the shopping list:
// this may only ever ADD a row. A prediction never hides anything, and with no
// rate yet nothing changes at all. A wrong guess costs one row he can ignore.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// How far ahead counts as "about to run out". A week is one shopping trip.
export const RUNNING_LOW_HORIZON_DAYS = 7;

// Log entries older than this are pruned. Habits change; a year is plenty.
export const USAGE_LOG_KEEP_DAYS = 365;

// A count read out this long ago says nothing about the cupboard today.
const READING_STALE_DAYS = 45;

// Only the most recent stretches of consumption shape the rate, so a change of
// habit shows up within a few weeks rather than being averaged away.
const RATE_PAIRS_USED = 6;

// Three purchases make two gaps, the least that can be called a rhythm.
const RHYTHM_MIN_PURCHASES = 3;

const hasCount = (entry) => entry.count !== null && entry.count !== undefined && entry.count !== '' &&
  Number.isFinite(Number(entry.count));

// How many were bought on this entry's day, or null when nobody knows.
const boughtCountOf = (entry) => {
  const n = Number(entry.boughtCount);
  return entry.boughtCount !== null && entry.boughtCount !== undefined && Number.isFinite(n) && n > 0 ? n : null;
};

// The known total bought across these entries, or null if any amount is unknown.
const totalBought = (purchases) => {
  let total = 0;
  for (const entry of purchases) {
    const n = boughtCountOf(entry);
    if (n === null) return null;
    total += n;
  }
  return total;
};

const daysBetween = (fromIso, toIso) =>
  Math.round((fromISODate(toIso) - fromISODate(fromIso)) / MS_PER_DAY);

const addDays = (iso, days) => {
  const date = fromISODate(iso);
  date.setDate(date.getDate() + Math.floor(days));
  return todayISO(date);
};

/** A food's log as entries sorted oldest first, with unreadable dates dropped. */
export function sortedEntries (log = {}) {
  return Object.entries(log || {})
    .map(([date, entry]) => ({ date: toISODate(date), ...(entry || {}) }))
    .filter((entry) => entry.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Units used per day, from consecutive talk-through counts.
 *
 * Across a gap, what was used is what there was, plus what was bought, minus
 * what is left. That needs every purchase in the gap to say HOW MANY — a
 * receipt line or a ticked row does — and a gap with a purchase of unknown
 * size is skipped, because the drop across it cannot be measured.
 *
 * A purchase on the day of the LATER reading is taken to come after it: a
 * talk-through describes the house before the shop. A purchase on the day of
 * the earlier one is inside the gap for the same reason.
 *
 * Usage that comes out NEGATIVE means somebody bought it and nothing recorded
 * it; that pair is skipped rather than read as the house un-drinking a case.
 *
 * With no pair of readings at all, purchases before the FIRST reading still
 * say something (Matt, 2026-09-28: "we have the receipts, so you know what I
 * bought, and then you can see from the most recent fridge report how much is
 * left"). Whatever was already in the house is unknown, so bought-minus-left
 * is the least that can have been used: a LOW estimate, which predicts a
 * run-out later than the truth. It is replaced as soon as two readings exist.
 */
export function usageRate (log = {}) {
  const entries = sortedEntries(log);
  const readings = entries.filter(hasCount);
  const purchases = entries.filter((e) => e.bought || boughtCountOf(e) !== null);

  const pairs = [];
  for (let i = 1; i < readings.length; i += 1) {
    const a = readings[i - 1];
    const b = readings[i];
    const days = daysBetween(a.date, b.date);
    if (days < 1) continue;
    const bought = totalBought(purchases.filter((e) => e.date >= a.date && e.date < b.date));
    if (bought === null) continue;
    const used = Number(a.count) + bought - Number(b.count);
    if (used < 0) continue;
    pairs.push({ used, days });
  }

  if (!pairs.length && readings.length) {
    const lead = leadInPair(purchases, readings[0]);
    if (lead) pairs.push(lead);
  }

  const recent = pairs.slice(-RATE_PAIRS_USED);
  const used = recent.reduce((sum, p) => sum + p.used, 0);
  const days = recent.reduce((sum, p) => sum + p.days, 0);
  if (!recent.length || used <= 0) return null;

  return used / days;
}

// Purchases of known size before a first reading -> the least that can have
// been used by then. Only the unbroken run of known sizes nearest the reading
// counts, and only inside the stale window: a case bought in March says
// nothing about September.
function leadInPair (purchases, reading) {
  const before = purchases
    .filter((e) => e.date < reading.date && daysBetween(e.date, reading.date) <= READING_STALE_DAYS)
    .reverse();
  const run = [];
  for (const entry of before) {
    if (boughtCountOf(entry) === null) break;
    run.push(entry);
  }
  if (!run.length) return null;

  const first = run[run.length - 1];
  const days = daysBetween(first.date, reading.date);
  const used = totalBought(run) - Number(reading.count);
  return days >= 1 && used > 0 ? { used, days } : null;
}

/**
 * The typical gap between purchases, in days, or null.
 *
 * Only purchases from rows he added HIMSELF count. A meal ingredient is bought
 * when a meal is drawn, so its "rhythm" is the draw's and says nothing about
 * how fast the house uses it — Ziti would otherwise keep reappearing on its
 * own. Median rather than mean, so one long holiday does not stretch it.
 */
export function buyingRhythm (log = {}) {
  const dates = sortedEntries(log).filter((e) => e.bought === 'manual').map((e) => e.date);
  if (dates.length < RHYTHM_MIN_PURCHASES) return null;

  const gaps = [];
  for (let i = 1; i < dates.length; i += 1) gaps.push(daysBetween(dates[i - 1], dates[i]));
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return median >= 1 ? median : null;
}

/**
 * When this food will run out, and on what evidence — or null if there is not
 * enough to say. Null is the common answer and it means "change nothing".
 *
 * A usage rate wins over a buying rhythm: it comes from what he actually said
 * was in the house. The rhythm is the fallback for foods never counted.
 */
export function predictRunOut (log = {}, now = new Date()) {
  const today = todayISO(now);
  const entries = sortedEntries(log);

  const perDay = usageRate(log);
  if (perDay) {
    const latest = [...entries].reverse().find(hasCount);
    // A shop since the last count adds to it — if it says how much. One that
    // does not leaves the stock unknown, and the rhythm below is all there is.
    const boughtSince = latest
      ? totalBought(entries.filter((e) => (e.bought || boughtCountOf(e) !== null) && e.date >= latest.date))
      : null;
    if (latest && boughtSince !== null && daysBetween(latest.date, today) <= READING_STALE_DAYS) {
      return {
        runsOutOn: addDays(latest.date, (Number(latest.count) + boughtSince) / perDay),
        perWeek: perDay * 7
      };
    }
  }

  const everyDays = buyingRhythm(log);
  if (everyDays) {
    const lastBought = [...entries].reverse().find((e) => e.bought === 'manual').date;
    // A habit that has lapsed is not a prediction. Twice the usual gap with no
    // purchase means he has stopped buying it, not that it is overdue.
    if (daysBetween(lastBought, today) <= everyDays * 2) {
      return { runsOutOn: addDays(lastBought, everyDays), everyDays };
    }
  }

  return null;
}

/**
 * Foods to add to the shopping list because they are about to run out.
 *
 * Skipped: anything with a row already (bought or not — a purchased row means
 * it was just dealt with), fridge-only foods that are never shopped for, and
 * anything whose catalog entry is gone.
 */
export function runningLowFoods (usageLog = {}, catalog = {}, shoppingList = {}, now = new Date(), horizonDays = RUNNING_LOW_HORIZON_DAYS) {
  const listed = new Set(Object.values(shoppingList || {}).map((row) => row && row.groceryId).filter(Boolean));
  const horizon = addDays(todayISO(now), horizonDays);

  return Object.entries(usageLog || {})
    .filter(([groceryId]) => catalog[groceryId] && !catalog[groceryId].fridgeOnly && !listed.has(groceryId))
    .map(([groceryId, log]) => ({ groceryId, prediction: predictRunOut(log, now) }))
    .filter(({ prediction }) => prediction && prediction.runsOutOn <= horizon)
    .map(({ groceryId, prediction }) => ({ groceryId, ...prediction }));
}

/** Normalized catalog name -> grocery id, first entry winning a shared name. */
export function catalogIdsByName (catalog = {}) {
  const byName = {};
  Object.entries(catalog || {}).forEach(([id, entry]) => {
    const key = normalizeFoodName(entry?.name);
    if (key && !byName[key]) byName[key] = id;
  });
  return byName;
}

/**
 * A talk-through's counts -> the merge patch for `usage-log`.
 *
 * `counts` is normalized food name -> packages he described, matched with the
 * same spelling rule the talk-through uses (case and a trailing s ignored). Only foods the
 * catalog knows are logged, because only they can become a shopping row.
 */
export function readingsPatch (counts = {}, catalog = {}, now = new Date()) {
  const today = todayISO(now);
  const byName = catalogIdsByName(catalog);

  const patch = {};
  Object.entries(counts || {}).forEach(([name, count]) => {
    const id = byName[normalizeFoodName(name)];
    const n = Number(count);
    if (id && Number.isFinite(n) && n >= 0) patch[`${id}/${today}/count`] = n;
  });
  return patch;
}

/**
 * How many PACKAGES a ticked-off shopping row bought, or null.
 *
 * A row he added himself is in his own units ("1 Case"), which are the units
 * he counts in. A meal row asks in recipe units (28 oz of tomato sauce), so it
 * converts through the catalog's packageSize, rounded UP because nobody buys
 * a third of a can. Without a packageSize a meal row's amount is unknown.
 */
export function packagesBought (row = {}, entry = {}) {
  const quantity = Number(row?.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (row.source === 'manual') return quantity;
  const size = Number(entry?.packageSize);
  return Number.isFinite(size) && size > 0 ? Math.ceil(quantity / size) : null;
}

/**
 * A scanned receipt's food -> the merge patch for `usage-log`.
 *
 * `purchases` is [{ name, quantity }]; `date` is the shop's date. Matched to the
 * catalog the same way as a talk-through's counts. The existing `bought` mark
 * is kept when there is one: a row ticked off in the shop says whether he
 * added it himself, which the buying rhythm needs and a receipt cannot know.
 * The receipt's count wins, since it is what the till actually charged for.
 */
export function receiptPatch (purchases = [], catalog = {}, usageLog = {}, date) {
  const byName = catalogIdsByName(catalog);
  const patch = {};
  (purchases || []).forEach((item) => {
    const id = byName[normalizeFoodName(item?.name)];
    if (!id || !date) return;
    const n = Number(item?.quantity);
    const existing = (usageLog?.[id] || {})[date] || {};
    if (!existing.bought) patch[`${id}/${date}/bought`] = 'receipt';
    patch[`${id}/${date}/boughtCount`] = Number.isFinite(n) && n > 0 ? n : 1;
  });
  return patch;
}

/** Merge-patch keys (null = delete) for entries older than the keep window. */
export function prunePatch (usageLog = {}, now = new Date(), keepDays = USAGE_LOG_KEEP_DAYS) {
  const cutoff = addDays(todayISO(now), -keepDays);
  const patch = {};
  Object.entries(usageLog || {}).forEach(([groceryId, log]) => {
    Object.keys(log || {}).forEach((date) => {
      const iso = toISODate(date);
      if (!iso || iso < cutoff) patch[`${groceryId}/${date}`] = null;
    });
  });
  return patch;
}

/** "you go through about 12 a week" / "you buy it about every 10 days". */
export function runningLowNote (runningLow) {
  if (!runningLow) return '';
  if (runningLow.perWeek) {
    const perWeek = Number(runningLow.perWeek);
    if (perWeek >= 1) return `running low — you go through about ${Math.round(perWeek)} a week`;
    return `running low — you use about one every ${Math.round(7 / perWeek)} days`;
  }
  if (runningLow.everyDays) return `running low — you buy it about every ${Math.round(runningLow.everyDays)} days`;
  return 'running low';
}
