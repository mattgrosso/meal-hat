import { describe, it, expect } from 'vitest';
import { liveTimersFor, packagesOnHand, rowCoverage, normalizeName } from '../../../src/store/fridge/inHouse';

const NOW = new Date('2026-09-20T12:00:00Z');
const inDays = (n) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

const timer = (title, days, extra = {}) => ({ title, expiryDate: inDays(days), ...extra });

describe('normalizeName', () => {
  it('ignores case and surrounding space', () => {
    expect(normalizeName('  Cheddar Cheese ')).toBe('cheddar cheese');
  });

  it('is empty for nothing', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });
});

describe('liveTimersFor', () => {
  const timers = {
    a: timer('Cheddar Cheese', 30),
    b: timer('cheddar cheese', 5),
    c: timer('Lettuce', 2),
    d: timer('Cheddar Cheese', -1)
  };

  it('matches on name regardless of case', () => {
    expect(liveTimersFor('CHEDDAR CHEESE', timers, NOW).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('drops timers that have already expired', () => {
    expect(liveTimersFor('Cheddar Cheese', timers, NOW).map((t) => t.id)).not.toContain('d');
  });

  it('sorts soonest first', () => {
    expect(liveTimersFor('Cheddar Cheese', timers, NOW)[0].id).toBe('b');
  });

  it('is empty for an unknown food, and for no name at all', () => {
    expect(liveTimersFor('Quince', timers, NOW)).toEqual([]);
    expect(liveTimersFor('', timers, NOW)).toEqual([]);
  });

  it('survives junk expiry dates rather than counting them', () => {
    expect(liveTimersFor('X', { a: { title: 'X', expiryDate: 'whenever' } }, NOW)).toEqual([]);
  });
});

describe('packagesOnHand', () => {
  it('counts a timer with no quantity as one package', () => {
    expect(packagesOnHand('Eggs', { a: timer('Eggs', 10) }, NOW)).toBe(1);
  });

  it('adds up across several timers', () => {
    const timers = { a: timer('Eggs', 10), b: timer('Eggs', 20) };
    expect(packagesOnHand('Eggs', timers, NOW)).toBe(2);
  });

  it('respects an explicit quantity', () => {
    expect(packagesOnHand('Eggs', { a: timer('Eggs', 10, { quantity: 0.5 }) }, NOW)).toBe(0.5);
  });

  it('is zero when everything has expired', () => {
    expect(packagesOnHand('Eggs', { a: timer('Eggs', -3) }, NOW)).toBe(0);
  });
});

describe('rowCoverage', () => {
  // The real numbers from Matt's list on 2026-09-20.
  it('covers 10 slices of bread with one 20-slice loaf', () => {
    const entry = { name: 'Sandwich Bread', packageSize: 20 };
    const result = rowCoverage({ quantity: 10 }, entry, { a: timer('Sandwich Bread', 60) }, NOW);
    expect(result.covered).toBe(true);
    expect(result.needed).toBe(0.5);
    expect(result.onHand).toBe(1);
  });

  // THE ONE THAT MUST NOT BE SUPPRESSED. Three cups of cheddar against a
  // two-cup block needs one and a half blocks, and the house has one.
  it('does NOT cover 3 cups of cheddar with a single 2-cup block', () => {
    const entry = { name: 'Cheddar Cheese', packageSize: 2 };
    const result = rowCoverage({ quantity: 3 }, entry, { a: timer('Cheddar Cheese', 60) }, NOW);
    expect(result.covered).toBe(false);
    expect(result.needed).toBe(1.5);
    expect(result.onHand).toBe(1);
  });

  it('covers it once a second block is in the house', () => {
    const entry = { name: 'Cheddar Cheese', packageSize: 2 };
    const timers = { a: timer('Cheddar Cheese', 60), b: timer('Cheddar Cheese', 20) };
    expect(rowCoverage({ quantity: 3 }, entry, timers, NOW).covered).toBe(true);
  });

  it('covers a row asking for exactly one package', () => {
    const entry = { name: 'Tortellini', packageSize: 1 };
    expect(rowCoverage({ quantity: 1 }, entry, { a: timer('Tortellini', 5) }, NOW).covered).toBe(true);
  });

  it('is not defeated by floating point', () => {
    const entry = { name: 'Thing', packageSize: 3 };
    // 0.1 + 0.2 arithmetic: 3 x 0.1 is not exactly 0.3.
    const result = rowCoverage({ quantity: 0.3 }, entry, { a: timer('Thing', 5, { quantity: 0.1 }) }, NOW);
    expect(result.covered).toBe(true);
  });

  it('says nothing is covered when the house holds none of it', () => {
    const entry = { name: 'Milk', packageSize: 1 };
    const result = rowCoverage({ quantity: 1 }, entry, { a: timer('Eggs', 5) }, NOW);
    expect(result).toEqual({ onHand: 0, needed: null, covered: false, assumedPackageSize: false });
  });

  it('treats an expired timer as nothing at all', () => {
    const entry = { name: 'Milk', packageSize: 1 };
    expect(rowCoverage({ quantity: 1 }, entry, { a: timer('Milk', -1) }, NOW).covered).toBe(false);
  });

  it('assumes one package covers it when no packageSize is recorded, and says so', () => {
    const entry = { name: 'Cucumber' };
    const result = rowCoverage({ quantity: 4 }, entry, { a: timer('Cucumber', 5) }, NOW);
    expect(result.covered).toBe(true);
    expect(result.assumedPackageSize).toBe(true);
  });

  it('covers a row with no usable quantity as long as the food is here', () => {
    const entry = { name: 'Garlic', packageSize: 10 };
    const result = rowCoverage({ quantity: 'some' }, entry, { a: timer('Garlic', 30) }, NOW);
    expect(result.covered).toBe(true);
    expect(result.needed).toBeNull();
  });

  it('survives a catalog entry with no name', () => {
    expect(rowCoverage({ quantity: 1 }, {}, { a: timer('Milk', 5) }, NOW).covered).toBe(false);
  });
});
