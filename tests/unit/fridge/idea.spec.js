import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'module'
import {
  ideaDay, formatIdeaDay, tallyForIdea, recentIdeaNames, ideaToShow,
  shouldAskForIdea, ideaDaysToDrop, ideaIngredients, ideaUses, formatSoon,
  swatchFor, SWATCHES, MIN_TALLY, IDEA_RETRY_MS, IDEA_DAY_STARTS_AT_HOUR
} from '../../../src/store/fridge/idea'
import { submitIdea, requestIdea, resolveIdeaFlag, IDEA_ON_BY_DEFAULT } from '../../../src/utils/fridge/idea'

// TODAY'S IDEA: one thing to cook today from what is in the house. Matt's
// rule is the one these tests exist for: "the recipes should only ever be
// able to be made with what we already have in the house."

const lambda = createRequire(import.meta.url)('../../../aws-lambda/idea.js')

const NOW = new Date('2026-11-09T15:00:00Z') // Monday, 10am in the house
const inDays = (days) => new Date(NOW.getTime() + days * 86400000 + 3600000).toISOString()
const timer = (title, days, extra = {}) => ({ id: title, title, expiryDate: inDays(days), ...extra })

const KITCHEN = [
  timer('Orzo', 300, { shelfStable: true }),
  timer('Onions', 20),
  timer('Garlic', 30, { quantity: 0.5 }),
  timer('Olive Oil', 300, { shelfStable: true }),
  timer('Frozen Spinach', 90),
  timer('Vegetable Broth', 200, { shelfStable: true }),
  timer('Cream cheese', 3),
  timer('Avocado', 1),
  timer('Lettuce (not iceberg)', 2),
  timer('Salt', 900, { shelfStable: true })
]
const TALLY = tallyForIdea(KITCHEN, NOW)

const GOOD = {
  name: 'Orzo with spinach',
  line: 'The orzo cooks right in the broth.',
  minutes: 35,
  ingredients: [
    { name: 'orzo', amount: '1 package', from: 'house', listName: 'Orzo' },
    { name: 'onion', amount: '1', from: 'house', listName: 'onions' },
    { name: 'olive oil', amount: '1 tablespoon', from: 'house', listName: 'Olive Oil' },
    { name: 'frozen spinach', amount: 'half a package', from: 'house', listName: 'Frozen Spinach' },
    { name: 'vegetable broth', amount: '3 cups', from: 'house', listName: 'Vegetable Broth' },
    { name: 'salt', amount: 'to taste', from: 'spice', listName: '' },
    { name: 'dried oregano', amount: '1 teaspoon', from: 'spice', listName: '' },
    { name: 'water', amount: 'a splash', from: 'water', listName: '' }
  ],
  steps: [
    'Warm the olive oil and soften the onion.',
    'Add the orzo and the broth and boil until creamy.',
    'Stir in the spinach.'
  ]
}

describe('the day', () => {
  it('belongs to the house: Eastern time, turning over at 4am', () => {
    expect(IDEA_DAY_STARTS_AT_HOUR).toBe(4)
    expect(ideaDay(new Date('2026-11-09T15:00:00Z'))).toBe('2026-11-09')
    // 3:59am Eastern on the 10th is still the 9th's idea...
    expect(ideaDay(new Date('2026-11-10T08:59:00Z'))).toBe('2026-11-09')
    // ...and 4am is the 10th.
    expect(ideaDay(new Date('2026-11-10T09:00:00Z'))).toBe('2026-11-10')
    // Summer time moves the line an hour in UTC, not in the kitchen.
    expect(ideaDay(new Date('2026-07-10T07:59:00Z'))).toBe('2026-07-09')
    expect(ideaDay(new Date('2026-07-10T08:00:00Z'))).toBe('2026-07-10')
  })

  it('is the same day in the app and in the Lambda', () => {
    // The Lambda keeps the once-a-day marker by its day and the app files the
    // idea under its own: if they disagree, an idea lands under a day nobody
    // is showing.
    for (let hour = 0; hour < 24 * 3; hour += 1) {
      const at = new Date(Date.UTC(2026, 10, 1, hour, 30))
      expect(ideaDay(at)).toBe(lambda.ideaDay(at))
    }
    expect(MIN_TALLY).toBe(lambda.MIN_TALLY)
  })

  it('reads as a short date on the poster', () => {
    expect(formatIdeaDay('2026-11-09')).toBe('Mon 9 Nov')
    expect(formatIdeaDay('nonsense')).toBe('')
  })
})

