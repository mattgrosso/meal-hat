import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  buildSpokenFor, spokenForDates, spokenForSignature, heldBack, tallyLessSpokenFor, SPOKEN_FOR_DAYS
} from '../../../src/store/fridge/spokenFor'
import { tallyForIdea } from '../../../src/store/fridge/idea'

// Today's idea is made from the tally, and the tally includes the food bought
// for this week's dinners. These tests are for the one rule: the idea must
// not be offered food a planned meal is counting on.

const NOW = new Date(2026, 10, 13, 10) // Fri 13 Nov 2026, 10am local

const catalog = {
  chicken: { id: 'chicken', name: 'Chicken Breast', packageSize: 2 },
  tortillas: { id: 'tortillas', name: 'Tortillas', packageSize: 10 },
  mozz: { id: 'mozz', name: 'Mozzarella', packageSize: 4 },
  sauce: { id: 'sauce', name: 'Tomato Sauce' }, // no packageSize
  pizza: { id: 'pizza', name: 'Leftover pizza', fridgeOnly: true }
}
const meals = [
  { id: 'tacos', ingredients: [{ groceryItemId: 'chicken', quantity: 2 }, { groceryItemId: 'tortillas', quantity: 6 }] },
  { id: 'ziti', ingredients: [{ groceryItemId: 'mozz', quantity: 2 }, { groceryItemId: 'sauce', quantity: 28 }] },
  { id: 'chickenSoup', ingredients: [{ groceryItemId: 'chicken', quantity: 1 }] }
]
const getMeal = (id) => meals.find((meal) => meal.id === id)

describe('the days held', () => {
  it('is today and the six nights after it', () => {
    expect(SPOKEN_FOR_DAYS).toBe(7)
    const dates = spokenForDates(NOW)
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-11-13')
    expect(dates[6]).toBe('2026-11-19')
  })
})

