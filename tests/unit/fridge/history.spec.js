import { describe, it, expect } from 'vitest'
import {
  sortHistory,
  dayLabel,
  entryTime,
  describeEntry,
  describeSource,
  groupByDay
} from '../../../src/store/fridge/history'

const NOW = new Date('2026-08-26T15:00:00.000Z')
const at = (iso) => new Date(iso).toISOString()

describe('sortHistory', () => {
  it('turns the Firebase object into a newest-first array, keeping ids', () => {
    const rows = sortHistory({
      a: { at: at('2026-08-24T10:00:00Z'), action: 'added', title: 'Milk' },
      b: { at: at('2026-08-26T10:00:00Z'), action: 'removed', title: 'Eggs' },
      c: { at: at('2026-08-25T10:00:00Z'), action: 'added', title: 'Bread' }
    })
    expect(rows.map((r) => r.title)).toEqual(['Eggs', 'Bread', 'Milk'])
    expect(rows[0].id).toBe('b')
  })

  it('is safe on an empty household', () => {
    expect(sortHistory(null)).toEqual([])
    expect(sortHistory({})).toEqual([])
  })
})

describe('dayLabel', () => {
  it('names today and yesterday, and dates everything older', () => {
    expect(dayLabel(at('2026-08-26T09:00:00Z'), NOW)).toBe('Today')
    expect(dayLabel(at('2026-08-25T09:00:00Z'), NOW)).toBe('Yesterday')
    expect(dayLabel(at('2026-08-22T09:00:00Z'), NOW)).toMatch(/Aug/)
  })

  // Calendar days, not 24-hour blocks: something logged at 11pm last night is
  // "Yesterday" at 8am, not "Today, 9 hours ago".
  it('counts calendar days rather than elapsed hours', () => {
    const lateLastNight = new Date('2026-08-25T23:30:00')
    const thisMorning = new Date('2026-08-26T08:00:00')
    expect(dayLabel(lateLastNight.toISOString(), thisMorning)).toBe('Yesterday')
  })

  it('gives nothing back for an unusable timestamp', () => {
    expect(dayLabel(undefined, NOW)).toBe('')
    expect(dayLabel('not a date', NOW)).toBe('')
  })
})

describe('entryTime', () => {
  it('formats a clock time and shrugs off junk', () => {
    expect(entryTime(at('2026-08-26T15:00:00Z'))).toMatch(/\d/)
    expect(entryTime('nonsense')).toBe('')
  })
})

describe('describeEntry', () => {
  it('reads as a sentence for every action', () => {
    expect(describeEntry({ action: 'added', title: 'Milk' })).toBe('Added Milk')
    expect(describeEntry({ action: 'removed', title: 'Eggs' })).toBe('Removed Eggs')
    expect(describeEntry({ action: 'extended', title: 'Butter' })).toBe('Extended Butter')
    expect(describeEntry({ action: 'relearned', title: 'Spinach' })).toBe('Re-learned Spinach')
  })

  it('still says something when the record is thin', () => {
    expect(describeEntry({ action: 'removed' })).toBe('Removed an item')
    expect(describeEntry({})).toBe('Changed an item')
    expect(describeEntry(null)).toBe('Changed an item')
  })
})

describe('describeSource', () => {
  // The same removal means different things depending on where it came from.
  it('distinguishes a deliberate removal from a fridge check', () => {
    expect(describeSource({ source: 'hand' })).toBe('by hand')
    expect(describeSource({ source: 'fridge' })).toBe('from a fridge check')
    expect(describeSource({ source: 'scan' })).toBe('from a photo')
    expect(describeSource({ source: 'edit' })).toBe('from the wall')
  })

  it('says nothing rather than guessing', () => {
    expect(describeSource({ source: 'who knows' })).toBe('')
    expect(describeSource({})).toBe('')
  })
})

describe('groupByDay', () => {
  const entries = [
    { id: '1', at: at('2026-08-26T14:00:00Z'), action: 'added', title: 'Milk' },
    { id: '2', at: at('2026-08-26T09:00:00Z'), action: 'added', title: 'Eggs' },
    { id: '3', at: at('2026-08-25T09:00:00Z'), action: 'removed', title: 'Bread' }
  ]

  it('heads each day once and keeps the order it was given', () => {
    const sections = groupByDay(entries, NOW)
    expect(sections.map((s) => s.label)).toEqual(['Today', 'Yesterday'])
    expect(sections[0].entries.map((e) => e.title)).toEqual(['Milk', 'Eggs'])
    expect(sections[1].entries).toHaveLength(1)
  })

  // A log that files an entry under the wrong day is worse than a short one.
  it('drops an entry it cannot date rather than misfiling it', () => {
    const sections = groupByDay([...entries, { id: '4', action: 'added', title: 'Ghost' }], NOW)
    const titles = sections.flatMap((s) => s.entries.map((e) => e.title))
    expect(titles).not.toContain('Ghost')
    expect(titles).toHaveLength(3)
  })

  it('is safe on nothing at all', () => {
    expect(groupByDay(null, NOW)).toEqual([])
  })
})