describe('the tally the writer sees', () => {
  it('is one row a food, with how much and how long', () => {
    expect(TALLY.find((row) => row.title === 'Avocado')).toEqual({ title: 'Avocado', quantity: 1, daysLeft: 1, shelfStable: false })
    expect(TALLY.find((row) => row.title === 'Garlic').quantity).toBe(0.5)
    expect(TALLY.find((row) => row.title === 'Orzo')).toMatchObject({ daysLeft: null, shelfStable: true })
  })

  it('leaves out what is past its date and what is used up', () => {
    const rows = tallyForIdea([timer('Old Yogurt', -2), timer('Empty Jar', 9, { quantity: 0 }), timer('Milk', 0)], NOW)
    expect(rows.map((row) => row.title)).toEqual(['Milk'])
  })

  it('makes two cards for one food into one row, by the sooner date', () => {
    const rows = tallyForIdea([timer('Milk', 6), timer('milk', 2, { quantity: 0.5 })], NOW)
    expect(rows).toEqual([{ title: 'Milk', quantity: 1.5, daysLeft: 2, shelfStable: false }])
  })

  it('passes the endpoint\'s own check', () => {
    expect(lambda.ideaRequestError({ tally: TALLY, recent: ['Grilled cheese'] })).toBe(null)
  })
})

describe('the request check (Lambda)', () => {
  it('refuses a kitchen too small to cook from', () => {
    expect(lambda.ideaRequestError({ tally: TALLY.slice(0, 5) })).toMatchObject({ status: 400 })
  })

  it('refuses a malformed tally before it costs anything', () => {
    expect(lambda.ideaRequestError(null)).toMatchObject({ status: 400 })
    expect(lambda.ideaRequestError({ tally: 'everything' })).toMatchObject({ status: 400 })
    expect(lambda.ideaRequestError({ tally: [...TALLY, { title: '' }] })).toMatchObject({ status: 400 })
    expect(lambda.ideaRequestError({ tally: [...TALLY, { title: 'x'.repeat(81) }] })).toMatchObject({ status: 400 })
    expect(lambda.ideaRequestError({ tally: [...TALLY, { title: 'Rice', quantity: 'lots' }] })).toMatchObject({ status: 400 })
    expect(lambda.ideaRequestError({ tally: TALLY, recent: 'pasta' })).toMatchObject({ status: 400 })
    expect(lambda.ideaRequestError({ tally: Array(401).fill({ title: 'Rice' }) })).toMatchObject({ status: 413 })
  })
})

describe('the prompt (Lambda)', () => {
  const prompt = lambda.buildIdeaPrompt({ tally: TALLY, recent: ['Grilled cheese with pickles'] })

  it('lists the kitchen with amounts and dates', () => {
    expect(prompt).toContain('- Avocado | 1 day left')
    expect(prompt).toContain('- Garlic | 0.5 packages | 30 days left')
    expect(prompt).toContain('- Orzo | keeps')
  })

  it('names the last few days so today differs', () => {
    expect(prompt).toContain('  - Grilled cheese with pickles')
    expect(lambda.buildIdeaPrompt({ tally: TALLY })).not.toContain('last few days')
  })
})

