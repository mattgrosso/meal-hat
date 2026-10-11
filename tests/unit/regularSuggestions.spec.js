import { describe, it, expect } from 'vitest';
import {
  suggestRegulars,
  suggestionReason,
  answerPatch,
  recentlyDeclined,
  MAX_SUGGESTIONS
} from '../../src/store/regularSuggestions.js';

// Matt, 2026-10-11: suggest foods that look like regulars, and let him say
// yes or no to each — never add them on a guess.

const NOW = new Date(2026, 9, 11, 13, 0);

const catalog = {
  coke: { id: 'coke', name: 'Diet Coke', defaultUnits: 'Case' },
  bread: { id: 'bread', name: 'Sandwich Bread' },
  oil: { id: 'oil', name: 'Olive Oil', staple: true },
  pizza: { id: 'pizza', name: 'Leftover pizza', fridgeOnly: true },
  once: { id: 'once', name: 'Cocktail cherries' }
};

// Diet Coke, counted weekly at 12 a week, down to 6: runs out inside a week.
const cokeLog = {
  '2026-09-27': { count: 24 },
  '2026-10-04': { count: 12 },
  '2026-10-11': { count: 6 }
};
// Bread added by hand three times lately, weekly but then not for two
// months: a lapsed rhythm predicts nothing, the hand-adds still count.
const breadLog = {
  '2026-07-18': { bought: 'manual' },
  '2026-07-25': { bought: 'manual' },
  '2026-08-01': { bought: 'manual' }
};

const suggest = (over = {}) => suggestRegulars({
  catalog,
  usageLog: { coke: cokeLog, bread: breadLog, oil: cokeLog, pizza: breadLog, once: { '2026-10-01': { bought: 'manual' } } },
  now: NOW,
  ...over
});

describe('suggestRegulars', () => {
  it('suggests a food about to run out, and one added by hand often, running-out first', () => {
    const ids = suggest().map((s) => s.groceryId);
    expect(ids).toEqual(['coke', 'bread']);
  });

  it('never suggests a staple, a fridge-only food, or a one-off', () => {
    const ids = suggest().map((s) => s.groceryId);
    expect(ids).not.toContain('oil');
    expect(ids).not.toContain('pizza');
    expect(ids).not.toContain('once');
  });

  it('skips anything already on the list, bought or not', () => {
    const ids = suggest({
      shoppingList: {
        a: { groceryId: 'coke', source: 'manual', purchased: false },
        b: { groceryId: 'bread', source: 'manual', purchased: true, purchasedOn: '2026-10-11' }
      }
    }).map((s) => s.groceryId);
    expect(ids).toEqual([]);
  });

  it('a hand-added food the fridge already holds is not offered; one running out still is', () => {
    const onHandUntil = { 'sandwich bread': '2026-10-20', 'diet coke': '2026-10-20' };
    expect(suggest({ onHandUntil }).map((s) => s.groceryId)).toEqual(['coke']);
  });

  it('a no keeps it quiet for about two months, then it can come back', () => {
    const declined = { ...catalog, coke: { ...catalog.coke, regularDeclinedOn: '2026-09-01' } };
    expect(suggest({ catalog: declined }).map((s) => s.groceryId)).toEqual(['bread']);
    const longAgo = { ...catalog, coke: { ...catalog.coke, regularDeclinedOn: '2026-08-01' } };
    expect(suggest({ catalog: longAgo }).map((s) => s.groceryId)).toContain('coke');
  });

  it('hand purchases from long ago do not count', () => {
    const oldLog = { '2026-01-01': { bought: 'manual' }, '2026-02-01': { bought: 'manual' }, '2026-03-01': { bought: 'manual' } };
    expect(suggest({ usageLog: { bread: oldLog } })).toEqual([]);
  });

  it('keeps the box short', () => {
    const big = {};
    const logs = {};
    for (let i = 0; i < 12; i += 1) {
      big[`f${i}`] = { id: `f${i}`, name: `Food ${i}` };
      logs[`f${i}`] = breadLog;
    }
    expect(suggest({ catalog: big, usageLog: logs })).toHaveLength(MAX_SUGGESTIONS);
  });

  it('writes nothing and is the same every time it is asked', () => {
    const usageLog = { coke: cokeLog, bread: breadLog };
    const before = JSON.stringify({ catalog, usageLog });
    const first = suggest({ usageLog });
    expect(suggest({ usageLog })).toEqual(first);
    expect(JSON.stringify({ catalog, usageLog })).toBe(before);
  });
});

describe('suggestionReason', () => {
  it('says what the guess rests on', () => {
    expect(suggestionReason({ runsOutOn: '2026-10-14', perWeek: 9 })).toMatch(/about 9 a week/);
    expect(suggestionReason({ runsOutOn: '2026-10-14', everyDays: 10 })).toMatch(/every 10 days/);
    expect(suggestionReason({ handAdded: 4 })).toMatch(/4 times/);
  });
});

describe('answerPatch', () => {
  it('yes makes it a staple, at its own rhythm when known', () => {
    expect(answerPatch({ groceryId: 'bread', everyDays: 12 }, true)).toEqual({
      'bread/staple': true,
      'bread/regularDeclinedOn': null,
      'bread/stapleIntervalDays': 12
    });
    expect(answerPatch({ groceryId: 'coke' }, true)).toEqual({ 'coke/staple': true, 'coke/regularDeclinedOn': null });
  });

  it('no only stamps the day', () => {
    expect(answerPatch({ groceryId: 'coke' }, false, NOW)).toEqual({ 'coke/regularDeclinedOn': '2026-10-11' });
    expect(recentlyDeclined({ regularDeclinedOn: '2026-10-11' }, NOW)).toBe(true);
  });
});
