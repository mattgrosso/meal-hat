import { describe, it, expect } from 'vitest';
import {
  daysSincePurchase,
  stapleIsDue,
  partitionStaples,
  DEFAULT_STAPLE_INTERVAL_DAYS,
  isOnHand
} from '../../src/store/staples.js';

const NOW = new Date(2026, 7, 19); // 2026-08-19

const grocery = (over = {}) => ({ id: 'g1', name: 'Olive Oil', staple: true, ...over });
const row = (groceryId = 'g1', over = {}) => ({ id: 'r1', groceryId, quantity: 1, source: 'meal', ...over });

describe('daysSincePurchase', () => {
  it('counts whole days', () => {
    expect(daysSincePurchase(grocery({ lastPurchased: '2026-07-20' }), NOW)).toBe(30);
  });

  it('is null when never bought', () => {
    expect(daysSincePurchase(grocery(), NOW)).toBeNull();
  });

  it('reads the older stored date shapes', () => {
    expect(daysSincePurchase(grocery({ lastPurchased: new Date(2026, 6, 20).getTime() }), NOW)).toBe(30);
  });

  it('never goes negative on a future date', () => {
    expect(daysSincePurchase(grocery({ lastPurchased: '2026-09-01' }), NOW)).toBe(0);
  });
});

describe('stapleIsDue', () => {
  // The whole safety property lives in this function: every uncertain case has
  // to resolve to "put it on the list".

  it('is due when never bought — no evidence you have it', () => {
    expect(stapleIsDue(grocery(), NOW)).toBe(true);
  });

  it('is due when the date is unreadable', () => {
    expect(stapleIsDue(grocery({ lastPurchased: 'nonsense' }), NOW)).toBe(true);
  });

  it('is due when there is no catalog entry at all', () => {
    expect(stapleIsDue(undefined, NOW)).toBe(true);
    expect(stapleIsDue(null, NOW)).toBe(true);
  });

  it('is NOT due shortly after buying it', () => {
    expect(stapleIsDue(grocery({ lastPurchased: '2026-08-10' }), NOW)).toBe(false);
  });

  it('becomes due again once the interval has passed', () => {
    // 60 days before 2026-08-19 is 2026-06-20.
    expect(stapleIsDue(grocery({ lastPurchased: '2026-06-20' }), NOW)).toBe(true);
    expect(stapleIsDue(grocery({ lastPurchased: '2026-06-21' }), NOW)).toBe(false);
  });

  it('honours a per-item interval', () => {
    const salt = grocery({ lastPurchased: '2026-06-01', stapleIntervalDays: 365 });
    const flour = grocery({ lastPurchased: '2026-06-01', stapleIntervalDays: 30 });

    expect(stapleIsDue(salt, NOW)).toBe(false);
    expect(stapleIsDue(flour, NOW)).toBe(true);
  });

  it('falls back to the default for a junk interval', () => {
    expect(DEFAULT_STAPLE_INTERVAL_DAYS).toBe(60);
    expect(stapleIsDue(grocery({ lastPurchased: '2026-06-20', stapleIntervalDays: 0 }), NOW)).toBe(true);
    expect(stapleIsDue(grocery({ lastPurchased: '2026-08-10', stapleIntervalDays: -5 }), NOW)).toBe(false);
  });
});

describe('partitionStaples', () => {
  it('leaves ordinary items on the list', () => {
    const catalog = { g1: { id: 'g1', name: 'Mozzarella' } };
    const { list, cupboard } = partitionStaples([row()], catalog, NOW);

    expect(list).toHaveLength(1);
    expect(cupboard).toHaveLength(0);
  });

  it('moves a recently-bought staple to the cupboard', () => {
    const catalog = { g1: grocery({ lastPurchased: '2026-08-10' }) };
    const { list, cupboard } = partitionStaples([row()], catalog, NOW);

    expect(list).toHaveLength(0);
    expect(cupboard).toHaveLength(1);
  });

  it('puts a staple back on the list once it is due, and says why', () => {
    const catalog = { g1: grocery({ lastPurchased: '2026-01-01' }) };
    const { list, cupboard } = partitionStaples([row()], catalog, NOW);

    expect(cupboard).toHaveLength(0);
    expect(list[0].stapleDue).toBe(true);
    expect(list[0].daysSincePurchase).toBe(230);
  });

  it('puts a never-bought staple on the list', () => {
    const { list, cupboard } = partitionStaples([row()], { g1: grocery() }, NOW);

    expect(list).toHaveLength(1);
    expect(cupboard).toHaveLength(0);
  });

  it('NEVER discards a row — every input comes out somewhere', () => {
    // The safety property, asserted directly. Whatever the catalog says, the
    // count going in must equal the count coming out.
    const catalog = {
      a: grocery({ id: 'a', staple: true, lastPurchased: '2026-08-18' }),
      b: grocery({ id: 'b', staple: true, lastPurchased: '2026-01-01' }),
      c: { id: 'c', name: 'Ordinary' },
      d: grocery({ id: 'd', staple: true })
    };
    const rows = [row('a'), row('b'), row('c'), row('d'), row('missing-from-catalog')];

    const { list, cupboard } = partitionStaples(rows, catalog, NOW);

    expect(list.length + cupboard.length).toBe(rows.length);
    // And an unknown grocery is never hidden.
    expect(list.some((r) => r.groceryId === 'missing-from-catalog')).toBe(true);
  });

  it('keeps the row intact, quantity and all', () => {
    const catalog = { g1: grocery({ lastPurchased: '2026-08-10' }) };
    const original = row('g1', { quantity: 3, units: 'bottles', aisle: 13 });
    const { cupboard } = partitionStaples([original], catalog, NOW);

    expect(cupboard[0]).toMatchObject({ id: 'r1', quantity: 3, units: 'bottles', aisle: 13 });
  });

  it('survives empty and missing input', () => {
    expect(partitionStaples([], {}, NOW)).toEqual({ list: [], cupboard: [] });
    expect(partitionStaples(null, null, NOW)).toEqual({ list: [], cupboard: [] });
  });
});

