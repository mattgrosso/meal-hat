// Dates, and the bookkeeping that goes with putting a meal on one.
//
// Pulled out of DrawMeals/ShowMeals/DrawnMealSchedule, which each carried their
// own copy of the same drawnDates update. Pure functions, so this is testable
// without Firebase — the same reason ingredients.js was extracted.
//
// ── On date formats ──────────────────────────────────────────────────────────
//
// Two formats were in use at once. `assignedDate` was written with
// toDateString() ("Wed Aug 19 2026") while `drawnDates` held epoch numbers, so
// every read re-parsed a locale-shaped string and nothing could be compared
// without converting first.
//
// Calendar dates are now ISO `YYYY-MM-DD`. A dinner is a day, not an instant:
// ISO sorts lexically (so "is this upcoming?" is a string compare), survives a
// timezone change, and — the reason it matters here — lets Firebase range-query
// drawnMeals by date instead of the client downloading every meal ever drawn.
//
// Reading stays tolerant of the old shapes forever. There are years of records
// in the old format and no reason to make anyone migrate before they load.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, '0');

/**
 * Normalize anything we have ever stored — an ISO string, a Date, an epoch
 * number, or a toDateString() string — to `YYYY-MM-DD`.
 *
 * Returns null for values that aren't dates at all, so callers can decide what
 * to do rather than propagating an "Invalid Date".
 */
export function toISODate (value) {
  if (value === null || value === undefined || value === '') return null;

  // Already ISO. Return as-is rather than round-tripping through Date, which
  // would reinterpret it as UTC midnight and, west of Greenwich, hand back the
  // previous day.
  if (typeof value === 'string' && ISO_DATE.test(value)) return value;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  // Local components, not toISOString(): the stored value is a calendar day, and
  // toISOString() shifts to UTC, which moves the day for anyone not on UTC.
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * ISO date -> Date at LOCAL midnight.
 *
 * `new Date('2026-08-19')` is parsed as UTC midnight per spec, which is the
 * previous day in every negative-offset timezone. Building from components
 * avoids that.
 */
export function fromISODate (iso) {
  const normalized = toISODate(iso);
  if (!normalized) return null;

  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Today, as an ISO date, in the user's own timezone. */
export function todayISO (now = new Date()) {
  return toISODate(now);
}

/**
 * Is this drawn meal still to come? Inclusive of today — you have not eaten
 * tonight's dinner yet, and its ingredients still belong on the shopping list.
 */
export function isUpcoming (assignedDate, now = new Date()) {
  const iso = toISODate(assignedDate);
  return iso ? iso >= todayISO(now) : false;
}

/** Chronological, by calendar day. Undated entries sort last rather than throwing. */
export function compareByDate (a, b) {
  const left = toISODate(a?.assignedDate);
  const right = toISODate(b?.assignedDate);
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left < right ? -1 : 1;
}

// How many past draw dates to keep per meal.
//
// Only drawnDates[0] is ever read — it is the whole basis of the
// "drawn too recently?" check. The array was nonetheless unbounded and rewritten
// in full on every draw, so a meal in weekly rotation accumulated hundreds of
// timestamps that no code ever looked at. A short window keeps enough history to
// weight future draws by "how long since we had this" without growing forever.
export const DRAWN_DATES_KEPT = 10;

/**
 * The meal record as it should look after being drawn for `isoDate`.
 *
 * Returns a NEW object; the caller decides how to persist it. Newest date
 * first, deduped, capped. `lastDrawn` is maintained for older records that
 * still read it.
 */
export function withDrawnDate (meal, isoDate, { keep = DRAWN_DATES_KEPT } = {}) {
  const drawnOn = toISODate(isoDate);
  if (!meal || !drawnOn) return meal;

  // Existing history, normalized — these are epoch numbers on older records.
  let history = (meal.drawnDates || []).map(toISODate).filter(Boolean);

  // Older records carried only `lastDrawn`. Seed from it so a meal's first draw
  // under the new shape doesn't look like it has never been drawn.
  if (!history.length && meal.lastDrawn) {
    const seeded = toISODate(meal.lastDrawn);
    if (seeded) history = [seeded];
  }

  const drawnDates = [drawnOn, ...history.filter((date) => date !== drawnOn)].slice(0, keep);

  return { ...meal, drawnDates, lastDrawn: drawnDates[0] };
}

/**
 * Was this meal drawn too recently to come up again on `isoDate`?
 *
 * Distance is measured in whole calendar days between the most recent draw and
 * the target day, so it does not drift with clock time.
 */
export function drawnTooRecently (meal, isoDate) {
  if (!meal?.minDaysBetween) return false;

  const mostRecent = toISODate((meal.drawnDates || [])[0]) || toISODate(meal.lastDrawn);
  const target = toISODate(isoDate);
  if (!mostRecent || !target) return false;

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const days = Math.abs(Math.round((fromISODate(target) - fromISODate(mostRecent)) / MS_PER_DAY));

  return days < meal.minDaysBetween;
}

/**
 * The ISO date `days` before today — the lower bound of what gets loaded.
 *
 * Built by walking the Date's own day counter rather than subtracting
 * milliseconds, so a DST change in the window doesn't shift the answer.
 */
export function isoDaysAgo (days, now = new Date()) {
  const date = fromISODate(todayISO(now));
  date.setDate(date.getDate() - days);
  return toISODate(date);
}

/** Every calendar day from start to end, inclusive, as ISO dates. */
export function datesInRange (start, end) {
  const first = fromISODate(start);
  const last = fromISODate(end ?? start);
  if (!first || !last || last < first) return [];

  const dates = [];
  const cursor = new Date(first);
  while (cursor <= last) {
    dates.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/**
 * Which drawn meal the "next meal" highlight belongs on — its id, or null.
 *
 * Bug report (Natalie, 2026-08-24): "the highlighted green on the drawn meals
 * page is always one day ahead so right now it's highlighting Tuesday instead
 * of Monday."
 *
 * The cause was `new Date(meal.assignedDate)` on a bare 'YYYY-MM-DD', which
 * parses as UTC MIDNIGHT — 8pm the previous day in this timezone. Monday's
 * meal therefore looked like it fell on Sunday: it failed the "is it today"
 * test AND the "is it still ahead" test, so Tuesday's meal (parsing as Monday
 * 8pm, still in the future) took the highlight. Exactly one day ahead, every
 * day, all year.
 *
 * Compared as ISO strings here, which sort chronologically by themselves and
 * involve no date parsing at all — there is no timezone left to get wrong.
 * This lives in the store rather than the component so it can be tested
 * directly, which is how the bug would have been caught.
 *
 * The 6pm rule is kept: tonight's dinner stops being "next" once you have
 * presumably eaten it.
 */
export const DINNER_HOUR = 18;

export function nextMealId (meals, now = new Date()) {
  const today = todayISO(now);
  const eatenAlready = now.getHours() >= DINNER_HOUR;

  const upcoming = [...(meals || [])]
    .sort(compareByDate)
    .find((meal) => {
      const date = toISODate(meal && meal.assignedDate);
      if (!date) return false;
      return date > today || (date === today && !eatenAlready);
    });

  return upcoming ? upcoming.id : null;
}
