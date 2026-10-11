import { describe, it, expect } from 'vitest';
import { planShoppingList, regularDue, mealRowId, stockRowId } from '../../src/store/shoppingPlan.js';
import { partitionStaples } from '../../src/store/staples.js';
import { onHandUntilFrom, topUpPlan } from '../../src/store/fridge/inHouse.js';

// Matt, 2026-10-11: "one side is what we have, one side is what we need" —
// worked out when the list is opened, safe to open twice.

const NOW = new Date(2026, 9, 11, 13, 0);
const TODAY = '2026-10-11';

const catalog = {
  buns: { id: 'buns', name: 'Hamburger Buns', packageSize: 8 },
  beef: { id: 'beef', name: 'Beef patties', packageSize: 4 },
  coke: { id: 'coke', name: 'Diet coke', staple: true, defaultUnits: 'Case', lastPurchased: '2026-10-05' },
  oil: { id: 'oil', name: 'Olive Oil', staple: true, packageSize: 25, lastPurchased: '2026-10-05' },
  flour: { id: 'flour', name: 'Flour', staple: true, lastPurchased: '2026-10-01' },
  ketchup: { id: 'ketchup', name: 'Ketchup' }
};
const meals = {
  burgers: { id: 'burgers', ingredients: [{ groceryItemId: 'buns', quantity: 8 }, { groceryItemId: 'beef', quantity: 4 }] },
  pasta: { id: 'pasta', ingredients: [{ groceryItemId: 'oil', quantity: 1 }] }
};
const getMeal = (id) => meals[id];
const drawn = (mealId, assignedDate) => ({ id: `${mealId}-${assignedDate}`, mealId, assignedDate });

// Apply a plan's updates the way Firebase update() would.
const apply = (stored, updates) => {
  const next = { ...stored };
  Object.entries(updates).forEach(([id, row]) => {
    if (row === null) delete next[id];
    else next[id] = row;
  });
  return next;
};

const plan = (over = {}) => planShoppingList({
  stored: {},
  drawnMeals: [drawn('burgers', '2026-10-13')],
  getMeal,
  catalog,
  now: NOW,
  ...over
});

describe('planShoppingList — need', () => {
  it('lists the ingredients of meals from today on, under fixed ids', () => {
    const { rows } = plan();
    expect(rows[mealRowId('buns')]).toMatchObject({ groceryId: 'buns', quantity: 8, source: 'meal', purchased: false });
    expect(rows[mealRowId('beef')]).toMatchObject({ quantity: 4 });
  });

  it('drops meals already eaten (the stale buns on 2026-10-11)', () => {
    const first = plan({ drawnMeals: [drawn('burgers', '2026-10-10')] });
    expect(first.rows).toEqual({});
  });

  it('includes a Learn to Cook night that carries its own ingredients', () => {
    const lesson = { id: 'l', assignedDate: '2026-10-12', manual: true, ingredients: [{ groceryItemId: 'ketchup', quantity: 1 }] };
    expect(plan({ drawnMeals: [lesson] }).rows[mealRowId('ketchup')]).toBeTruthy();
  });
});

