import { describe, it, expect } from 'vitest';
import {
  isPerishable,
  buildTalkItem,
  buildTalkReview,
  talkReviewReady,
  talkPayload,
  PANTRY_THRESHOLD_DAYS,
  DEFAULT_PANTRY_DAYS
} from '../../../src/store/fridge/talkReview';

const NOW = new Date('2026-09-20T12:00:00Z');
const inDays = (n) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

const said = (over = {}) => ({
  heard: 'there\'s some cheddar',
  name: 'Cheddar',
  knownFoodMatch: '',
  quantity: 1,
  perishable: true,
  estimatedShelfLifeDays: 30,
  ...over
});

const timer = (id, title, days, over = {}) => ({
  id,
  title,
  expiryDate: inDays(days),
  createdAt: inDays(-3),
  ...over
});

const templates = [
  { title: 'Cheddar Cheese', days: 74 },
  { title: 'Frozen Spinach', days: 240 }
];

describe('isPerishable', () => {
  it('trusts the household\'s own template over anything else', () => {
    // Frozen spinach at 240 days is well past a lazy six-month cutoff, and it
    // is on Matt's wall today because he put it there.
    expect(isPerishable({ perishable: false, estimatedShelfLifeDays: 900 }, { title: 'Frozen Spinach', days: 240 })).toBe(true);
  });

  it('takes the model at its word when it says shelf-stable', () => {
    expect(isPerishable(said({ perishable: false, estimatedShelfLifeDays: 1000 }), null)).toBe(false);
  });

  it('files a multi-year shelf life as pantry even if nothing said so', () => {
    expect(isPerishable({ estimatedShelfLifeDays: PANTRY_THRESHOLD_DAYS + 1 }, null)).toBe(false);
    expect(isPerishable({ estimatedShelfLifeDays: PANTRY_THRESHOLD_DAYS }, null)).toBe(true);
  });

  it('errs toward perishable when nothing is known', () => {
    // A countdown on a tin is a row on a screen. No countdown on a chicken is
    // a bad dinner.
    expect(isPerishable({}, null)).toBe(true);
    expect(isPerishable({ estimatedShelfLifeDays: 0 }, null)).toBe(true);
  });
});

describe('buildTalkItem', () => {
  it('answers in the household\'s vocabulary and arrives ready', () => {
    const row = buildTalkItem(said({ knownFoodMatch: 'Cheddar Cheese' }), templates, NOW);
    expect(row.name).toBe('Cheddar Cheese');
    expect(row.days).toBe(74);
    expect(row.fromTemplate).toBe(true);
  });

  it('SAYS SO when a template renamed what was heard', () => {
    // The sourdough trap from the receipt flow: a rename that carries another
    // food's shelf life has to be visible or it is uncatchable.
    const row = buildTalkItem(said({ name: 'Cheddar', knownFoodMatch: 'Cheddar Cheese' }), templates, NOW);
    expect(row.readAs).toBe('Cheddar');
  });

  it('does not cry rename when the name is effectively the same', () => {
    const row = buildTalkItem(said({ name: 'Cheddar Cheese', knownFoodMatch: 'Cheddar Cheese' }), templates, NOW);
    expect(row.readAs).toBe('');
  });

  it('gives a new food the estimate rather than blocking on it', () => {
    const row = buildTalkItem(said({ name: 'Rhubarb', estimatedShelfLifeDays: 12 }), templates, NOW);
    expect(row.fromTemplate).toBe(false);
    expect(row.days).toBe(12);
    expect(row.estimateDays).toBe(12);
  });

  it('keeps the spoken phrase, untouched', () => {
    const row = buildTalkItem(said({ heard: 'uh, half a block of cheddar I think' }), templates, NOW);
    expect(row.heard).toBe('uh, half a block of cheddar I think');
  });

  it('marks a pantry store, and gives it a long life rather than none', () => {
    const row = buildTalkItem(said({ name: 'Black Beans', perishable: false, estimatedShelfLifeDays: 0 }), templates, NOW);
    expect(row.shelfStable).toBe(true);
    expect(row.days).toBe(DEFAULT_PANTRY_DAYS);
  });

  it('reads a spoken count', () => {
    expect(buildTalkItem(said({ quantity: 3 }), templates, NOW).quantity).toBe(3);
    expect(buildTalkItem(said({ quantity: 0 }), templates, NOW).quantity).toBeNull();
  });
});

