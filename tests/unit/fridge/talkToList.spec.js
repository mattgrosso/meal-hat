import { describe, it, expect } from 'vitest';
import { buildTalkReview, talkPayload } from '../../../src/store/fridge/talkReview';
import { partitionStaples } from '../../../src/store/staples';

// End to end, pure: what he said -> what the fridge holds afterwards -> what
// the shopping list asks for. Built from the real 2026-09-28 read-through,
// which prompted "things that I definitely listed... still ended up on the
// shopping list".

const NOW = new Date('2026-09-28T17:21:00Z');
const inDays = (n) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

const CATALOG = {
  avo: { id: 'avo', name: 'Avocado', packageSize: 1 },
  mozz: { id: 'mozz', name: 'Mozzarella', packageSize: 2 },
  ched: { id: 'ched', name: 'Cheddar Cheese', packageSize: 2 },
  buns: { id: 'buns', name: 'Hot Dog Buns', packageSize: 8 }
};

const row = (id, groceryId, quantity) => ({ id, groceryId, quantity, source: 'meal' });

const said = (name, quantity, over = {}) => ({
  heard: `${quantity} ${name}`,
  name,
  knownFoodMatch: name,
  quantity,
  perishable: true,
  estimatedShelfLifeDays: 10,
  ...over
});

// Apply a payload to a timer map the way `fridge/applyTalk` does.
const applied = (timers, payload) => {
  const out = Object.fromEntries(timers.map((t) => [t.id, { ...t }]));
  payload.timers.forEach((t, i) => { out[`new${i}`] = { ...t }; });
  payload.recount.forEach((r) => { out[r.id].quantity = r.quantity; });
  payload.seen.forEach((r) => { out[r.id].seenAt = NOW.toISOString(); });
  payload.remove.forEach((id) => { delete out[id]; });
  return out;
};

const talk = (items, timers, rows) => {
  const review = buildTalkReview({ items, outOf: [] }, timers, [], NOW);
  const after = applied(timers, talkPayload(review, NOW));
  const later = new Date(NOW.getTime() + 60 * 1000);
  return { review, after, ...partitionStaples(rows, CATALOG, later, {}, after) };
};

const names = (rows) => rows.map((r) => CATALOG[r.groceryId].name);

describe('a talk-through, as the shopping list sees it', () => {
  it('takes an avocado off the list when he says there is one', () => {
    const { list, cupboard } = talk([said('Avocado', 1)], [], [row('r1', 'avo', 1)]);
    expect(names(cupboard)).toEqual(['Avocado']);
    expect(list).toEqual([]);
  });

  it('keeps it off when the avocado was already in the fridge', () => {
    const timers = [{ id: 't1', title: 'Avocado', expiryDate: inDays(4) }];
    const { cupboard } = talk([said('Avocado', 1)], timers, [row('r1', 'avo', 1)]);
    expect(names(cupboard)).toEqual(['Avocado']);
  });

  it('puts it back when the avocado goes unmentioned — the absence rule', () => {
    const timers = [{ id: 't1', title: 'Avocado', expiryDate: inDays(4) }];
    const { review, list } = talk([said('Milk', 1)], timers, [row('r1', 'avo', 1)]);
    expect(review.notHeard.map((r) => r.title)).toEqual(['Avocado']);
    expect(names(list)).toEqual(['Avocado']);
  });

  it('two bags of mozzarella cover a pizza wanting 3 cups', () => {
    const timers = [{ id: 't1', title: 'Mozzarella', expiryDate: inDays(4) }];
    const { list, cupboard } = talk([said('Mozzarella', 2)], timers, [row('r1', 'mozz', 3)]);
    expect(names(cupboard)).toEqual(['Mozzarella']);
    expect(list).toEqual([]);
  });

  it('one bag of mozzarella does not, and says it is one short', () => {
    const timers = [{ id: 't1', title: 'Mozzarella', expiryDate: inDays(4) }];
    const { list } = talk([said('Mozzarella', 1)], timers, [row('r1', 'mozz', 3)]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ partlyOnHand: 1, partlyShort: 1 });
  });

  it('counts a food past its date once he says it is here', () => {
    const timers = [{ id: 't1', title: 'Cheddar Cheese', expiryDate: inDays(-1) }];
    const { review, after, cupboard } = talk([said('Cheddar Cheese', 1)], timers, [row('r1', 'ched', 2)]);
    expect(review.confirmed[0].pastDate).toBe(true);
    // The date is untouched — the wall still shows it past date.
    expect(after.t1.expiryDate).toBe(inDays(-1));
    expect(names(cupboard)).toEqual(['Cheddar Cheese']);
  });

  it('counts a past-date food at the number he said (packages)', () => {
    const timers = [{ id: 't1', title: 'Hot Dog Buns', expiryDate: inDays(-0.1), quantity: 5 }];
    const { list } = talk([said('Hot Dog Buns', 6)], timers, [row('r1', 'buns', 56)]);
    expect(list[0]).toMatchObject({ partlyOnHand: 6, partlyShort: 1 });
  });

  it('does not mark a live timer as seen — only past-date ones need it', () => {
    const timers = [{ id: 't1', title: 'Avocado', expiryDate: inDays(4) }];
    const review = buildTalkReview({ items: [said('Avocado', 1)] }, timers, [], NOW);
    expect(talkPayload(review, NOW).seen).toEqual([]);
  });
});
