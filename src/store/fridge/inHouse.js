// What the fridge is allowed to say about the shopping list.
//
// THE GAP THIS CLOSES (found 2026-09-20). The fridge could already suppress a
// shopping-list row — but only for a food flagged `staple`, and exactly 2 of
// the 126 groceries were. So on a real week's list, seven rows (Cheddar,
// American Cheese Slices, Hamburger Buns, Garlic, Sandwich Bread, Tortellini,
// Lettuce) sat there asking to be bought while live timers for all seven sat
// in the fridge. The inventory existed and the list ignored it.
//
// A staple was never the right gate. "Do I already have this?" is the same
// question for olive oil and for lettuce; `staple` only ever meant "and don't
// nag me about it when I don't".
//
// THE DIRECTION RULE IS UNCHANGED AND NOT NEGOTIABLE: the fridge may say YOU
// HAVE IT and nothing else. A food with no timer is a food nobody has
// described, not a food you are out of — so absence falls straight through to
// the existing behaviour and the row stays on the list. Same reasoning as
// every other read of this data.
//
// AN EXPIRED TIMER DOES NOT SUPPRESS. It is evidence the food was here and has
// since gone off, which argues for buying more, not less.

// The unit problem is `consume.js`'s, and the answer is the same one: a timer
// holds PACKAGES, a shopping row asks in whatever unit the recipe uses, and
// `packageSize` is the bridge between them. 10 slices of sandwich bread
// against a 20-slice loaf is half a package, and one loaf covers it.
const EPSILON = 1e-6;

const asPositiveNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const normalizeName = (name) => String(name || '').trim().toLowerCase();

/**
 * Live timers for one food, newest-expiring last. Expired ones are dropped
 * here so no caller has to remember to.
 */
export function liveTimersFor (name, timers = {}, now = new Date()) {
  const wanted = normalizeName(name);
  if (!wanted) return [];

  return Object.entries(timers || {})
    .map(([id, timer]) => ({ id, ...timer }))
    .filter((timer) => timer && normalizeName(timer.title) === wanted)
    .filter((timer) => {
      const at = new Date(timer.expiryDate).getTime();
      return !Number.isNaN(at) && at > now.getTime();
    })
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
}

/**
 * How much of this food the house holds, in packages.
 *
 * A timer with no `quantity` is one package — that is what a timer has always
 * meant, and every timer created before quantities existed relies on it.
 */
export function packagesOnHand (name, timers = {}, now = new Date()) {
  return liveTimersFor(name, timers, now)
    .reduce((total, timer) => total + (asPositiveNumber(timer.quantity) ?? 1), 0);
}

/**
 * Can what is in the house cover what this row is asking for?
 *
 * Returns the numbers as well as the verdict, because a row that is PARTLY
 * covered has to stay on the list and should say why: 3 cups of cheddar
 * against a 2-cup block is one and a half packages, and the one block in the
 * fridge does not cover it. Suppressing that row would leave a meal short,
 * which is the one failure mode this whole area is built to avoid.
 *
 * `packageSize` missing is treated as "one package covers it" — the same
 * assumption `consume.js` makes, flagged the same way so a screen can say so.
 * It errs toward suppressing, so it is deliberately only ever a reason to move
 * a row into a section the user can see and undo, never to delete one.
 */
export function rowCoverage (row, entry, timers = {}, now = new Date()) {
  const name = entry?.name;
  const onHand = packagesOnHand(name, timers, now);

  if (!name || onHand <= 0) {
    return { onHand: 0, needed: null, covered: false, assumedPackageSize: false };
  }

  const wanted = asPositiveNumber(row?.quantity);
  const packageSize = asPositiveNumber(entry.packageSize);

  // A row with no usable quantity is covered by having ANY of the food. The
  // alternative — refusing to suppress — would keep a row on the list that the
  // fridge demonstrably holds, on a technicality about its units.
  if (wanted === null) {
    return { onHand, needed: null, covered: true, assumedPackageSize: packageSize === null };
  }

  const needed = packageSize === null ? 1 : wanted / packageSize;

  return {
    onHand,
    needed,
    covered: onHand + EPSILON >= needed,
    assumedPackageSize: packageSize === null
  };
}