describe('buildTalkReview', () => {
  const timers = [
    timer('t1', 'Cheddar Cheese', 60),
    timer('t2', 'Mustard', 170),
    timer('t3', 'Eggs', 19)
  ];

  it('shows what it got right, without restarting those timers', () => {
    // A weekly talk-through must not keep a dying carton of milk alive
    // forever. Seeing food again says nothing about how fresh it is.
    const review = buildTalkReview(
      { items: [said({ knownFoodMatch: 'Cheddar Cheese' })] },
      timers, templates, NOW
    );
    expect(review.confirmed.map((r) => r.title)).toEqual(['Cheddar Cheese']);
    expect(review.confirmed[0].timeLeft.days).toBe(60);
  });

  it('CHECKS everything he did not mention — his call, and the inversion', () => {
    const review = buildTalkReview(
      { items: [said({ knownFoodMatch: 'Cheddar Cheese' })] },
      timers, templates, NOW
    );
    expect(review.notHeard.map((r) => r.title).sort()).toEqual(['Eggs', 'Mustard']);
    expect(review.notHeard.every((r) => r.remove)).toBe(true);
  });

  it('carries context on a removal, so a fresh one gets a second look', () => {
    const review = buildTalkReview({ items: [] }, [timer('t1', 'Eggs', 19)], templates, NOW);
    expect(review.notHeard[0].addedDaysAgo).toBe(3);
    expect(review.notHeard[0].timeLeft.days).toBe(19);
  });

  // THE ONE THAT MUST NOT INVERT. "We're out of milk" is not a milk sighting.
  it('never turns an "out of" into a timer', () => {
    const review = buildTalkReview(
      { items: [], outOf: [{ heard: 'we\'re out of milk', name: 'Milk', knownFoodMatch: '' }] },
      [], templates, NOW
    );
    expect(review.newItems).toEqual([]);
  });

  it('removes a tracked food he says they have finished, and says why', () => {
    const review = buildTalkReview(
      { items: [], outOf: [{ heard: 'the eggs are gone', name: 'Eggs', knownFoodMatch: '' }] },
      timers, templates, NOW
    );
    const eggs = review.notHeard.find((r) => r.title === 'Eggs');
    expect(eggs.remove).toBe(true);
    expect(eggs.saidOutOf).toBe(true);
    // Not mentioning the mustard is a weaker statement than saying it is gone.
    expect(review.notHeard.find((r) => r.title === 'Mustard').saidOutOf).toBe(false);
  });

  it('lets "out of" beat a passing mention of the same food', () => {
    // Dictated speech, not drafted prose: "there's eggs... no, we finished
    // those". The last word has to win.
    const review = buildTalkReview(
      {
        items: [said({ name: 'Eggs', knownFoodMatch: '' })],
        outOf: [{ heard: 'no we finished those', name: 'Eggs', knownFoodMatch: '' }]
      },
      timers, templates, NOW
    );
    expect(review.confirmed.map((r) => r.title)).not.toContain('Eggs');
    expect(review.newItems.map((r) => r.name)).not.toContain('Eggs');
    expect(review.notHeard.find((r) => r.title === 'Eggs').remove).toBe(true);
  });

  it('counts one food said twice as two packages, not two rows', () => {
    const review = buildTalkReview(
      {
        items: [
          said({ name: 'Peppers', heard: 'couple of peppers', knownFoodMatch: '' }),
          said({ name: 'Peppers', heard: 'oh and another pepper in the drawer', knownFoodMatch: '' })
        ]
      },
      [], templates, NOW
    );
    expect(review.newItems.length).toBe(1);
    expect(review.newItems[0].quantity).toBe(2);
    expect(review.newItems[0].heard).toContain('another pepper');
  });

  it('surfaces what it could not make sense of rather than guessing', () => {
    const review = buildTalkReview(
      { items: [], unclear: [{ heard: 'some kind of sauce, no idea', why: 'no specific food named' }] },
      [], templates, NOW
    );
    expect(review.unclear).toEqual([{ heard: 'some kind of sauce, no idea', why: 'no specific food named' }]);
  });

  it('survives an empty result and an empty fridge', () => {
    const review = buildTalkReview({}, [], [], NOW);
    expect(review).toEqual({ confirmed: [], newItems: [], notHeard: [], unclear: [] });
  });

  it('never loses a tracked timer — every one is confirmed or going', () => {
    const review = buildTalkReview(
      { items: [said({ knownFoodMatch: 'Cheddar Cheese' })] },
      timers, templates, NOW
    );
    const accounted = [...review.confirmed, ...review.notHeard].map((r) => r.id).sort();
    expect(accounted).toEqual(['t1', 't2', 't3']);
  });
});

