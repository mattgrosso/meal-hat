import { describe, it, expect } from 'vitest';
import { withPreservedPurchases } from '../../src/store/purchases.js';

// The bug this exists to stop: tick the mozzarella off on Saturday, draw next
// week's meals on Sunday, and it comes back at full quantity — because
// regeneration deletes every meal row and rebuilds it from the schedule with a
// brand new id, so nothing about what you did survived.

const row = (groceryId, quantity, id = `new-${groceryId}`) => ({
  id, groceryId, quantity, source: 'meal', purchased: false
});

const previous = (groceryId, quantity, purchased, source = 'meal') => ({
  id: `old-${groceryId}`, groceryId, quantity, source, purchased
});

describe('withPreservedPurchases', () => {
  it('keeps an item bought across a rebuild', () => {
    const result = withPreservedPurchases(
      [row('mozzarella', 1)],
      [previous('mozzarella', 1, true)]
    );

    expect(result[0].purchased).toBe(true);
  });

  it('matches on groceryId, not row id', () => {
    // The whole reason this is not a simple id lookup: regeneration issues a
    // fresh uuid for every row, so the ids never line up.
    const result = withPreservedPurchases(
      [row('mozzarella', 1, 'completely-different-id')],
      [previous('mozzarella', 1, true)]
    );

    expect(result[0].id).toBe('completely-different-id');
    expect(result[0].purchased).toBe(true);
  });

  it('leaves an item unbought if it was never bought', () => {
    const result = withPreservedPurchases(
      [row('ricotta', 1)],
      [previous('ricotta', 1, false)]
    );

    expect(result[0].purchased).toBe(false);
  });

  it('reopens an item when a new meal needs MORE than was bought', () => {
    // Bought 2lb of chicken; a newly drawn meal pushes the requirement to 4lb.
    // Staying ticked would leave you short at the shop.
    const result = withPreservedPurchases(
      [row('chicken', 4)],
      [previous('chicken', 2, true)]
    );

    expect(result[0].purchased).toBe(false);
  });

  it('stays bought when the requirement DROPS', () => {
    // Bought 4, now only 2 are needed — what you have still covers it.
    const result = withPreservedPurchases(
      [row('chicken', 2)],
      [previous('chicken', 4, true)]
    );

    expect(result[0].purchased).toBe(true);
  });

  it('stays bought when the requirement is exactly what was bought', () => {
    const result = withPreservedPurchases(
      [row('garlic', 5)],
      [previous('garlic', 5, true)]
    );

    expect(result[0].purchased).toBe(true);
  });

  it('ignores purchased MANUAL items when deciding meal rows', () => {
    // Manual items are never regenerated, so a manual purchase must not leak
    // its state onto a meal row that happens to share a grocery.
    const result = withPreservedPurchases(
      [row('basil', 2)],
      [previous('basil', 2, true, 'manual')]
    );

    expect(result[0].purchased).toBe(false);
  });

  it('handles an item that is new this time round', () => {
    const result = withPreservedPurchases([row('capers', 1)], []);

    expect(result[0].purchased).toBe(false);
  });

  it('leaves every other field on the row untouched', () => {
    const original = { ...row('eggs', 2), aisle: 3, location: 'upstairs', mealId: 'm1', units: 'eggs' };
    const [result] = withPreservedPurchases([original], [previous('eggs', 2, true)]);

    expect(result).toEqual({ ...original, purchased: true });
  });

  it('copes with several groceries at once', () => {
    const result = withPreservedPurchases(
      [row('a', 1), row('b', 5), row('c', 1)],
      [previous('a', 1, true), previous('b', 2, true), previous('c', 1, false)]
    );

    expect(result.map((r) => r.purchased)).toEqual([true, false, false]);
  });

  it('treats missing or junk quantities as zero rather than throwing', () => {
    expect(withPreservedPurchases([row('x', undefined)], [previous('x', undefined, true)])[0].purchased).toBe(true);
    expect(withPreservedPurchases([row('y', 3)], [previous('y', null, true)])[0].purchased).toBe(false);
  });

  it('survives empty and missing inputs', () => {
    expect(withPreservedPurchases([], [])).toEqual([]);
    expect(withPreservedPurchases(null, null)).toEqual([]);
    expect(withPreservedPurchases([row('z', 1)], null)[0].purchased).toBe(false);
  });
});
