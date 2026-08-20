import { describe, it, expect } from 'vitest';
import { mealWeight, pickWeightedMeal, eligibleMeals } from '../../src/store/draw.js';

const TODAY = '2026-08-19';

const meal = (id, { lastDrawn = null, minDaysBetween = 14 } = {}) => ({
  id,
  name: id,
  minDaysBetween,
  drawnDates: lastDrawn ? [lastDrawn] : []
});

describe('mealWeight', () => {
  it('gives a never-drawn meal the maximum', () => {
    // Something added to the hat and never eaten should be a strong candidate,
    // not an average one.
    expect(mealWeight(meal('new'), TODAY)).toBe(3);
  });

  it('rises the longer a meal goes undrawn', () => {
    const recent = mealWeight(meal('a', { lastDrawn: '2026-08-05' }), TODAY); // 14d / 14 = 1
    const older = mealWeight(meal('b', { lastDrawn: '2026-07-22' }), TODAY); // 28d / 14 = 2

    expect(older).toBeGreaterThan(recent);
    expect(recent).toBeCloseTo(1);
    expect(older).toBeCloseTo(2);
  });

  it('measures against each meal\'s OWN interval, not raw days', () => {
    // The 7-day meal is 10 days out (1.43 intervals). The 30-day meal is 35 days
    // out (1.17 intervals) — more days, but less overdue for what it is.
    // Weighting by raw days would systematically favour the meals deliberately
    // marked rare.
    const frequent = mealWeight(meal('weekly', { lastDrawn: '2026-08-09', minDaysBetween: 7 }), TODAY);
    const rare = mealWeight(meal('monthly', { lastDrawn: '2026-07-15', minDaysBetween: 30 }), TODAY);

    expect(frequent).toBeGreaterThan(rare);
  });

  it('caps, so a long-neglected meal cannot make the draw deterministic', () => {
    expect(mealWeight(meal('ancient', { lastDrawn: '2020-01-01' }), TODAY)).toBe(3);
  });

  it('never returns zero, so nothing becomes unpickable', () => {
    // Same day: 0 days elapsed. Filtering decides eligibility, not weighting.
    expect(mealWeight(meal('today', { lastDrawn: TODAY }), TODAY)).toBeGreaterThan(0);
  });

  it('falls back to a neutral interval when minDaysBetween is missing', () => {
    const withOut = mealWeight({ id: 'x', drawnDates: ['2026-08-05'] }, TODAY);

    expect(withOut).toBeCloseTo(1); // 14 days against the 14-day default
  });

  it('reads the older stored shapes', () => {
    const epoch = { id: 'y', minDaysBetween: 14, lastDrawn: new Date(2026, 6, 22).getTime() };

    expect(mealWeight(epoch, TODAY)).toBeCloseTo(2);
  });

  it('handles a missing meal', () => {
    expect(mealWeight(null, TODAY)).toBe(0);
  });
});

describe('pickWeightedMeal', () => {
  // random() is injected, so these assert the actual selection rather than
  // sampling and hoping.
  const overdue = meal('overdue', { lastDrawn: '2026-07-08' }); // 42d / 14 -> capped 3
  const due = meal('due', { lastDrawn: '2026-08-05' }); // 14d / 14 -> 1

  it('lands on the first candidate at the bottom of the range', () => {
    expect(pickWeightedMeal([overdue, due], TODAY, { random: () => 0 }).id).toBe('overdue');
  });

  it('crosses into the second candidate past the first one\'s share', () => {
    // Weights are 3 and 1, total 4. A ticket at 0.9 of the range = 3.6, which is
    // past the first meal's 3.
    expect(pickWeightedMeal([overdue, due], TODAY, { random: () => 0.9 }).id).toBe('due');
  });

  it('still favours the overdue meal at the boundary', () => {
    // 0.7 * 4 = 2.8, still inside the first meal's share of 3.
    expect(pickWeightedMeal([overdue, due], TODAY, { random: () => 0.7 }).id).toBe('overdue');
  });

  it('gives the less overdue meal a real chance — this is a hat, not a rotation', () => {
    let dueCount = 0;
    // A deterministic sweep across the whole range, so no flakiness.
    for (let i = 0; i < 1000; i++) {
      if (pickWeightedMeal([overdue, due], TODAY, { random: () => i / 1000 }).id === 'due') dueCount++;
    }

    // Exactly its 1-in-4 share: present, but outvoted.
    expect(dueCount).toBe(250);
  });

  it('returns null for an empty hat', () => {
    expect(pickWeightedMeal([], TODAY)).toBeNull();
    expect(pickWeightedMeal(null, TODAY)).toBeNull();
  });

  it('picks the only candidate', () => {
    expect(pickWeightedMeal([due], TODAY, { random: () => 0.99 }).id).toBe('due');
  });

  it('never returns null when candidates exist, whatever random does', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
      expect(pickWeightedMeal([overdue, due], TODAY, { random: () => r })).not.toBeNull();
    }
  });
});

describe('eligibleMeals', () => {
  it('drops meals drawn too recently', () => {
    const tooSoon = meal('soon', { lastDrawn: '2026-08-15', minDaysBetween: 14 });
    const ready = meal('ready', { lastDrawn: '2026-07-01', minDaysBetween: 14 });

    expect(eligibleMeals([tooSoon, ready], TODAY).map((m) => m.id)).toEqual(['ready']);
  });

  it('drops meals already used elsewhere in the same draw', () => {
    const a = meal('a', { lastDrawn: '2026-07-01' });
    const b = meal('b', { lastDrawn: '2026-07-01' });

    expect(eligibleMeals([a, b], TODAY, new Set(['a'])).map((m) => m.id)).toEqual(['b']);
  });

  it('accepts the store\'s object-keyed shape as well as an array', () => {
    const byKey = { k1: meal('a', { lastDrawn: '2026-07-01' }), k2: meal('b', { lastDrawn: '2026-07-01' }) };

    expect(eligibleMeals(byKey, TODAY)).toHaveLength(2);
  });

  it('returns nothing for an empty hat', () => {
    expect(eligibleMeals(null, TODAY)).toEqual([]);
  });
});