describe('only what is in the house (Lambda)', () => {
  it('passes a dish made from the list, spices and water', () => {
    const result = lambda.checkIdea(GOOD, TALLY)
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('gives each house ingredient the tally\'s own spelling', () => {
    const { idea } = lambda.checkIdea(GOOD, TALLY)
    expect(idea.ingredients.find((item) => item.name === 'onion').listName).toBe('Onions')
    // Salt was filed as a spice, and the tally happens to know it.
    expect(idea.ingredients.find((item) => item.name === 'salt').listName).toBe('Salt')
  })

  it('fails a dish that needs a food the house does not have', () => {
    const idea = {
      ...GOOD,
      ingredients: [...GOOD.ingredients, { name: 'feta', amount: 'a handful', from: 'house', listName: 'Feta' }]
    }
    const result = lambda.checkIdea(idea, TALLY)
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('"Feta" is not a name on the list')
  })

  it('fails a step that reaches for a staple the ingredients do not have', () => {
    const idea = { ...GOOD, steps: [...GOOD.steps, 'Finish with a squeeze of lemon and a knob of butter.'] }
    const result = lambda.checkIdea(idea, TALLY)
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('uses lemon')
    expect(result.problems.join(' ')).toContain('uses butter')
  })

  it('does not mistake "boil" for oil or "creamy" for cream', () => {
    const idea = {
      ...GOOD,
      ingredients: GOOD.ingredients.filter((item) => item.name !== 'olive oil'),
      steps: ['Boil the orzo in the broth with the onion until creamy.', 'Stir in the spinach.']
    }
    expect(lambda.checkIdea(idea, TALLY).problems).toEqual([])
  })

  it('will not let food be smuggled in as a spice the steps then use', () => {
    // "butter" marked as a spice still has to be named to be used, and being
    // named as a spice is allowed through here only because the prompt and
    // the schema limit spices; what this pins is the step check.
    const idea = { ...GOOD, steps: ['Fry the onion in butter.', 'Add the orzo and broth.'] }
    expect(lambda.checkIdea(idea, TALLY).ok).toBe(false)
  })

  it('fails a dish with nothing much from the house, no steps, or no name', () => {
    expect(lambda.checkIdea({ ...GOOD, ingredients: GOOD.ingredients.slice(0, 1) }, TALLY).ok).toBe(false)
    expect(lambda.checkIdea({ ...GOOD, steps: [] }, TALLY).ok).toBe(false)
    expect(lambda.checkIdea({ ...GOOD, name: ' ' }, TALLY).ok).toBe(false)
    expect(lambda.checkIdea(null, TALLY).ok).toBe(false)
  })
})

describe('writing the idea (Lambda)', () => {
  const BAD = { ...GOOD, steps: [...GOOD.steps, 'Squeeze over a lemon.'] }

  it('returns a good first answer without asking twice', async () => {
    const readStructured = vi.fn().mockResolvedValue(GOOD)
    const result = await lambda.readIdea({ idea: { tally: TALLY } }, { readStructured })
    expect(readStructured).toHaveBeenCalledTimes(1)
    expect(result.kind).toBe('idea')
    expect(result.idea.name).toBe('Orzo with spinach')
  })

  it('asks once more, with the reasons, when the first cannot be made', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const readStructured = vi.fn().mockResolvedValueOnce(BAD).mockResolvedValueOnce(GOOD)
    const result = await lambda.readIdea({ idea: { tally: TALLY } }, { readStructured })
    expect(readStructured).toHaveBeenCalledTimes(2)
    const { messages } = readStructured.mock.calls[1][0]
    expect(messages).toHaveLength(3)
    expect(messages[2].content).toContain('uses lemon')
    expect(result.idea.steps).toHaveLength(3)
    log.mockRestore()
  })

  it('has no idea today rather than a wrong one', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const readStructured = vi.fn().mockResolvedValue(BAD)
    await expect(lambda.readIdea({ idea: { tally: TALLY } }, { readStructured }))
      .rejects.toMatchObject({ message: lambda.NO_IDEA, userFacing: true })
    expect(readStructured).toHaveBeenCalledTimes(2)
    log.mockRestore()
  })
})

