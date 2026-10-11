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
//
// UNLESS SOMEBODY HAS SAID IT IS HERE SINCE (2026-09-28). A talk-through that
// mentions a food past its date stamps the timer `seenAt` and leaves the
// expiry alone — the wall still shows it past date, so somebody looks at it.
// But "we have seven hamburger buns" is a person standing at the cupboard, and
// a list that asks for buns anyway is the exact complaint: "things that I
// definitely listed... still ended up on the shopping list". The next
// talk-through that does not mention it removes it, as for any other timer.

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
 * here so no caller has to remember to — except one somebody has said is
 * still here since it expired (see `seenAt` above).
 */
export function liveTimersFor (name, timers = {}, now = new Date()) {
  const wanted = normalizeName(name);
  if (!wanted) return [];

  return Object.entries(timers || {})
    .map(([id, timer]) => ({ id, ...timer }))
    .filter((timer) => timer && normalizeName(timer.title) === wanted)
    .filter((timer) => {
      const at = new Date(timer.expiryDate).getTime();
      if (Number.isNaN(at)) return false;
      if (at > now.getTime()) return true;
      const seen = new Date(timer.seenAt).getTime();
      return !Number.isNaN(seen) && seen >= at;
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

/**
 * Normalized food name -> the latest date it counts as in the house, across
 * its timers. Feeds the staple rules (`isOnHand`). A timer somebody has said
 * is here since it expired counts as here, the same as `liveTimersFor` — so
 * the regulars and the meal rows read the house the same way.
 */
export function onHandUntilFrom (timers = {}) {
  const out = {};
  Object.values(timers || {}).forEach((timer) => {
    const name = normalizeName(timer?.title);
    if (!name || !timer.expiryDate) return;
    const expiry = new Date(timer.expiryDate).getTime();
    if (Number.isNaN(expiry)) return;
    const seen = new Date(timer.seenAt).getTime();
    const until = !Number.isNaN(seen) && seen >= expiry ? '9999-12-31T00:00:00.000Z' : timer.expiryDate;
    if (!out[name] || new Date(until) > new Date(out[name])) out[name] = until;
  });
  return out;
}

// Plural-blind, like the talk-through: "Hot Dog Buns" on the card and "hot
// dog bun" on a receipt are one food.
const foodKey = (name) => {
  const lower = normalizeName(name);
  return lower.endsWith('s') ? lower.slice(0, -1) : lower;
};

/**
 * Where an incoming food goes: onto the card already holding it, or (null) a
 * new card. Returns `{ id, title, changes, detail }` for a top-up.
 *
 * Several cards for one food: the one going off soonest takes it, so the
 * food converges on one card instead of growing more.
 */
export function topUpPlan (incoming = {}, timers = {}, now = new Date()) {
  const key = foodKey(incoming.title);
  if (!key) return null;
  const adding = asPositiveNumber(incoming.quantity) ?? 1;

  const cards = Object.entries(timers || {})
    .map(([id, timer]) => ({ id, ...timer }))
    .filter((timer) => timer && foodKey(timer.title) === key)
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
  if (!cards.length) return null;

  const live = liveTimersFor(cards[0].title, Object.fromEntries(cards.map((c) => [c.id, c])), now);
  if (!live.length) {
    // Everything on file for it has gone off and nobody has said otherwise:
    // the new food replaces it, on the card it already has.
    const card = cards[0];
    return {
      id: card.id,
      title: card.title,
      changes: {
        expiryDate: incoming.expiryDate,
        quantity: adding > 1 ? adding : null,
        seenAt: null,
        ...(incoming.shelfStable ? { shelfStable: true } : {})
      },
      detail: `replaced, ${adding}`
    };
  }

  const card = live[0];
  const had = asPositiveNumber(card.quantity) ?? 1;
  // A card only alive because somebody said it was here after its date
  // (`seenAt`) must not swallow fresh food under that old date — a new carton
  // of milk would arrive already expired. The fresh date wins.
  const pastDate = new Date(card.expiryDate).getTime() <= now.getTime();
  return {
    id: card.id,
    title: card.title,
    changes: {
      quantity: had + adding,
      ...(pastDate ? { expiryDate: incoming.expiryDate, seenAt: null } : {})
    },
    detail: `${had} → ${had + adding}`
  };
}
