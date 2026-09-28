import { describe, it, expect } from 'vitest';
import {
  usageRate,
  buyingRhythm,
  predictRunOut,
  runningLowFoods,
  readingsPatch,
  prunePatch,
  runningLowNote
} from '../../src/store/usage.js';
import { partitionStaples } from '../../src/store/staples.js';
import { buildTalkReview } from '../../src/store/fridge/talkReview.js';

const NOW = new Date(2026, 8, 28, 10); // 2026-09-28

// Diet Coke, counted weekly: 24 -> 12 -> 0 is 12 a week.
const dietCoke = {
  '2026-09-14': { count: 24 },
  '2026-09-21': { count: 12 },
  '2026-09-28': { count: 6 }
};

describe('usageRate', () => {
  it('learns units per day from consecutive counts', () => {
    expect(usageRate(dietCoke) * 7).toBeCloseTo((18 / 14) * 7);
  });

  it('needs two readings', () => {
    expect(usageRate({ '2026-09-28': { count: 6 } })).toBeNull();
  });

  it('ignores a gap with a purchase in it, including one on the first day', () => {
    expect(usageRate({
      '2026-09-14': { count: 24, bought: 'manual' },
      '2026-09-21': { count: 12 }
    })).toBeNull();
  });

  it('treats a purchase on the later reading day as after the reading', () => {
    expect(usageRate({
      '2026-09-14': { count: 24 },
      '2026-09-21': { count: 12, bought: 'manual' }
    }) * 7).toBeCloseTo(12);
  });

  it('skips a count that went up with no purchase logged', () => {
    expect(usageRate({ '2026-09-14': { count: 2 }, '2026-09-21': { count: 10 } })).toBeNull();
  });
});

describe('buyingRhythm', () => {
  it('is the median gap between manual purchases', () => {
    expect(buyingRhythm({
      '2026-09-01': { bought: 'manual' },
      '2026-09-11': { bought: 'manual' },
      '2026-09-20': { bought: 'manual' },
      '2026-09-24': { bought: 'meal' }
    })).toBe(9.5);
  });

  it('ignores meal purchases, which follow the draw rather than the house', () => {
    expect(buyingRhythm({
      '2026-09-01': { bought: 'meal' },
      '2026-09-11': { bought: 'meal' },
      '2026-09-20': { bought: 'meal' }
    })).toBeNull();
  });
});

describe('predictRunOut', () => {
  it('projects the latest count forward at the learned rate', () => {
    // 6 left at 18/14 a day is 4.67 days.
    expect(predictRunOut(dietCoke, NOW).runsOutOn).toBe('2026-10-02');
  });

  it('says "out today" when he said there are none', () => {
    const log = { ...dietCoke, '2026-09-28': { count: 0 } };
    expect(predictRunOut(log, NOW).runsOutOn).toBe('2026-09-28');
  });

  it('distrusts the count once something was bought after it', () => {
    const log = { '2026-09-07': { count: 24 }, '2026-09-14': { count: 12, bought: 'manual' } };
    expect(predictRunOut(log, NOW)).toBeNull();
  });

  it('falls back to the buying rhythm', () => {
    const log = {
      '2026-09-01': { bought: 'manual' },
      '2026-09-11': { bought: 'manual' },
      '2026-09-21': { bought: 'manual' }
    };
    expect(predictRunOut(log, NOW)).toEqual({ runsOutOn: '2026-10-01', everyDays: 10 });
  });

  it('drops a habit that has lapsed', () => {
    const log = {
      '2026-06-01': { bought: 'manual' },
      '2026-06-11': { bought: 'manual' },
      '2026-06-21': { bought: 'manual' }
    };
    expect(predictRunOut(log, NOW)).toBeNull();
  });

  it('with nothing learned, says nothing', () => {
    expect(predictRunOut({}, NOW)).toBeNull();
  });
});

describe('runningLowFoods', () => {
  const catalog = {
    coke: { id: 'coke', name: 'Diet Coke' },
    pizza: { id: 'pizza', name: 'Leftover pizza', fridgeOnly: true }
  };

  it('adds a food that runs out within a week', () => {
    const low = runningLowFoods({ coke: dietCoke }, catalog, {}, NOW);
    expect(low).toEqual([expect.objectContaining({ groceryId: 'coke', runsOutOn: '2026-10-02' })]);
  });

  it('leaves a food that lasts past the week', () => {
    const log = { ...dietCoke, '2026-09-28': { count: 20 } };
    expect(runningLowFoods({ coke: log }, catalog, {}, NOW)).toEqual([]);
  });

  it('never duplicates a row already on the list, bought or not', () => {
    const list = { r1: { groceryId: 'coke', purchased: true } };
    expect(runningLowFoods({ coke: dietCoke }, catalog, list, NOW)).toEqual([]);
  });

  it('skips fridge-only foods and foods no longer in the catalog', () => {
    expect(runningLowFoods({ pizza: dietCoke, gone: dietCoke }, catalog, {}, NOW)).toEqual([]);
  });
});

describe('readingsPatch', () => {
  it('logs catalog foods by id under today, matching spelling loosely', () => {
    const catalog = { coke: { name: 'Diet Coke' }, egg: { name: 'Eggs' } };
    expect(readingsPatch({ 'diet coke': 6, egg: 0, unknown: 3 }, catalog, NOW)).toEqual({
      'coke/2026-09-28/count': 6,
      'egg/2026-09-28/count': 0
    });
  });
});

describe('prunePatch', () => {
  it('deletes entries older than the keep window', () => {
    const log = { coke: { '2025-09-01': { count: 3 }, '2026-09-01': { count: 5 } } };
    expect(prunePatch(log, NOW)).toEqual({ 'coke/2025-09-01': null });
  });
});

describe('runningLowNote', () => {
  it('says how fast it goes', () => {
    expect(runningLowNote({ perWeek: 12.2 })).toBe('running low — you go through about 12 a week');
    expect(runningLowNote({ perWeek: 0.5 })).toBe('running low — you use about one every 14 days');
    expect(runningLowNote({ everyDays: 10 })).toBe('running low — you buy it about every 10 days');
  });
});

describe('a running-low row is never hidden by the fridge', () => {
  it('stays on the list even with a live timer covering it', () => {
    const catalog = { coke: { id: 'coke', name: 'Diet Coke' } };
    const timers = { t1: { title: 'Diet Coke', quantity: 6, expiryDate: '2027-01-01T00:00:00Z' } };
    const rows = [{ id: 'r1', groceryId: 'coke', quantity: 1, runningLow: { runsOutOn: '2026-10-02' } }];
    const { list, cupboard } = partitionStaples(rows, catalog, NOW, {}, timers);
    expect(list.map((r) => r.id)).toEqual(['r1']);
    expect(cupboard).toEqual([]);
  });
});

describe('talk-through counts', () => {
  it('records what was said, and zero for out-of and unmentioned', () => {
    const timers = [
      { id: 't1', title: 'Milk', expiryDate: '2026-10-05T00:00:00Z' },
      { id: 't2', title: 'Butter', expiryDate: '2026-10-05T00:00:00Z' }
    ];
    const result = {
      items: [{ name: 'Diet Coke', heard: 'six diet cokes', quantity: 6 }, { name: 'Milk', quantity: 1 }],
      outOf: [{ name: 'Eggs' }]
    };
    const review = buildTalkReview(result, timers, [], NOW);
    expect(review.counts).toEqual({ 'diet coke': 6, milk: 1, butter: 0, egg: 0 });
  });
});