describe('buildSpokenFor', () => {
  const drawnMeals = [
    { mealId: 'tacos', assignedDate: '2026-11-12' }, // yesterday: eaten
    { mealId: 'tacos', assignedDate: '2026-11-13' }, // tonight
    { mealId: 'ziti', assignedDate: '2026-11-16' },
    { mealId: 'chickenSoup', assignedDate: '2026-11-16' },
    { mealId: 'ziti', assignedDate: '2026-11-20' }, // past the week
    { name: 'Pizza night', manual: true, assignedDate: '2026-11-14' }, // one-off, no food
    { name: 'Lesson', assignedDate: '2026-11-15', ingredients: [{ groceryItemId: 'tortillas', quantity: 5 }] }
  ]
  const days = buildSpokenFor({ drawnMeals, getMeal, catalog, now: NOW })

  it('holds the week ahead, by day, and nothing past or beyond it', () => {
    expect(Object.keys(days)).toEqual(['2026-11-13', '2026-11-15', '2026-11-16'])
  })

  it('counts packages through packageSize, summing a food within a day', () => {
    expect(days['2026-11-13']).toEqual({
      'chicken breast': { name: 'Chicken Breast', packages: 1 },
      tortillas: { name: 'Tortillas', packages: 0.6 }
    })
    expect(days['2026-11-16']['chicken breast'].packages).toBe(0.5)
    expect(days['2026-11-16'].mozzarella.packages).toBe(0.5)
  })

  it('takes a food with no packageSize as one whole package', () => {
    expect(days['2026-11-16']['tomato sauce'].packages).toBe(1)
  })

  it('counts a lesson night carrying its own ingredients', () => {
    expect(days['2026-11-15'].tortillas.packages).toBe(0.5)
  })

  it('holds nothing for an empty schedule', () => {
    expect(buildSpokenFor({ drawnMeals: [], getMeal, catalog, now: NOW })).toEqual({})
    expect(buildSpokenFor()).toEqual({})
  })

  it('never names a meal: only foods and amounts reach the fridge', () => {
    expect(JSON.stringify(days)).not.toMatch(/tacos|ziti|Pizza night|Lesson/)
  })

  it('makes keys Firebase accepts', () => {
    const odd = { dr: { id: 'dr', name: 'Dr. Pepper', packageSize: 12 } }
    const out = buildSpokenFor({
      drawnMeals: [{ assignedDate: '2026-11-13', ingredients: [{ groceryItemId: 'dr', quantity: 2 }] }],
      getMeal,
      catalog: odd,
      now: NOW
    })
    expect(Object.keys(out['2026-11-13'])[0]).not.toMatch(/[.$#[\]/]/)
  })
})

describe('tallyLessSpokenFor', () => {
  const tally = [
    { title: 'Chicken Breast', quantity: 2, daysLeft: 3, shelfStable: false },
    { title: 'Tortillas', quantity: 1, daysLeft: 6, shelfStable: false },
    { title: 'Mozzarella', quantity: 0.5, daysLeft: 9, shelfStable: false },
    { title: 'Onions', quantity: 3, daysLeft: 20, shelfStable: false }
  ]
  const days = {
    '2026-11-12': { onions: { name: 'Onions', packages: 3 } }, // yesterday
    '2026-11-13': { 'chicken breast': { name: 'Chicken Breast', packages: 1 }, tortillas: { name: 'Tortillas', packages: 0.6 } },
    '2026-11-16': { 'chicken breast': { name: 'Chicken Breast', packages: 0.5 }, mozzarella: { name: 'Mozzarella', packages: 0.5 } }
  }

  it('drops a food wholly spoken for and leaves the spare of one partly spoken for', () => {
    const out = tallyLessSpokenFor(tally, days, '2026-11-13')
    expect(out.map((row) => [row.title, row.quantity])).toEqual([
      ['Chicken Breast', 0.5],
      ['Tortillas', 0.4],
      ['Onions', 3]
    ])
  })

  it('lets a stale publish go: nights already past hold nothing', () => {
    const out = tallyLessSpokenFor(tally, days, '2026-11-17')
    expect(out).toEqual(tally)
  })

  it('joins on the name the way the rest of the app does, case and spaces aside', () => {
    const out = tallyLessSpokenFor([{ title: '  chicken   breast ', quantity: 1 }], days, '2026-11-13')
    expect(out).toEqual([])
  })

  it('changes nothing when there is nothing spoken for', () => {
    expect(tallyLessSpokenFor(tally, {}, '2026-11-13')).toBe(tally)
    expect(tallyLessSpokenFor(tally, null, '2026-11-13')).toBe(tally)
  })

  it('ignores junk in the published node', () => {
    const held = heldBack({ nope: { a: { name: 'X', packages: 1 } }, '2026-11-13': { a: { name: '', packages: 1 }, b: { name: 'Y', packages: 'lots' } } }, '2026-11-13')
    expect(held.size).toBe(0)
  })

  it('works on the real tally shape', () => {
    const timers = [
      { id: 'a', title: 'Chicken Breast', quantity: 2, expiryDate: new Date(NOW.getTime() + 3 * 86400000).toISOString() }
    ]
    const out = tallyLessSpokenFor(tallyForIdea(timers, NOW), days, '2026-11-13')
    expect(out).toEqual([expect.objectContaining({ title: 'Chicken Breast', quantity: 0.5 })])
  })
})

describe('spokenForSignature', () => {
  it('ignores key order and is the same for null and empty', () => {
    const a = { '2026-11-13': { x: { name: 'X', packages: 1 }, y: { name: 'Y', packages: 2 } } }
    const b = { '2026-11-13': { y: { name: 'Y', packages: 2 }, x: { name: 'X', packages: 1 } } }
    expect(spokenForSignature(a)).toBe(spokenForSignature(b))
    expect(spokenForSignature(null)).toBe(spokenForSignature({}))
    expect(spokenForSignature(a)).not.toBe(spokenForSignature({}))
  })
})

describe('the wiring', () => {
  const fridgeStore = readFileSync(new URL('../../../src/store/fridge/index.js', import.meta.url), 'utf8')
  const store = readFileSync(new URL('../../../src/store/index.js', import.meta.url), 'utf8')

  it('the idea is asked for with the spoken-for food taken off, and only once that has loaded', () => {
    expect(fridgeStore).toMatch(/tallyLessSpokenFor\(tallyForIdea\(getters\.allTimers\), state\.spokenFor, day\)/)
    expect(fridgeStore).toMatch(/loaded: state\.ideasLoaded && state\.spokenForLoaded/)
  })

  it('the signed-in app republishes on every schedule, meal and catalog change', () => {
    const calls = store.match(/dispatch\('publishSpokenFor'\)/g) || []
    expect(calls.length).toBeGreaterThanOrEqual(4)
  })
})
