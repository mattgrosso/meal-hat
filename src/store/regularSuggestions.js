// "Maybe add these?" — foods that look like regulars but are not flagged as
// staples yet, offered at the top of the shopping list for a yes or a no.
//
// Matt, 2026-10-11: "a section at the top of items that ... Meal Hat thinks we
// maybe should include, and then I can approve or not ... but I don't want you
// to just guess and add them automatically."
//
// The usage log (usage.js) learns how fast the house gets through every food,
// but the shopping plan only ACTS on that for foods flagged `staple`, and very
// few are. This is how the rest get found: the evidence is shown, and he
// decides.
//
//   Yes  flags the food a staple (so shoppingPlan.js brings it back on its own
//        from then on) and puts it on this trip's list.
//   No   stamps `regularDeclinedOn` on the catalog entry, which hides it for
//        DECLINE_QUIET_DAYS. Not forever: habits change.
//
// NOTHING IS WRITTEN UNTIL HE TAPS. This is worked out at read time from what
// is already loaded, so opening the list twice changes nothing — the same
// rule that makes the plan itself safe to repeat.
//
// Pure: no Firebase, no clock beyond `now`.

import { predictRunOut, sortedEntries, RUNNING_LOW_HORIZON_DAYS } from './usage.js';
import { isOnHand } from './staples.js';
import { toISODate, fromISODate, todayISO } from './schedule.js';

// A "no" keeps it quiet for about two months.
export const DECLINE_QUIET_DAYS = 60;

// Bought from a row he added himself this many times...
export const HAND_ADDED_MIN = 3;
// ...within this many days. An old habit is not a regular.
export const HAND_ADDED_WINDOW_DAYS = 120;

// A short box at the top of the list, not a second list.
export const MAX_SUGGESTIONS = 5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysBetween = (fromIso, toIso) =>
  Math.round((fromISODate(toIso) - fromISODate(fromIso)) / MS_PER_DAY);

/** Is a "no" on this entry still in force? */
export function recentlyDeclined (entry, now = new Date()) {
  const declined = toISODate(entry?.regularDeclinedOn);
  if (!declined) return false;
  return daysBetween(declined, todayISO(now)) < DECLINE_QUIET_DAYS;
}

/**
 * Suggestions, best first: `[{ groceryId, name, runsOutOn?, perWeek?,
 * everyDays?, handAdded? }]`.
 *
 * Two kinds of evidence, the same two the plan trusts for staples:
 *
 *   1. It runs out within a week at the house's own pace (`predictRunOut`).
 *   2. He has bought it from a row he added himself at least HAND_ADDED_MIN
 *      times lately — unless the fridge says it is in the house right now.
 *
 * Skipped: staples (already handled), fridge-only foods (never shopped for),
 * anything already on the list in any form, and a recent "no".
 */
export function suggestRegulars ({
  catalog = {},
  usageLog = {},
  shoppingList = {},
  onHandUntil = {},
  mealUseById = {},
  now = new Date()
} = {}) {
  const today = todayISO(now);
  const listed = new Set(Object.values(shoppingList || {})
    .map((row) => row && row.groceryId).filter(Boolean));

  const found = [];
  Object.entries(catalog || {}).forEach(([groceryId, entry]) => {
    if (!entry || !entry.name || entry.staple || entry.fridgeOnly) return;
    if (listed.has(groceryId) || recentlyDeclined(entry, now)) return;

    const log = usageLog?.[groceryId] || {};
    const handAdded = sortedEntries(log)
      .filter((e) => e.bought === 'manual' && daysBetween(e.date, today) <= HAND_ADDED_WINDOW_DAYS)
      .length;

    const prediction = predictRunOut(log, now, mealUseById[groceryId]);
    const horizon = todayISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + RUNNING_LOW_HORIZON_DAYS));
    const runningOut = prediction && prediction.runsOutOn <= horizon;

    if (!runningOut && (handAdded < HAND_ADDED_MIN || isOnHand(entry, onHandUntil, now))) return;

    found.push({
      groceryId,
      name: entry.name,
      ...(runningOut ? { runsOutOn: prediction.runsOutOn } : {}),
      ...(prediction?.perWeek ? { perWeek: Math.round(prediction.perWeek * 10) / 10 } : {}),
      ...(prediction?.everyDays ? { everyDays: prediction.everyDays } : {}),
      ...(handAdded ? { handAdded } : {})
    });
  });

  // Running out soonest first, then the most often added by hand.
  return found
    .sort((a, b) => {
      if (a.runsOutOn && b.runsOutOn) return a.runsOutOn.localeCompare(b.runsOutOn);
      if (a.runsOutOn) return -1;
      if (b.runsOutOn) return 1;
      return (b.handAdded || 0) - (a.handAdded || 0) || a.name.localeCompare(b.name);
    })
    .slice(0, MAX_SUGGESTIONS);
}

/** Why it is being suggested, in a few words, so a bad guess shows. */
export function suggestionReason (suggestion) {
  if (!suggestion) return '';
  if (suggestion.runsOutOn && suggestion.perWeek) {
    const perWeek = Number(suggestion.perWeek);
    return perWeek >= 1
      ? `you go through about ${Math.round(perWeek)} a week and may run out soon`
      : `you use about one every ${Math.round(7 / perWeek)} days and may run out soon`;
  }
  if (suggestion.runsOutOn && suggestion.everyDays) {
    return `you buy it about every ${Math.round(suggestion.everyDays)} days`;
  }
  if (suggestion.runsOutOn) return 'may run out soon';
  return `you've added it yourself ${suggestion.handAdded} times lately`;
}

/**
 * The catalog patch (field-scoped, for `mergeDBValue` on `grocery-catalog`)
 * for a yes or a no. A yes with a known buying rhythm also sets the staple's
 * interval to it, so the fallback rule comes back at the house's own pace
 * rather than the default 60 days.
 */
export function answerPatch (suggestion, yes, now = new Date()) {
  const id = suggestion.groceryId;
  if (!yes) return { [`${id}/regularDeclinedOn`]: todayISO(now) };
  return {
    [`${id}/staple`]: true,
    [`${id}/regularDeclinedOn`]: null,
    ...(suggestion.everyDays ? { [`${id}/stapleIntervalDays`]: Math.round(suggestion.everyDays) } : {})
  };
}
