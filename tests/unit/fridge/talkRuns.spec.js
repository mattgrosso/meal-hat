import { describe, it, expect } from 'vitest'
import {
  buildTalkRun, readTalkRun, buildLesson, lessonText, lessonsForReader,
  correctionReview, correctionCounts, addedTimerFor, MAX_LESSON_CHARS
} from '../../../src/store/fridge/talkRuns.js'
import { buildTalkReview } from '../../../src/store/fridge/talkReview.js'

const NOW = new Date('2026-11-01T18:00:00Z')

const result = {
  items: [
    { heard: 'a block of pepper jack', name: 'Pepper', knownFoodMatch: '', quantity: 1, counted: 'packages', perishable: true, estimatedShelfLifeDays: 14 }
  ],
  outOf: [{ heard: 'no milk', name: 'Milk', knownFoodMatch: '' }],
  unclear: [{ heard: 'some sauce', why: 'no food named' }]
}

const report = {
  added: [{ name: 'Pepper', heard: 'a block of pepper jack', readAs: '', quantity: null, days: 14, shelfStable: false, startsAt: NOW }],
  confirmed: [{ id: 't1', title: 'Cheddar Cheese', heard: 'cheddar', expiryDate: '2026-11-10T00:00:00Z', timeLeft: { days: 9 } }],
  removed: [{ id: 't2', title: 'Eggs', saidOutOf: false, record: { title: 'Eggs', expiryDate: '2026-11-05T00:00:00Z' } }],
  unclear: [{ heard: 'some sauce', why: 'no food named' }],
  spoken: ['pepper', 'cheddar cheese']
}

describe('buildTalkRun', () => {
  it('keeps his words, what the reader returned, and what changed', () => {
    const run = buildTalkRun({ transcript: 'fridge: a block of pepper jack, no milk', result, report, applied: { added: 1, removed: 1, failed: 0 }, now: NOW })
    expect(run.at).toBe(NOW.toISOString())
    expect(run.transcript).toBe('fridge: a block of pepper jack, no milk')
    expect(run.reader.items[0]).toMatchObject({ heard: 'a block of pepper jack', name: 'Pepper' })
    expect(run.reader.outOf[0].name).toBe('Milk')
    expect(run.report.added[0]).toMatchObject({ name: 'Pepper', heard: 'a block of pepper jack' })
    // Nothing derived at read time, and no Date objects, reach the database.
    expect(run.report.added[0].startsAt).toBeUndefined()
    expect(run.report.confirmed[0].timeLeft).toBeUndefined()
    expect(run.report.confirmed[0].expiryDate).toBe('2026-11-10T00:00:00Z')
    // "We have it" still works on a reopened run.
    expect(run.report.removed[0].record.title).toBe('Eggs')
    expect(run.applied).toEqual({ added: 1, removed: 1, failed: 0 })
  })

  it('reads back whole even though Firebase drops empty lists', () => {
    const stored = JSON.parse(JSON.stringify(buildTalkRun({ transcript: 'x', result: {}, report: {}, applied: null, now: NOW })))
    delete stored.report.added
    delete stored.report.spoken
    const run = readTalkRun('r1', stored)
    expect(run.report.added).toEqual([])
    expect(run.report.spoken).toEqual([])
    expect(run.flagged).toEqual({})
    expect(readTalkRun('r1', null)).toBeNull()
  })
})

describe('lessons', () => {
  it('says what was heard, what it became, and what he meant', () => {
    const lesson = buildLesson({ kind: 'wrong', heard: 'a block of pepper jack', readAs: 'Pepper', said: 'pepper jack cheese', runId: 'r1', now: NOW })
    expect(lesson.runId).toBe('r1')
    expect(lessonText(lesson)).toBe('They said "a block of pepper jack" and an earlier reading took it as "Pepper". What they meant: pepper jack cheese')
  })

  it('a missed food is quoted in his words', () => {
    expect(lessonText(buildLesson({ kind: 'missed', said: 'the hummus', now: NOW })))
      .toBe('An earlier reading missed this, which they had said was in the house: the hummus')
    // A missed lesson with nothing in it says nothing.
    expect(lessonText(buildLesson({ kind: 'missed', said: '  ', now: NOW }))).toBe('')
  })

  it('newest first, capped, and never longer than the reader accepts', () => {
    const lessons = Array.from({ length: 40 }, (_, i) => buildLesson({
      kind: 'missed', said: `food ${i} `.repeat(i === 39 ? 100 : 1), now: new Date(NOW.getTime() + i * 1000)
    }))
    const sent = lessonsForReader(lessons, 30)
    expect(sent).toHaveLength(30)
    expect(sent[0]).toMatch(/food 39/)
    expect(sent.every((line) => line.length <= MAX_LESSON_CHARS)).toBe(true)
  })

  it('reads a lessons node as Firebase hands it back (an object of records)', () => {
    const node = { a: buildLesson({ kind: 'missed', said: 'hummus', now: NOW }) }
    expect(lessonsForReader(node)).toHaveLength(1)
  })
})

describe('a correction is additions only', () => {
  const timers = [
    { id: 't1', title: 'Cheddar Cheese', expiryDate: '2026-11-10T00:00:00Z' },
    { id: 't2', title: 'Eggs', expiryDate: '2026-11-10T00:00:00Z' },
    { id: 't3', title: 'Milk', expiryDate: '2026-11-10T00:00:00Z' }
  ]
  const said = {
    items: [{ heard: 'the hummus', name: 'Hummus', knownFoodMatch: '', quantity: 1, counted: 'packages', perishable: true, estimatedShelfLifeDays: 7 }],
    outOf: [{ heard: 'and we are out of milk', name: 'Milk', knownFoodMatch: '' }],
    unclear: []
  }

  it('removes nothing for being unmentioned, but honours "we\'re out of"', () => {
    const review = buildTalkReview(said, timers, [], NOW)
    // A whole talk-through would take off cheddar and eggs too.
    expect(review.notHeard.map((row) => row.title).sort()).toEqual(['Cheddar Cheese', 'Eggs', 'Milk'])
    const fixed = correctionReview(review)
    expect(fixed.notHeard.map((row) => row.title)).toEqual(['Milk'])
    expect(fixed.newItems.map((row) => row.name)).toEqual(['Hummus'])
  })

  it('logs only the foods it names', () => {
    const counts = correctionCounts(buildTalkReview(said, timers, [], NOW))
    expect(counts).toEqual({ hummu: 1, milk: 0 })
  })
})

describe('addedTimerFor', () => {
  const runAt = '2026-11-01T18:00:00Z'
  it('finds the card this run added, not an older one for the same food', () => {
    const timers = [
      { id: 'old', title: 'Pepper', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'new', title: 'pepper', createdAt: '2026-11-01T18:00:20Z' }
    ]
    expect(addedTimerFor({ name: 'Pepper' }, timers, runAt).id).toBe('new')
    expect(addedTimerFor({ name: 'Pepper' }, [timers[0]], runAt)).toBeNull()
  })
})