describe('what to show and when to ask', () => {
  const ideas = { '2026-11-08': { name: 'Yesterday' }, '2026-11-01': { name: 'Last week' } }

  it('shows today\'s, else yesterday\'s, else nothing', () => {
    expect(ideaToShow({ ...ideas, '2026-11-09': { name: 'Today' } }, '2026-11-09')).toMatchObject({ day: '2026-11-09', today: true })
    expect(ideaToShow(ideas, '2026-11-09')).toMatchObject({ day: '2026-11-08', today: false })
    expect(ideaToShow(ideas, '2026-11-10')).toBe(null)
    expect(ideaToShow({}, '2026-11-09')).toBe(null)
    // Across a month end and the clocks going back.
    expect(ideaToShow({ '2026-10-31': { name: 'Halloween' } }, '2026-11-01')).toMatchObject({ day: '2026-10-31' })
    expect(ideaToShow({ '2026-11-01': { name: 'Sunday' } }, '2026-11-02')).toMatchObject({ day: '2026-11-01' })
  })

  it('asks only when it is known there is none, and the kitchen is big enough', () => {
    const base = { loaded: true, ideas, day: '2026-11-09', tallyCount: 40, asking: false, lastTriedAt: 0, now: 10 * IDEA_RETRY_MS }
    expect(shouldAskForIdea(base)).toBe(true)
    expect(shouldAskForIdea({ ...base, loaded: false })).toBe(false)
    expect(shouldAskForIdea({ ...base, asking: true })).toBe(false)
    expect(shouldAskForIdea({ ...base, ideas: { '2026-11-09': { name: 'Today' } } })).toBe(false)
    expect(shouldAskForIdea({ ...base, tallyCount: MIN_TALLY - 1 })).toBe(false)
  })

  it('waits half an hour after a try that failed', () => {
    const base = { loaded: true, ideas: {}, day: '2026-11-09', tallyCount: 40, asking: false, lastTriedAt: 1000 }
    expect(shouldAskForIdea({ ...base, now: 1000 + IDEA_RETRY_MS - 1 })).toBe(false)
    expect(shouldAskForIdea({ ...base, now: 1000 + IDEA_RETRY_MS })).toBe(true)
  })

  it('steers away from recent names, newest first', () => {
    expect(recentIdeaNames({ ...ideas, '2026-11-05': {} })).toEqual(['Yesterday', 'Last week'])
    expect(recentIdeaNames(ideas, 1)).toEqual(['Yesterday'])
  })

  it('keeps a month of ideas and drops the rest', () => {
    const kept = { '2026-10-09': {}, '2026-10-10': {}, '2026-11-08': {}, 'not-a-day': {} }
    expect(ideaDaysToDrop(kept, '2026-11-09')).toEqual(['2026-10-09'])
  })
})

describe('the idea against the fridge as it stands', () => {
  const idea = lambda.checkIdea({
    ...GOOD,
    ingredients: [
      ...GOOD.ingredients,
      { name: 'avocado', amount: '1', from: 'house', listName: 'Avocado' },
      { name: 'cream cheese', amount: '3 tablespoons', from: 'house', listName: 'Cream cheese' }
    ]
  }, TALLY).idea

  it('says which foods are going off soon', () => {
    const byName = Object.fromEntries(ideaIngredients(idea, KITCHEN, NOW).map((item) => [item.name, item]))
    expect(byName.avocado).toMatchObject({ soon: true, gone: false, daysLeft: 1 })
    expect(byName['cream cheese']).toMatchObject({ soon: true, daysLeft: 3 })
    expect(byName.onion).toMatchObject({ soon: false, gone: false })
    expect(byName.orzo).toMatchObject({ soon: false, daysLeft: null })
    expect(byName.salt).toMatchObject({ soon: false, gone: false })
  })

  it('notices a food eaten since the idea was written', () => {
    const later = KITCHEN.filter((item) => item.title !== 'Frozen Spinach')
    const spinach = ideaIngredients(idea, later, NOW).find((item) => item.name === 'frozen spinach')
    expect(spinach.gone).toBe(true)
  })

  it('names the house foods under the dish, soonest first, never the salt', () => {
    const uses = ideaUses(idea, KITCHEN, NOW)
    expect(uses.slice(0, 2).map((item) => item.listName)).toEqual(['Avocado', 'Cream cheese'])
    expect(uses.some((item) => item.from !== 'house')).toBe(false)
  })

  it('counts down in words', () => {
    expect([0, 1, 4, null].map(formatSoon)).toEqual(['use today', '1 day left', '4 days left', ''])
  })

  it('wears one flat colour a day, in turn', () => {
    const week = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map(swatchFor)
    expect(new Set(week.slice(0, 4)).size).toBe(4)
    expect(week[4]).toBe(week[0])
    week.forEach((colour) => expect(SWATCHES).toContain(colour))
    expect(swatchFor('nonsense')).toBe(SWATCHES[0])
  })
})

