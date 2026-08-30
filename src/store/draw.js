import { toISODate, fromISODate, drawnTooRecently } from './schedule';

// Choosing which meal comes out of the hat.
//
// This used to be a flat `Math.random()` across everything eligible, so a meal
// you had a fortnight ago was exactly as likely as one you have not eaten since
// spring. `minDaysBetween` was the only lever, and it can only say "not yet" —
// it cannot say "this one is overdue".
//
// The weighting nudges rather than dictates. It is still a hat: the least
// overdue meal never drops out of contention, it just comes up less often. A
// strict "longest since last drawn wins" would turn the schedule into a fixed
// rotation, which is the opposite of the point.

// Weight is measured in how OVERDUE a meal is relative to its own cadence,
// not in absolute days.
//
// That respects what minDaysBetween means. If you set 30 days on something, you
// want it roughly monthly; at 35 days it is barely due. A 7-day meal at 10 days
// is further past its own interval and should be likelier — even though fewer
// days have passed. Weighting by raw days-since would systematically favour the
// meals you deliberately marked as rare.
const MAX_WEIGHT = 3;

// For meals with no minDaysBetween set. They are always eligible (
// drawnTooRecently returns false without one), so they need *some* cadence to
// be measured against or they cannot be compared with anything.
const NEUTRAL_INTERVAL_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween (fromISO, toISO) {
  const from = fromISODate(fromISO);
  const to = fromISODate(toISO);
  if (!from || !to) return null;

  return Math.abs(Math.round((to - from) / MS_PER_DAY));
}

/**
 * How strongly this meal wants to be drawn on `isoDate`. Always > 0, so
 * nothing is ever excluded by weighting alone — that is filtering's job.
 */
export function mealWeight (meal, isoDate) {
  if (!meal) return 0;

  // WHEN IT WAS ACTUALLY COOKED beats when it was drawn.
  //
  // Being drawn is a plan; being cooked is what happened. A meal drawn onto
  // Tuesday and then not made — takeaway, leftovers, a night out — used to
  // count as recent anyway and stayed unlikely for its whole interval, so the
  // meals most often skipped were the ones the hat kept skipping. Checking a
  // meal off records `lastCooked`, and that is the honest input.
  //
  // Falls back to the drawn dates, so every meal that predates check-off
  // behaves exactly as it did before.
  const lastCooked = toISODate(meal.lastCooked);
  const lastDrawn = lastCooked ||
    toISODate((meal.drawnDates || [])[0]) ||
    toISODate(meal.lastDrawn);

  // Never drawn, or a date we cannot read: as overdue as it gets. A meal added
  // and never eaten should be a strong candidate, not an average one.
  if (!lastDrawn) return MAX_WEIGHT;

  const days = daysBetween(lastDrawn, isoDate);
  if (days === null) return MAX_WEIGHT;

  const interval = Number(meal.minDaysBetween) > 0 ? Number(meal.minDaysBetween) : NEUTRAL_INTERVAL_DAYS;

  // Capped so a meal neglected for two years cannot swamp the draw and make it
  // deterministic. Floored just above zero so a meal is never unpickable.
  return Math.max(Math.min(days / interval, MAX_WEIGHT), 0.01);
}

/**
 * Pick one meal, weighted. `random` is injectable so the choice can be tested
 * without relying on Math.random.
 */
export function pickWeightedMeal (meals, isoDate, { random = Math.random } = {}) {
  const candidates = (meals || []).filter(Boolean);
  if (!candidates.length) return null;

  const weights = candidates.map((meal) => mealWeight(meal, isoDate));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  // Degenerate case — fall back to uniform rather than returning nothing.
  if (!(total > 0)) return candidates[Math.floor(random() * candidates.length)] || null;

  let ticket = random() * total;
  for (let i = 0; i < candidates.length; i++) {
    ticket -= weights[i];
    if (ticket < 0) return candidates[i];
  }

  // Floating-point drift only; the loop above normally returns.
  return candidates[candidates.length - 1];
}

/**
 * Everything that could go on `isoDate`: not drawn too recently, and not
 * already used elsewhere in this same draw.
 */
export function eligibleMeals (meals, isoDate, alreadyUsedIds = new Set()) {
  return Object.values(meals || {})
    .filter(Boolean)
    .filter((meal) => !drawnTooRecently(meal, isoDate) && !alreadyUsedIds.has(meal.id));
}