describe('talkPayload', () => {
  it('writes one timer per package, so half of it can be eaten later', () => {
    const review = { newItems: [{ name: 'Peppers', included: true, days: 10, quantity: 3, startsAt: NOW }] };
    expect(talkPayload(review, NOW).timers.length).toBe(3);
  });

  it('counts the days from today, landing on the right date', () => {
    const review = { newItems: [{ name: 'Milk', included: true, days: 7, startsAt: NOW }] };
    const [written] = talkPayload(review, NOW).timers;
    expect(written.expiryDate).toBe(inDays(7));
  });

  it('skips a row that was unticked', () => {
    const review = {
      newItems: [
        { name: 'Milk', included: false, days: 7, startsAt: NOW },
        { name: 'Eggs', included: true, days: 19, startsAt: NOW }
      ]
    };
    expect(talkPayload(review, NOW).timers.map((t) => t.title)).toEqual(['Eggs']);
  });

  it('marks a pantry store so the wall never shows it', () => {
    const review = { newItems: [{ name: 'Black Beans', included: true, days: 730, shelfStable: true, startsAt: NOW }] };
    expect(talkPayload(review, NOW).timers[0].shelfStable).toBe(true);
  });

  it('does NOT teach a template from a pantry store', () => {
    // Otherwise the next hand-typed tin of beans arrives on the wall with a
    // two-year countdown, and the wall is for food that goes off.
    const review = {
      newItems: [
        { name: 'Black Beans', included: true, days: 730, shelfStable: true, startsAt: NOW },
        { name: 'Rhubarb', included: true, days: 12, startsAt: NOW }
      ]
    };
    expect(talkPayload(review, NOW).templates).toEqual([{ title: 'Rhubarb', days: 12 }]);
  });

  it('only removes the rows still ticked when it was confirmed', () => {
    const review = {
      newItems: [],
      notHeard: [
        { id: 't1', title: 'Mustard', remove: true },
        { id: 't2', title: 'Eggs', remove: false }
      ]
    };
    expect(talkPayload(review, NOW).remove).toEqual(['t1']);
  });

  it('is safe on nothing at all', () => {
    expect(talkPayload(null, NOW)).toEqual({ timers: [], templates: [], remove: [] });
  });
});

describe('talkReviewReady', () => {
  it('refuses a ticked row with no duration — a timer without a length is not a timer', () => {
    expect(talkReviewReady([{ included: true, days: null }])).toBe(false);
    expect(talkReviewReady([{ included: true, days: 7 }])).toBe(true);
  });

  it('ignores the duration of a row that is not going in', () => {
    expect(talkReviewReady([{ included: false, days: null }])).toBe(true);
  });

  it('allows a talk-through that only removes things', () => {
    // Saying the fridge is emptier than the app thinks is a legitimate and
    // complete outcome. The photo flow learned the same lesson.
    expect(talkReviewReady([])).toBe(true);
  });
});
