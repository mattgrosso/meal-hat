import { describe, it, expect } from 'vitest';
import {
  toISODate,
  fromISODate,
  isUpcoming,
  compareByDate,
  withDrawnDate,
  drawnTooRecently,
  datesInRange,
  DRAWN_DATES_KEPT
} from '../../src/store/schedule.js';

describe('toISODate', () => {
  it('reads the toDateString() format years of records are stored in', () => {
    expect(toISODate('Wed Aug 19 2026')).toBe('2026-08-19');
    expect(toISODate('Sat Aug 15 2026')).toBe('2026-08-15');
  });

  it('reads epoch numbers, which is what drawnDates held', () => {
    expect(toISODate(new Date(2026, 7, 19).getTime())).toBe('2026-08-19');
  });

  it('passes ISO through untouched', () => {
    // Not a no-op worth skipping: round-tripping through Date would parse this
    // as UTC midnight and hand back the 18th anywhere west of Greenwich.
    expect(toISODate('2026-08-19')).toBe('2026-08-19');
  });

  it('reads Date objects', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('returns null for things that are not dates', () => {
    expect(toISODate(null)).toBeNull();
    expect(toISODate('')).toBeNull();
    expect(toISODate('not a date')).toBeNull();
  });
});

describe('fromISODate', () => {
  it('lands on LOCAL midnight, not UTC', () => {
    const date = fromISODate('2026-08-19');

    // The bug this guards: new Date('2026-08-19') is UTC midnight, which is
    // Aug 18 in every negative-offset timezone.
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7);
    expect(date.getDate()).toBe(19);
    expect(date.getHours()).toBe(0);
  });

  it('round-trips with toISODate, leap day included', () => {
    expect(toISODate(fromISODate('2028-02-29'))).toBe('2028-02-29');
    expect(toISODate(fromISODate('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('isUpcoming', () => {
  const now = new Date(2026, 7, 19);

  it('counts today, because tonight is not eaten yet', () => {
    expect(isUpcoming('2026-08-19', now)).toBe(true);
  });

  it('counts the future and excludes the past', () => {
    expect(isUpcoming('2026-08-20', now)).toBe(true);
    expect(isUpcoming('2026-08-18', now)).toBe(false);
  });

  it('works on the old stored format too', () => {
    expect(isUpcoming('Thu Aug 20 2026', now)).toBe(true);
    expect(isUpcoming('Tue Aug 18 2026', now)).toBe(false);
  });
});

describe('compareByDate', () => {
  it('sorts chronologically across mixed formats', () => {
    const rows = [
      { assignedDate: '2026-08-21' },
      { assignedDate: 'Wed Aug 19 2026' },
      { assignedDate: '2026-08-20' }
    ];

    expect(rows.sort(compareByDate).map((r) => toISODate(r.assignedDate)))
      .toEqual(['2026-08-19', '2026-08-20', '2026-08-21']);
  });

  it('puts undated entries last instead of throwing', () => {
    const rows = [{ assignedDate: null }, { assignedDate: '2026-08-19' }];

    expect(rows.sort(compareByDate)[0].assignedDate).toBe('2026-08-19');
  });
});

describe('withDrawnDate', () => {
  it('puts the new date first and keeps lastDrawn in step', () => {
    const meal = { id: 'm1', drawnDates: ['2026-08-01'] };
    const updated = withDrawnDate(meal, '2026-08-19');

    expect(updated.drawnDates).toEqual(['2026-08-19', '2026-08-01']);
    expect(updated.lastDrawn).toBe('2026-08-19');
  });

  it('does not record the same day twice', () => {
    const meal = { id: 'm1', drawnDates: ['2026-08-19', '2026-08-01'] };

    expect(withDrawnDate(meal, '2026-08-19').drawnDates).toEqual(['2026-08-19', '2026-08-01']);
  });

  it('caps the history instead of growing without limit', () => {
    // The reason this exists: only drawnDates[0] is ever read, but the array was
    // unbounded AND rewritten in full on every single draw.
    const drawnDates = Array.from({ length: 40 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    const updated = withDrawnDate({ id: 'm1', drawnDates }, '2026-08-19');

    expect(updated.drawnDates).toHaveLength(DRAWN_DATES_KEPT);
    expect(updated.drawnDates[0]).toBe('2026-08-19');
  });

  it('converts an existing epoch-number history to ISO', () => {
    const meal = { id: 'm1', drawnDates: [new Date(2026, 7, 1).getTime()] };

    expect(withDrawnDate(meal, '2026-08-19').drawnDates).toEqual(['2026-08-19', '2026-08-01']);
  });

  it('seeds from lastDrawn when a record predates drawnDates', () => {
    const meal = { id: 'm1', lastDrawn: new Date(2026, 7, 1).getTime() };

    expect(withDrawnDate(meal, '2026-08-19').drawnDates).toEqual(['2026-08-19', '2026-08-01']);
  });

  it('leaves the meal alone if the date is unusable', () => {
    const meal = { id: 'm1', drawnDates: [] };

    expect(withDrawnDate(meal, 'nonsense')).toBe(meal);
  });
});

describe('drawnTooRecently', () => {
  it('blocks a meal inside its own minDaysBetween', () => {
    const meal = { minDaysBetween: 14, drawnDates: ['2026-08-15'] };

    expect(drawnTooRecently(meal, '2026-08-19')).toBe(true);
  });

  it('allows it once enough days have passed', () => {
    const meal = { minDaysBetween: 14, drawnDates: ['2026-08-01'] };

    expect(drawnTooRecently(meal, '2026-08-19')).toBe(false);
  });

  it('treats the boundary day as allowed', () => {
    const meal = { minDaysBetween: 14, drawnDates: ['2026-08-05'] };

    expect(drawnTooRecently(meal, '2026-08-19')).toBe(false);
  });

  it('never blocks a meal that has not been drawn', () => {
    expect(drawnTooRecently({ minDaysBetween: 14 }, '2026-08-19')).toBe(false);
  });

  it('falls back to lastDrawn on older records', () => {
    const meal = { minDaysBetween: 14, lastDrawn: new Date(2026, 7, 15).getTime() };

    expect(drawnTooRecently(meal, '2026-08-19')).toBe(true);
  });
});

describe('datesInRange', () => {
  it('is inclusive of both ends', () => {
    expect(datesInRange('2026-08-19', '2026-08-22'))
      .toEqual(['2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22']);
  });

  it('handles a single day', () => {
    expect(datesInRange('2026-08-19', '2026-08-19')).toEqual(['2026-08-19']);
  });

  it('crosses a month boundary', () => {
    expect(datesInRange('2026-08-30', '2026-09-01')).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
  });

  it('crosses a DST change without dropping or repeating a day', () => {
    // US DST ends Nov 1 2026. A naive cursor that adds 24h drifts to 23:00 and
    // can emit the same calendar day twice.
    const dates = datesInRange('2026-10-31', '2026-11-02');

    expect(dates).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('returns nothing for a backwards range', () => {
    expect(datesInRange('2026-08-22', '2026-08-19')).toEqual([]);
  });
});
