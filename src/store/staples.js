import { toISODate, fromISODate, todayISO } from './schedule';
import { rowCoverage } from './fridge/inHouse';

// Pantry staples — things you reliably already have, so they should not clutter
// the shopping list every time a meal happens to need them.
//
// THE SAFETY REQUIREMENT, which shapes everything here (Matt, 2026-08-19):
//
//   "in a way where I won't ever end up wishing I had olive oil but not
//    having it"
//
// So a staple is never DELETED and never silently dropped. Two rules keep that
// promise:
//
//   1. Relocated, not removed. A staple still exists as a normal shopping-list
//      row with its real quantity — it is only displayed in a separate
//      "cupboard" group instead of the main list. If any of this logic is
//      wrong, the worst case is an item in the wrong section, never a missing
//      one. You can pull one into the list at any time.
//
//   2. It comes back by itself. Staples are tracked by when they were last
//      actually bought, and once that is longer ago than the item's interval it
//      returns to the main list on its own. "Always have it" becomes "buy it
//      rarely", not "never buy it again".
//
// Never bought = due. If we have no evidence you have it, it goes on the list.

// Deliberately on the short side. Surfacing a staple you already have costs one
// glance; not surfacing one you have run out of costs a meal. Stored per
// catalog entry as `stapleIntervalDays`, so an item can override it.
export const DEFAULT_STAPLE_INTERVAL_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days since a grocery was last marked bought, or null if never. */
export function daysSincePurchase (catalogEntry, now = new Date()) {
  const last = toISODate(catalogEntry?.lastPurchased);
  if (!last) return null;

  const from = fromISODate(last);
  const to = fromISODate(todayISO(now));
  if (!from || !to) return null;

  return Math.max(Math.round((to - from) / MS_PER_DAY), 0);
}

/**
 * Is the fridge holding this food right now?
 *
 * `onHandUntil` maps a normalized food name to the LATEST expiry among its live
 * timers — see the fridge module's getter of the same name.
 *
 * THE FRIDGE MAY ONLY EVER SAY "YOU HAVE IT". It can suppress a staple, never
 * summon one. A missing timer means nothing was ever photographed, not that the
 * cupboard is bare, so absence has to fall through to the date arithmetic
 * rather than be read as evidence. Same reasoning as the scan flow, where a
 * thing missing from a photo never deletes a timer — it might just be behind
 * the milk.
 */
export function isOnHand (catalogEntry, onHandUntil = {}, now = new Date()) {
  const name = (catalogEntry?.name || '').trim().toLowerCase();
  if (!name) return false;

  const until = onHandUntil[name];
  if (!until) return false;

  const expiry = new Date(until);
  if (Number.isNaN(expiry.getTime())) return false;

  return expiry.getTime() > now.getTime();
}

/**
 * Should this staple be on the shopping list right now?
 *
 * True when it has never been bought, when we cannot tell, or when it has been
 * longer than its interval. Every uncertain case resolves to "put it on the
 * list" — that is the direction that cannot leave you short.
 *
 * The one thing that can say otherwise is the fridge, and only in the
 * suppressing direction: a live unexpired timer is positive evidence that the
 * food is physically in the house. That is what the merge bought — before it,
 * "do we still have olive oil?" was answered by a 60-day guess.
 *
 * An EXPIRED timer deliberately does not suppress. It is evidence the food was
 * here and is now past it, which argues for buying more, not less.
 */
export function stapleIsDue (catalogEntry, now = new Date(), onHandUntil = {}) {
  if (!catalogEntry) return true;

  if (isOnHand(catalogEntry, onHandUntil, now)) return false;

  const days = daysSincePurchase(catalogEntry, now);
  if (days === null) return true;

  const interval = Number(catalogEntry.stapleIntervalDays) > 0
    ? Number(catalogEntry.stapleIntervalDays)
    : DEFAULT_STAPLE_INTERVAL_DAYS;

  return days >= interval;
}

/**
 * Split shopping-list rows into what to buy and what you already have.
 *
 * TWO REASONS a row can move, and they are not equally strong:
 *
 *   1. The house holds enough of it. A live timer is positive evidence that
 *      the food is physically here, and `timers` carries the quantities so
 *      "enough" can be answered properly — 10 slices of bread against a
 *      20-slice loaf is covered; 3 cups of cheddar against one 2-cup block is
 *      not, and that row stays on the list. This applies to EVERY food, which
 *      is the 2026-09-20 change: it used to apply only to staples, so a list
 *      with seven foods sitting in the fridge asked you to buy all seven.
 *
 *   2. It is a staple bought recently enough. Date arithmetic, and a much
 *      weaker claim — it is a guess about a cupboard nobody has looked in.
 *
 * Nothing is discarded either way. A moved row keeps its quantity and can be
 * pulled back onto the list in one tap, so the worst case here is a row in the
 * wrong section, never a missing one.
 */
export function partitionStaples (rows, catalog = {}, now = new Date(), onHandUntil = {}, timers = {}) {
  const list = [];
  const cupboard = [];

  (rows || []).forEach((row) => {
    if (!row) return;

    const entry = catalog[row.groceryId];

    // The house has enough of this, whatever kind of food it is. Checked
    // before the staple rules, because it is the stronger evidence: somebody
    // described this food as being here, rather than a date implying it.
    const coverage = entry ? rowCoverage(row, entry, timers, now) : null;
    if (coverage?.covered) {
      cupboard.push({
        ...row,
        onHand: true,
        packagesOnHand: coverage.onHand,
        packagesNeeded: coverage.needed,
        assumedPackageSize: coverage.assumedPackageSize,
        daysSincePurchase: daysSincePurchase(entry, now)
      });
      return;
    }

    if (!entry || !entry.staple) {
      // Partly covered: it stays on the list, and carries what the house holds
      // so the row can say "you have 1 of the 2 you need" instead of silently
      // asking for the whole amount again.
      list.push(coverage && coverage.onHand > 0 ? { ...row, partlyOnHand: coverage.onHand } : row);
      return;
    }

    if (stapleIsDue(entry, now, onHandUntil)) {
      // Carry why it resurfaced, so the row can say so rather than just
      // reappearing without explanation.
      list.push({ ...row, stapleDue: true, daysSincePurchase: daysSincePurchase(entry, now) });
      return;
    }

    cupboard.push({
      ...row,
      daysSincePurchase: daysSincePurchase(entry, now),
      // "The fridge has one" and "you bought one recently" are different
      // reassurances, and the second is much weaker. Saying which one is
      // holding an item back lets a wrong call be spotted.
      onHand: isOnHand(entry, onHandUntil, now)
    });
  });

  return { list, cupboard };
}
