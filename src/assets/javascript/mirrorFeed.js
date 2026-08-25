// Magic Mirror feed.
//
// Matt's Magic Mirror (a hallway display, no keyboard, no login) used to read
// this hat over unauthenticated REST:
//
//   GET https://meal-hat-default-rtdb.firebaseio.com/mattgrosso-gmail-com.json
//
// The 2026-08-19 lockdown ended that — correctly; those keys are email
// addresses and the node is the whole household's meals, groceries and
// shopping list. The mirror went silent, and because its fetch is inside a
// try/catch that leaves `upcomingMeals` empty, the panel simply vanished
// rather than complaining.
//
// Rather than reopening the hat, Meal Hat PUBLISHES a few hundred bytes of
// exactly what the mirror renders to mirrorFeed/<hat>/<secret>, which the
// rules make world-readable at the SECRET level only. No credentials live on
// the mirror, and the hat itself stays shut.
//
// Same shape as Cinema Roll's feed (src/assets/javascript/mirrorFeed.js over
// there), for the same reason and after the same break.

import { toISODate, todayISO, compareByDate } from '../../store/schedule.js';

// How far ahead to publish.
//
// The mirror only ever renders three meals, so it is tempting to publish
// three. Don't: this feed is a SNAPSHOT of a moving schedule, refreshed only
// when someone opens the app or draws. Publishing three means that three days
// after the last draw the mirror has nothing left to show, even though the
// schedule it is describing runs another fortnight.
//
// A three-week window costs a couple of KB and keeps the mirror correct for as
// long as the schedule actually extends. The mirror re-filters by date on
// every refresh, so a stale feed degrades to showing less, never to showing
// yesterday's dinner.
export const FEED_WINDOW_DAYS = 21;

function isoDaysFromNow (days, now) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/**
 * Build the mirror's payload from a hat's schedule.
 *
 * `drawnMeals` is the raw drawnMeals collection (array or the keyed object
 * Firebase stores); `meals` likewise for the hat's meal catalog.
 *
 * Shape published:
 *   {
 *     updatedAt,
 *     upcoming: [{ assignedDate: 'YYYY-MM-DD', meal: { id, name } }]
 *   }
 *
 * The nesting under `meal` is deliberate: it is the shape the mirror's
 * Meals.vue already consumes (`meal.meal.name`), so the mirror needed no
 * component changes to switch over to this.
 */
export function buildMirrorFeed (drawnMeals, meals, { now = Date.now(), windowDays = FEED_WINDOW_DAYS } = {}) {
  const catalog = new Map(
    Object.values(meals || {})
      .filter((meal) => meal?.id != null)
      .map((meal) => [String(meal.id), meal])
  );

  const today = todayISO(new Date(now));
  const horizon = isoDaysFromNow(windowDays, new Date(now));

  const upcoming = Object.values(drawnMeals || {})
    .map((drawn) => ({ drawn, iso: toISODate(drawn?.assignedDate) }))
    // Inclusive of today — you have not eaten tonight's dinner yet, which is
    // the same call isUpcoming() makes for the shopping list.
    .filter(({ iso }) => iso && iso >= today && iso <= horizon)
    .map(({ drawn, iso }) => ({ drawn, iso, meal: catalog.get(String(drawn.mealId)) }))
    // A drawn record whose meal has since been deleted from the hat would
    // render as a blank line on the mirror. Drop it here rather than shipping
    // a name-less entry and hoping the display copes.
    .filter(({ meal }) => meal && typeof meal.name === 'string' && meal.name.trim())
    .map(({ iso, meal }) => ({
      assignedDate: iso,
      meal: { id: meal.id, name: meal.name }
    }))
    .sort(compareByDate);

  return { updatedAt: now, upcoming };
}
