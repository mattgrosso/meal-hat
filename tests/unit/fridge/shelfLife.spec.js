import { describe, it, expect } from 'vitest';
import {
  beliefFrom,
  foldObservation,
  guessDays,
  isWorthLearning,
  roundDays,
  MAX_DRIFT_FACTOR
} from '../../../src/store/fridge/shelfLife';

describe('beliefFrom', () => {
  it('reads a template written before counts existed as one observation', () => {
    // And it anchors to what it already says, which is the only general
    // statement about the food such a template carries.
    expect(beliefFrom({ title: 'Milk', days: 10 })).toEqual({ days: 10, count: 1, anchor: 10 });
  });

  it('uses the count when there is one', () => {
    expect(beliefFrom({ days: 10, count: 5 })).toEqual({ days: 10, count: 5, anchor: 10 });
    expect(beliefFrom({ days: 12, count: 5, anchor: 7 }).anchor).toBe(7);
    // The precise mean wins over its rounded face, which is what lets a belief
    // keep converging instead of stalling on a rounding boundary.
    expect(beliefFrom({ days: 8, mean: 8.4, count: 5 }).days).toBe(8.4);
  });

  it('is nothing when there is no usable number', () => {
    expect(beliefFrom(null)).toBeNull();
    expect(beliefFrom({ days: 0 })).toBeNull();
    expect(beliefFrom({ days: 'ages' })).toBeNull();
  });
});

describe('foldObservation', () => {
  it('takes the first observation at face value', () => {
    expect(foldObservation(null, 7)).toMatchObject({ days: 7, count: 1, anchor: 7 });
  });

  it('averages rather than overwriting', () => {
    // The old behaviour was last-write-wins, which is how a food ran away.
    expect(foldObservation({ days: 10, count: 1 }, 14)).toMatchObject({ days: 12, count: 2, anchor: 10 });
  });

  // THE DRIFT, REPRODUCED. Extending a nearly-dead loaf used to re-teach the
  // app that sandwich bread lasts that long from new, and the next extension
  // compounded it — 7 days became 76 over a few months.
  it('cannot be run away with by repeated extensions', () => {
    // THE FIRST VERSION OF THIS MODULE FAILED THIS TEST, and instructively:
    // clamping each observation against the CURRENT MEAN only slows a runaway,
    // because the mean rises and the next clamp is looser. Twelve extensions
    // still took 7-day bread to 57. The anchor is what actually bounds it.
    let template = { days: 7, count: 1, anchor: 7 };
    for (let i = 0; i < 50; i += 1) {
      template = foldObservation(template, 90); // every time, absurdly long
    }
    // It moves — the evidence is real — but it stays in the realm of bread,
    // forever, however many times it is told otherwise.
    expect(template.days).toBe(14);
    expect(template.count).toBe(51);
  });

  it('anchors a new food to the model\'s estimate, not to the first item seen', () => {
    // "This loaf is nearly gone, give it 2 days" should not permanently define
    // bread as a 2-day food. The estimate is about the FOOD; the observation
    // is about one item of it.
    const fresh = foldObservation(null, 2, { anchor: 8 });
    expect(fresh).toMatchObject({ days: 2, count: 1, anchor: 8 });
    // And that anchor is what lets the belief climb back out. It converges on
    // the evidence rather than snapping to it — deliberately, since a running
    // mean is the thing that stops one loaf redefining bread.
    let t = fresh;
    for (let i = 0; i < 30; i += 1) t = foldObservation(t, 10);
    expect(t.days).toBe(10);
  });

  it('clamps one observation against what is already believed', () => {
    // 90 against a belief of 7 is pulled back to 14 before averaging.
    expect(foldObservation({ days: 7, count: 1 }, 90)).toMatchObject({ days: 11, count: 2, anchor: 7 });
    // And the same in the other direction.
    expect(foldObservation({ days: 20, count: 1 }, 1)).toMatchObject({ days: 15, count: 2, anchor: 20 });
  });

  it('gets harder to move as evidence accumulates', () => {
    const young = foldObservation({ days: 10, count: 1 }, 20);
    const old = foldObservation({ days: 10, count: 8 }, 20);
    expect(young.days - 10).toBeGreaterThan(old.days - 10);
  });

  it('keeps counting past the confidence cap', () => {
    // The cap limits INFLUENCE, not memory. Resetting the count would quietly
    // forget how often a food has been seen.
    expect(foldObservation({ days: 10, count: 40 }, 10).count).toBe(41);
  });

  it('ignores an unusable observation rather than corrupting the belief', () => {
    expect(foldObservation({ days: 10, count: 3 }, null)).toMatchObject({ days: 10, count: 3, anchor: 10 });
    expect(foldObservation({ days: 10, count: 3 }, -5)).toMatchObject({ days: 10, count: 3, anchor: 10 });
  });
});

describe('guessDays', () => {
  it('uses the model when the house has never seen this food', () => {
    expect(guessDays({ estimate: 12 })).toBe(12);
  });

  it('uses the house when there is no model estimate', () => {
    expect(guessDays({ template: { days: 13, count: 3 } })).toBe(13);
  });

  it('takes the house at its word, even on one observation', () => {
    // The first version of this blended the two and produced answers worse
    // than either: a carefully taught 240-day frozen spinach against a model
    // guessing 900 came out at 680, which is nobody's number and nobody's
    // food. What the house has observed about its own fridge wins.
    expect(guessDays({ estimate: 6, template: { days: 12, count: 1 } })).toBe(12);
    expect(guessDays({ estimate: 900, template: { days: 240, count: 1 } })).toBe(240);
  });

  it('keeps taking the house at its word as evidence accumulates', () => {
    expect(guessDays({ estimate: 6, template: { days: 12, count: 8 } })).toBe(12);
  });

  // THE BACKSTOP. This is the number that made hamburger buns absurd.
  it('will not let the house drag a guess more than twice the model', () => {
    const guess = guessDays({ estimate: 7, template: { days: 76, count: 50 } });
    expect(guess).toBe(7 * MAX_DRIFT_FACTOR);
  });

  it('DOES let the house go as short as it likes', () => {
    // The two directions are not symmetric. Too long lets food rot behind a
    // timer saying it is fine; too short costs a glance at something still
    // good. Every other rule in this app errs early, and so does this one.
    expect(guessDays({ estimate: 20, template: { days: 1, count: 50 } })).toBe(1);
  });

  it('is null only when nothing at all is known', () => {
    expect(guessDays({})).toBeNull();
    expect(guessDays()).toBeNull();
  });

  it('never returns a timer of no length', () => {
    expect(guessDays({ estimate: 0.2 })).toBe(1);
    expect(roundDays(0)).toBe(1);
  });

  it('agrees with itself: a confident house matching the model stays put', () => {
    expect(guessDays({ estimate: 240, template: { days: 240, count: 8 } })).toBe(240);
  });
});

describe('isWorthLearning', () => {
  it('only counts a row carrying a real signal', () => {
    // A row that accepted the standing guess teaches nothing. A belief that
    // grows more confident by agreeing with itself is an echo, not evidence.
    expect(isWorthLearning({ learn: true })).toBe(true);
    expect(isWorthLearning({ learn: false })).toBe(false);
    expect(isWorthLearning({})).toBe(false);
    expect(isWorthLearning(null)).toBe(false);
  });
});