// THE POINT OF THE PERISHABLE MERGE.
//
// Before it, "do we still have olive oil?" was answered by lastPurchased plus a
// 60-day guess. The fridge knows. But it may only ever answer in ONE direction:
// a live timer is positive evidence the food is in the house and can suppress a
// staple; nothing about the fridge may ever push a staple onto the list that
// the date arithmetic would have left off, and absence of a timer means nothing
// was photographed — not that the cupboard is bare.
describe('the fridge answering for staples', () => {
  const NOW = new Date('2026-08-29T12:00:00Z');
  const staple = (name, extra = {}) => ({
    id: 'g1', name, staple: true, ...extra
  });
  const until = (name, iso) => ({ [name]: iso });

  it('keeps a staple off the list when the fridge holds a live one', () => {
    // Bought 400 days ago — long overdue by the date rule — but there is a
    // physical bottle in the house with a week left on it.
    const entry = staple('Olive Oil', { lastPurchased: '2025-07-25' });
    expect(stapleIsDue(entry, NOW)).toBe(true);
    expect(stapleIsDue(entry, NOW, until('olive oil', '2026-09-05T12:00:00Z'))).toBe(false);
  });

  it('does NOT suppress on an expired timer', () => {
    // Evidence the food was here and is now past it. That argues for buying
    // more, not less — the opposite of what a naive "we have a record" check
    // would conclude.
    const entry = staple('Olive Oil', { lastPurchased: '2025-07-25' });
    expect(stapleIsDue(entry, NOW, until('olive oil', '2026-08-01T12:00:00Z'))).toBe(true);
  });

  it('falls through to the dates when the fridge has never seen the food', () => {
    const recent = staple('Olive Oil', { lastPurchased: '2026-08-20' });
    const old = staple('Olive Oil', { lastPurchased: '2025-07-25' });
    expect(stapleIsDue(recent, NOW, {})).toBe(false);
    expect(stapleIsDue(old, NOW, {})).toBe(true);
  });

  it('ignores an unreadable expiry rather than treating it as possession', () => {
    const entry = staple('Olive Oil', { lastPurchased: '2025-07-25' });
    expect(stapleIsDue(entry, NOW, until('olive oil', 'not a date'))).toBe(true);
    expect(stapleIsDue(entry, NOW, until('olive oil', ''))).toBe(true);
  });

  it('matches on the name case-insensitively, the way the fridge stores it', () => {
    const entry = staple('Cheddar Cheese', { lastPurchased: '2025-07-25' });
    expect(stapleIsDue(entry, NOW, until('cheddar cheese', '2026-09-05T12:00:00Z'))).toBe(false);
  });

  it('still cannot lose a row — everything in comes out somewhere', () => {
    const rows = [
      { id: 'r1', groceryId: 'g1' },
      { id: 'r2', groceryId: 'g2' },
      { id: 'r3', groceryId: 'missing' }
    ];
    const catalog = {
      g1: { id: 'g1', name: 'Olive Oil', staple: true, lastPurchased: '2025-07-25' },
      g2: { id: 'g2', name: 'Chicken' }
    };
    const { list, cupboard } = partitionStaples(
      rows, catalog, NOW, until('olive oil', '2026-09-05T12:00:00Z')
    );
    expect(list.length + cupboard.length).toBe(3);
    expect(cupboard.map((r) => r.id)).toEqual(['r1']);
    expect(cupboard[0].onHand).toBe(true);
  });

  it('marks WHY a row is in the cupboard, so a wrong call is visible', () => {
    const catalog = {
      g1: { id: 'g1', name: 'Olive Oil', staple: true, lastPurchased: '2026-08-20' }
    };
    const { cupboard } = partitionStaples([{ id: 'r1', groceryId: 'g1' }], catalog, NOW, {});
    // Held back by the date guess, not by evidence.
    expect(cupboard[0].onHand).toBe(false);
  });
});