describe('planShoppingList — opening it twice', () => {
  it('writes nothing the second time', () => {
    const first = plan();
    const second = plan({ stored: apply({}, first.updates) });
    expect(second.updates).toEqual({});
  });

  it('keeps a tick made at the store', () => {
    const first = plan();
    const stored = apply({}, first.updates);
    stored[mealRowId('buns')] = { ...stored[mealRowId('buns')], purchased: true, purchasedOn: TODAY };
    const again = plan({ stored });
    expect(again.updates).toEqual({});
    expect(again.rows[mealRowId('buns')].purchased).toBe(true);
    // And the next day too, while the meal is still coming.
    const tomorrow = plan({ stored: apply(stored, again.updates), now: new Date(2026, 9, 12, 9) });
    expect(tomorrow.rows[mealRowId('buns')].purchased).toBe(true);
  });

  it('reopens a ticked item when a new draw needs more of it', () => {
    const stored = apply({}, plan().updates);
    stored[mealRowId('buns')] = { ...stored[mealRowId('buns')], purchased: true, purchasedOn: TODAY };
    const more = plan({ stored, drawnMeals: [drawn('burgers', '2026-10-13'), drawn('burgers', '2026-10-16')] });
    expect(more.rows[mealRowId('buns')]).toMatchObject({ quantity: 16, purchased: false });
  });

  it('never touches a row he added himself and has not bought', () => {
    const stored = { mine: { id: 'mine', groceryId: 'ketchup', quantity: 1, source: 'manual', purchased: false } };
    const result = plan({ stored });
    expect(result.updates.mine).toBeUndefined();
    expect(result.rows.mine).toBeTruthy();
  });

  it('keeps today\'s ticked hand-added rows, clears earlier ones', () => {
    const stored = {
      today: { id: 'today', groceryId: 'ketchup', source: 'manual', purchased: true, purchasedOn: TODAY },
      old: { id: 'old', groceryId: 'ketchup', source: 'manual', purchased: true, purchasedOn: '2026-10-07' },
      legacy: { id: 'legacy', groceryId: 'ketchup', source: 'manual', purchased: true }
    };
    const { updates } = plan({ stored });
    expect(updates.today).toBeUndefined();
    expect(updates.old).toBeNull();
    expect(updates.legacy).toBeNull();
  });

  it('replaces old uuid meal rows and talk-through running-low rows', () => {
    const stored = {
      'uuid-1': { id: 'uuid-1', groceryId: 'buns', quantity: 11, source: 'meal', purchased: false },
      'uuid-2': { id: 'uuid-2', groceryId: 'ketchup', quantity: 1, source: 'manual', purchased: false, runningLow: { runsOutOn: '2026-10-07' } }
    };
    const { updates, rows } = plan({ stored });
    expect(updates['uuid-1']).toBeNull();
    expect(updates['uuid-2']).toBeNull();
    expect(rows[mealRowId('buns')].quantity).toBe(8);
  });
});

describe('planShoppingList — regulars', () => {
  // Diet Coke: 10 counted on the 1st, 3 on the 8th → a can a day, out on the 11th.
  const cokeLog = { '2026-10-01': { count: 10 }, '2026-10-08': { count: 3 } };

  it('adds a regular about to run out, saying how fast it goes', () => {
    const { rows } = plan({ drawnMeals: [], usageLog: { coke: cokeLog } });
    expect(rows[stockRowId('coke')]).toMatchObject({ source: 'stock', units: 'Case', runningLow: { perWeek: 7 } });
  });

  it('leaves out a regular with plenty left', () => {
    const log = { '2026-10-01': { count: 30 }, '2026-10-08': { count: 23 } };
    expect(plan({ drawnMeals: [], usageLog: { coke: log } }).rows[stockRowId('coke')]).toBeUndefined();
  });

  it('does not ask again for a regular ticked off today', () => {
    const stored = apply({}, plan({ drawnMeals: [], usageLog: { coke: cokeLog } }).updates);
    stored[stockRowId('coke')] = { ...stored[stockRowId('coke')], purchased: true, purchasedOn: TODAY };
    const again = plan({ stored, drawnMeals: [], usageLog: { coke: { ...cokeLog, [TODAY]: { bought: 'manual', boughtCount: 1 } } } });
    expect(again.rows[stockRowId('coke')]).toMatchObject({ purchased: true });
    expect(again.updates[stockRowId('coke')]).toBeUndefined();
  });

  it('does not duplicate a regular he already added by hand', () => {
    const stored = { mine: { id: 'mine', groceryId: 'coke', quantity: 2, source: 'manual', purchased: false } };
    expect(plan({ stored, drawnMeals: [], usageLog: { coke: cokeLog } }).rows[stockRowId('coke')]).toBeUndefined();
  });

  it('a regular nobody has seen and not bought for its interval comes back', () => {
    const flour = { ...catalog.flour, lastPurchased: '2026-07-01' };
    const { rows } = plan({ drawnMeals: [], catalog: { flour } });
    expect(rows[stockRowId('flour')]).toBeTruthy();
  });

  it('a regular in the kitchen snapshot is not asked for', () => {
    const flour = { ...catalog.flour, lastPurchased: '2026-07-01' };
    const onHandUntil = onHandUntilFrom({ t: { title: 'Flour', expiryDate: '2027-06-01T00:00:00Z' } });
    expect(plan({ drawnMeals: [], catalog: { flour }, onHandUntil }).rows[stockRowId('flour')]).toBeUndefined();
  });

  it('a regular a meal also needs is one row, marked running low', () => {
    const oilLog = { '2026-10-01': { count: 2 }, '2026-10-08': { count: 1 } };
    const { rows } = plan({ drawnMeals: [drawn('pasta', '2026-10-13')], usageLog: { oil: oilLog } });
    expect(rows[stockRowId('oil')]).toBeUndefined();
    expect(rows[mealRowId('oil')].runningLow).toBeTruthy();
  });

  it('a regular a meal needs, with plenty left, sits in the cupboard', () => {
    const oilLog = { '2026-09-01': { count: 3 }, '2026-10-08': { count: 2 } };
    const { rows } = plan({ drawnMeals: [drawn('pasta', '2026-10-13')], usageLog: { oil: oilLog } });
    expect(rows[mealRowId('oil')].stocked).toBe(true);
    const { list, cupboard } = partitionStaples(Object.values(rows), catalog, NOW, {}, {});
    expect(cupboard.map((r) => r.groceryId)).toContain('oil');
    expect(list.map((r) => r.groceryId)).not.toContain('oil');
  });

  it('ignores foods that are not regulars, however low', () => {
    const log = { '2026-10-01': { count: 1 }, '2026-10-08': { count: 0 } };
    expect(plan({ drawnMeals: [], usageLog: { ketchup: log } }).rows).toEqual({});
  });
});

