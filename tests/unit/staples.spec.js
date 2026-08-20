import { describe, it, expect } from 'vitest';
import {
  daysSincePurchase,
  stapleIsDue,
  partitionStaples,
  DEFAULT_STAPLE_INTERVAL_DAYS
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