describe('asking the endpoint', () => {
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
  const options = (fetchImpl) => ({ url: 'https://example.test/scan', householdKey: 'k'.repeat(32), idToken: 'token', fetchImpl, sleep: async () => {} })

  it('posts the tally as an idea request and returns the job', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(202, { jobId: 'job-1' }))
    expect(await submitIdea({ tally: TALLY, recent: ['Soup'] }, options(fetchImpl))).toBe('job-1')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://example.test/scan')
    expect(init.headers.Authorization).toBe(`Bearer ${'k'.repeat(32)}`)
    expect(JSON.parse(init.body)).toEqual({ idea: { tally: TALLY, recent: ['Soup'] } })
  })

  it('knows "today has had its tries" from an ordinary failure', async () => {
    const spent = vi.fn().mockResolvedValue(json(429, { error: 'No idea today. There will be one tomorrow.' }))
    await expect(submitIdea({ tally: TALLY }, options(spent))).rejects.toMatchObject({ spent: true })
    const broken = vi.fn().mockResolvedValue(json(500, {}))
    await expect(submitIdea({ tally: TALLY }, options(broken))).rejects.toMatchObject({ spent: false })
  })

  it('waits for the job and hands back the idea itself', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(202, { jobId: 'job-1' }))
      .mockResolvedValueOnce(json(200, { status: 'pending' }))
      .mockResolvedValueOnce(json(200, { status: 'done', kind: 'idea', idea: GOOD }))
    expect(await requestIdea({ tally: TALLY }, options(fetchImpl))).toEqual(GOOD)
  })
})

describe('whether this device shows the idea', () => {
  const storage = (initial = {}) => {
    const map = { ...initial }
    return { getItem: (k) => (k in map ? map[k] : null), setItem: (k, v) => { map[k] = v }, map }
  }

  it('is on unless a device has turned it off (Matt said yes, 2026-11-09)', () => {
    expect(IDEA_ON_BY_DEFAULT).toBe(true)
    expect(resolveIdeaFlag({ location: { search: '' }, storage: storage() })).toBe(true)
    expect(resolveIdeaFlag({ location: { search: '' }, storage: storage({ 'fridge.idea': '0' }) })).toBe(false)
  })

  it('is turned on for a device by one visit, and remembered', () => {
    const kept = storage()
    expect(resolveIdeaFlag({ location: { search: '?k=abc&idea=1' }, storage: kept })).toBe(true)
    expect(resolveIdeaFlag({ location: { search: '?k=abc' }, storage: kept })).toBe(true)
    expect(resolveIdeaFlag({ location: { search: '?idea=0' }, storage: kept })).toBe(false)
    expect(resolveIdeaFlag({ location: { search: '' }, storage: kept })).toBe(false)
  })

  it('still answers when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
    expect(resolveIdeaFlag({ location: { search: '?idea=1' }, storage: blocked })).toBe(true)
    expect(resolveIdeaFlag({ location: { search: '' }, storage: blocked, fallback: true })).toBe(true)
    expect(resolveIdeaFlag({ location: { search: '' }, storage: blocked, fallback: false })).toBe(false)
  })
})
