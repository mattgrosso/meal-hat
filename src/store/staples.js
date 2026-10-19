import { toISODate, fromISODate, todayISO } from './schedule';
import pluralize from 'pluralize';
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

    // Added because it is about to run out (store/usage.js). The fridge
    // holding SOME of it is exactly why it was added — a few cans left — so
    // coverage must not move it back off the list. Add-only, by design.
    if (row.runningLow) {
      list.push(row);
      return;
    }

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
      //
      // With the arithmetic, not just the verdict (2026-09-28): "you have some,
      // not enough" beside 3 cups of mozzarella gave no way to tell a real
      // shortfall from a fridge that had simply miscounted. `partlyShort` is
      // whole packages still to buy, which is the number the shop needs.
      if (coverage && coverage.onHand > 0) {
        const packageSize = Number(entry?.packageSize) > 0 ? Number(entry.packageSize) : null;
        list.push({
          ...row,
          partlyOnHand: coverage.onHand,
          partlyShort: coverage.needed === null ? null : Math.max(1, Math.ceil(coverage.needed - coverage.onHand - 1e-6)),
          partlyAmount: packageSize === null ? null : coverage.onHand * packageSize
        });
        return;
      }
      list.push(row);
      return;
    }

    // The plan (shoppingPlan.js) has already asked whether this regular is
    // running out, with the usage rate and not just the date; `runningLow`
    // above is its yes, `stocked` its no. The date rule below is only for a
    // row the plan has not seen yet.
    if (!row.stocked && stapleIsDue(entry, now, onHandUntil)) {
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

// Packages, in the only unit a person actually pictures: whole things,
// and halves when it really is a half. 1.5 blocks of cheddar is "1½"; a
// computed 0.6667 is not something to read out loud, so it rounds.
export function formatPackages (count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return 'none';
  const whole = Math.floor(n + 1e-6);
  const rest = n - whole;
  const half = rest > 0.25 && rest < 0.75;
  if (whole === 0) return half ? 'half a package' : 'less than a package';
  const label = `${whole}${half ? '½' : ''}`;
  return `${label} package${whole > 1 || half ? 's' : ''}`;
}

const round1 = (n) => Math.round(Number(n) * 10) / 10;
const withUnits = (n, units) => `${round1(n)}${units ? ` ${pluralize(units, n)}` : ''}`;

/**
 * What a partly-covered row says: how much MORE to buy, and the sum behind it.
 *
 * Matt, 2026-10-18: "I clearly say two bags of shredded mozzarella, and every
 * week you add mozzarella to the list." The two bags were heard and counted
 * every time. The meals ahead wanted 5 cups against 4 on the shelf, so the row
 * stayed — correctly — but it read "5 cups", the whole amount, with the two
 * bags tucked in a grey note. It looked exactly like the bags had been missed.
 * So the amount is the shortfall, and the note shows the subtraction, which is
 * also what makes a wrong package size visible ("you have 2 packages (4 cups)"
 * beside bags that are plainly bigger than that).
 */
export function partlyCoveredText (row = {}) {
  const short = Number(row.partlyShort);
  const held = formatPackages(row.partlyOnHand);
  const heldAmount = Number(row.partlyAmount) > 0 ? ` (${withUnits(row.partlyAmount, row.units)})` : '';
  const wanted = Number(row.quantity) > 0 ? withUnits(row.quantity, row.units) : null;
  return {
    amount: short > 0 ? `${short} more package${short > 1 ? 's' : ''}` : null,
    note: `you have ${held}${heldAmount}${wanted ? `, meals need ${wanted}` : ' — not enough'}`
  };
}
