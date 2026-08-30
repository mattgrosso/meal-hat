// Cooking a meal eats what is in the fridge.
//
// THE UNIT PROBLEM, which shapes all of this.
//
// A meal's ingredient is `{ groceryItemId, quantity }` with no unit of its own —
// the unit lives on the catalog entry. And across Matt's real meals those units
// are not one kind of thing:
//
//   1  Ziti          (Pound)  — a package count
//   2  Mozzarella    (cups)   — a recipe measure
//   13 Ricotta       (Oz)     — a recipe measure
//   28 Tomato Sauce  (can)    — 28 OUNCES, mislabelled as cans
//   24 Cottage cheese ()      — no unit recorded at all
//
// So a timer cannot simply hold "quantity" and have meals subtract from it.
// Buying one can of tomato sauce and then subtracting 28 would clear the timer
// on a can that was exactly the right size.
//
// The bridge is ONE NUMBER PER FOOD: `packageSize`, how much of that food comes
// in one package, expressed in whatever unit that food's recipes already use.
// Tomato Sauce is 28. Mozzarella is 2. Ricotta is 15. Anything already recorded
// as a package count (a Box of orzo, a Bottle of vinegar) is 1 and needs no
// thought at all.
//
// A timer then holds PACKAGES — the physical things in the fridge — and a meal
// needing 28 units of a 28-unit can eats exactly one. No meal has to be
// re-recorded, and the inconsistency above stops mattering, because every
// comparison happens within a single food's own unit.
//
// When packageSize is unknown the plan assumes one package and SAYS SO. It is a
// guess, and a guess that clears a timer should be visible before it happens,
// not explained afterwards.

// Fridge order: use the food that dies first.
const bySoonestExpiry = (a, b) => new Date(a.expiryDate) - new Date(b.expiryDate);

const asPositiveNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Floating point: 0.1 + 0.2 arithmetic would leave timers holding 1e-16 of a
// package forever, which reads as "still have some" and never clears.
const EPSILON = 1e-6;
const tidy = (n) => {
  const rounded = Math.round(n * 1000) / 1000;
  return Math.abs(rounded) < EPSILON ? 0 : rounded;
};

/**
 * What would cooking this meal do to the fridge?
 *
 * Pure — no store, no Firebase, no clock beyond what is passed in. Returns a
 * plan for a person to confirm, never a write. Nothing here decides anything on
 * its own, which is the same rule the scan flow follows.
 */
export function planMealConsumption ({ meal, catalog = {}, timers = {} } = {}) {
  const uses = [];
  const missing = [];

  const timerList = Object.entries(timers || {})
    .map(([id, timer]) => ({ id, ...timer }))
    .filter((t) => t && t.title);

  (meal?.ingredients || []).forEach((ingredient) => {
    const entry = catalog[ingredient?.groceryItemId];
    if (!entry || !entry.name) return;

    const needed = asPositiveNumber(ingredient.quantity);
    if (needed === null) return;

    const packageSize = asPositiveNumber(entry.packageSize);
    // No package size recorded: assume the meal uses one whole package. Flagged,
    // because it is a guess and it may be what clears the timer.
    const packagesNeeded = packageSize === null ? 1 : needed / packageSize;

    const name = entry.name.trim().toLowerCase();
    const candidates = timerList
      .filter((t) => String(t.title).trim().toLowerCase() === name)
      .sort(bySoonestExpiry);

    if (!candidates.length) {
      // The fridge has no record of this food. That is NOT evidence you lack
      // it — nothing may have been photographed — so this is reported, never
      // acted on.
      missing.push({
        groceryId: entry.id,
        name: entry.name,
        needed,
        units: entry.defaultUnits || ''
      });
      return;
    }

    let remaining = packagesNeeded;
    for (const timer of candidates) {
      if (remaining <= EPSILON) break;

      const held = asPositiveNumber(timer.quantity) ?? 1;
      const taken = Math.min(held, remaining);
      const after = tidy(held - taken);

      uses.push({
        timerId: timer.id,
        name: timer.title,
        before: held,
        after,
        taken: tidy(taken),
        clears: after <= 0,
        assumedPackageSize: packageSize === null,
        units: entry.defaultUnits || ''
      });

      remaining = tidy(remaining - taken);
    }

    // Wanted more than the fridge holds. Clamped rather than carried: a
    // negative quantity is not a thing you can have, and the shortfall is worth
    // saying out loud so it can be bought.
    if (remaining > EPSILON) {
      missing.push({
        groceryId: entry.id,
        name: entry.name,
        needed,
        short: true,
        units: entry.defaultUnits || ''
      });
    }
  });

  return {
    uses,
    missing,
    clearing: uses.filter((u) => u.clears).length,
    assuming: uses.filter((u) => u.assumedPackageSize).length
  };
}
