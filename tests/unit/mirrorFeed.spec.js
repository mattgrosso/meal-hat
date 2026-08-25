import { describe, it, expect } from 'vitest';
import { buildMirrorFeed, FEED_WINDOW_DAYS } from '../../src/assets/javascript/mirrorFeed.js';

// Local noon, so nothing here is one timezone away from testing a different day
// than it reads as.
const at = (iso) => new Date(`${iso}T12:00:00`).getTime();

const MEALS = [
  { id: 'm1', name: 'Tacos' },
  { id: 'm2', name: 'Curry' },
  { id: 'm3', name: 'Pizza' }
];

const drawn = (id, mealId, assignedDate) => ({ id, mealId, assignedDate });

describe('buildMirrorFeed', () => {
  const now = at('2026-08-24');

  it('publishes upcoming meals in the shape the mirror renders', () => {
    const feed = buildMirrorFeed(
      [drawn('d1', 'm1', '2026-08-25')],
      MEALS,
      { now }
    );

    expect(feed.updatedAt).toBe(now);
    expect(feed.upcoming).toEqual([
      { assignedDate: '2026-08-25', meal: { id: 'm1', name: 'Tacos' } }
    ]);
  });

  it('includes today — tonight\'s dinner has not been eaten yet', () => {
    const feed = buildMirrorFeed([drawn('d1', 'm1', '2026-08-24')], MEALS, { now });

    expect(feed.upcoming.map((row) => row.assignedDate)).toEqual(['2026-08-24']);
  });

  it('drops meals that are in the past', () => {
    const feed = buildMirrorFeed(
      [drawn('d1', 'm1', '2026-08-23'), drawn('d2', 'm2', '2026-08-25')],
      MEALS,
      { now }
    );

    expect(feed.upcoming.map((row) => row.meal.name)).toEqual(['Curry']);
  });

  it('sorts chronologically regardless of stored order', () => {
    const feed = buildMirrorFeed(
      [
        drawn('d1', 'm3', '2026-08-30'),
        drawn('d2', 'm1', '2026-08-25'),
        drawn('d3', 'm2', '2026-08-27')
      ],
      MEALS,
      { now }
    );

    expect(feed.upcoming.map((row) => row.meal.name)).toEqual(['Tacos', 'Curry', 'Pizza']);
  });

  it('accepts the keyed object Firebase actually stores, not just an array', () => {
    const feed = buildMirrorFeed(
      { d1: drawn('d1', 'm1', '2026-08-25') },
      { m1: { id: 'm1', name: 'Tacos' } },
      { now }
    );

    expect(feed.upcoming).toHaveLength(1);
    expect(feed.upcoming[0].meal.name).toBe('Tacos');
  });

  // The window is what keeps the mirror correct between app opens. Publishing
  // only what the mirror displays would empty it three days after a draw.
  it('publishes well past the three meals the mirror shows', () => {
    const schedule = Array.from({ length: 14 }, (unused, index) =>
      drawn(`d${index}`, 'm1', `2026-09-${String(index + 1).padStart(2, '0')}`)
    );

    const feed = buildMirrorFeed(schedule, MEALS, { now });

    expect(feed.upcoming.length).toBeGreaterThan(3);
    expect(feed.upcoming).toHaveLength(14);
  });

  it('stops at the window horizon', () => {
    const feed = buildMirrorFeed(
      [
        drawn('d1', 'm1', '2026-09-14'), // 21 days out — the last day in
        drawn('d2', 'm2', '2026-09-15') // 22 days out — beyond it
      ],
      MEALS,
      { now }
    );

    expect(FEED_WINDOW_DAYS).toBe(21);
    expect(feed.upcoming.map((row) => row.assignedDate)).toEqual(['2026-09-14']);
  });

  // A blank line on the mirror is worse than a shorter list.
  it('drops a drawn meal whose meal has been deleted from the hat', () => {
    const feed = buildMirrorFeed(
      [drawn('d1', 'deleted-meal', '2026-08-25'), drawn('d2', 'm1', '2026-08-26')],
      MEALS,
      { now }
    );

    expect(feed.upcoming.map((row) => row.meal.name)).toEqual(['Tacos']);
  });

  it('drops a meal with no usable name', () => {
    const feed = buildMirrorFeed(
      [drawn('d1', 'm9', '2026-08-25')],
      [{ id: 'm9', name: '   ' }],
      { now }
    );

    expect(feed.upcoming).toEqual([]);
  });

  // The store's records have gone through several date formats; toISODate
  // tolerates all of them and the feed must publish only the ISO one, because
  // the mirror does a plain string comparison against today.
  it('normalizes a legacy toDateString() date to ISO', () => {
    const feed = buildMirrorFeed(
      [drawn('d1', 'm1', 'Tue Aug 25 2026')],
      MEALS,
      { now }
    );

    expect(feed.upcoming[0].assignedDate).toBe('2026-08-25');
  });

  it('survives an empty or missing schedule', () => {
    expect(buildMirrorFeed(null, MEALS, { now }).upcoming).toEqual([]);
    expect(buildMirrorFeed([], null, { now }).upcoming).toEqual([]);
    expect(buildMirrorFeed(undefined, undefined, { now }).upcoming).toEqual([]);
  });

  it('ignores records with no parseable date', () => {
    const feed = buildMirrorFeed(
      [drawn('d1', 'm1', 'not a date'), drawn('d2', 'm2', null), drawn('d3', 'm3', '2026-08-25')],
      MEALS,
      { now }
    );

    expect(feed.upcoming.map((row) => row.meal.name)).toEqual(['Pizza']);
  });

  // Nothing published may carry the household's groceries, quantities, or the
  // rest of a meal record. The mirror needs a day and a name.
  it('publishes nothing beyond the date and the meal name', () => {
    const feed = buildMirrorFeed(
      [{ id: 'd1', mealId: 'm1', assignedDate: '2026-08-25', notes: 'buy wine' }],
      [{ id: 'm1', name: 'Tacos', ingredients: [{ groceryId: 'g1', quantity: 2 }], minDaysBetween: 14 }],
      { now }
    );

    expect(Object.keys(feed.upcoming[0]).sort()).toEqual(['assignedDate', 'meal']);
    expect(Object.keys(feed.upcoming[0].meal).sort()).toEqual(['id', 'name']);
  });
});