describe('the house side, subtracted when the list is drawn', () => {
  it('a meal row the fridge covers goes to "already have"', () => {
    const { rows } = plan();
    const timers = { a: { title: 'Hamburger Buns', quantity: 2, expiryDate: '2026-10-20T00:00:00Z' } };
    const { list, cupboard } = partitionStaples(Object.values(rows), catalog, NOW, onHandUntilFrom(timers), timers);
    expect(cupboard.map((r) => r.groceryId)).toEqual(['buns']);
    expect(list.map((r) => r.groceryId)).toEqual(['beef']);
  });

  it('order does not matter: the same inputs give the same list', () => {
    const timers = { a: { title: 'Beef patties', quantity: 1, expiryDate: '2026-10-20T00:00:00Z' } };
    const rows = Object.values(plan().rows);
    const one = partitionStaples(rows, catalog, NOW, onHandUntilFrom(timers), timers);
    const two = partitionStaples([...rows].reverse(), catalog, NOW, onHandUntilFrom(timers), timers);
    expect(one.list.map((r) => r.groceryId).sort()).toEqual(two.list.map((r) => r.groceryId).sort());
  });
});

describe('regularDue', () => {
  it('is null for a food that is not a regular', () => {
    expect(regularDue(catalog.ketchup, {}, NOW)).toBeNull();
  });
});

describe('topUpPlan — a receipt checks for the food first', () => {
  const later = '2026-10-30T00:00:00Z';

  it('adds to the card already there', () => {
    const timers = { t1: { title: 'Hot Dog Buns', quantity: 2, expiryDate: '2026-10-20T00:00:00Z' } };
    expect(topUpPlan({ title: 'Hot dog bun', quantity: 3, expiryDate: later }, timers, NOW))
      .toMatchObject({ id: 't1', changes: { quantity: 5 } });
  });

  it('a bare card counts as one', () => {
    const timers = { t1: { title: 'Milk', expiryDate: '2026-10-20T00:00:00Z' } };
    expect(topUpPlan({ title: 'Milk', expiryDate: later }, timers, NOW).changes.quantity).toBe(2);
  });

  it('starts a new card only when nothing matches', () => {
    expect(topUpPlan({ title: 'Milk', expiryDate: later }, { t: { title: 'Eggs', expiryDate: later } }, NOW)).toBeNull();
  });

  it('replaces a card that has gone off and nobody has seen since', () => {
    const timers = { t1: { title: 'Milk', quantity: 3, expiryDate: '2026-10-01T00:00:00Z' } };
    expect(topUpPlan({ title: 'Milk', expiryDate: later }, timers, NOW))
      .toMatchObject({ id: 't1', changes: { expiryDate: later, quantity: null } });
  });
});
