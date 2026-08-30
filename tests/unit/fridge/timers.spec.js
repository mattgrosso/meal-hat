import { describe, it, expect } from 'vitest'
import {
  sortTimers,
  computeTimeLeft,
  timerStatus,
  extendedExpiry,
  templateDaysAfterEdit,
  formatDaySpan
} from '../../../src/store/fridge/timers'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const hoursFromNow = (h) => new Date(NOW.getTime() + h * 60 * 60 * 1000).toISOString()

describe('sortTimers', () => {
  it('converts the Firebase object to an array sorted soonest-first', () => {
    const sorted = sortTimers({
      a: { title: 'Mozzarella', expiryDate: hoursFromNow(24 * 87) },
      b: { title: 'Cheddar', expiryDate: hoursFromNow(48) },
      c: { title: 'Bread', expiryDate: hoursFromNow(77) }
    })
    expect(sorted.map(t => t.title)).toEqual(['Cheddar', 'Bread', 'Mozzarella'])
    expect(sorted[0].id).toBe('b')
  })

  it('handles null and empty maps', () => {
    expect(sortTimers(null)).toEqual([])
    expect(sortTimers({})).toEqual([])
  })
})

describe('computeTimeLeft', () => {
  it('splits the remaining time into days/hours/minutes/seconds', () => {
    const expiry = new Date(NOW.getTime() + ((2 * 24 + 3) * 60 * 60 + 4 * 60 + 5) * 1000)
    expect(computeTimeLeft(expiry.toISOString(), NOW)).toEqual({
      days: 2, hours: 3, minutes: 4, seconds: 5, expired: false
    })
  })

  it('reports an expired timer as all zeros', () => {
    expect(computeTimeLeft(hoursFromNow(-1), NOW)).toEqual({
      days: 0, hours: 0, minutes: 0, seconds: 0, expired: true
    })
  })

  it('treats exactly-now as expired', () => {
    expect(computeTimeLeft(NOW.toISOString(), NOW).expired).toBe(true)
  })
})

describe('timerStatus', () => {
  const statusFor = (h) => timerStatus(computeTimeLeft(hoursFromNow(h), NOW))

  it('maps hours remaining to the card color', () => {
    expect(statusFor(-1)).toBe('expired')
    expect(statusFor(2)).toBe('warning')
    expect(statusFor(24)).toBe('warning')
    expect(statusFor(25)).toBe('caution')
    expect(statusFor(72)).toBe('caution')
    expect(statusFor(73)).toBe('good')
  })
})

describe('extendedExpiry', () => {
  it('extends a live timer from its expiry date', () => {
    const expiry = hoursFromNow(48)
    const extended = extendedExpiry(expiry, 7, NOW)
    expect(extended).toBe(hoursFromNow(48 + 7 * 24))
  })

  it('extends an EXPIRED timer from now, not from the dead date', () => {
    // +1 day on something that died a month ago means "good until
    // tomorrow", not "less dead".
    const expiry = hoursFromNow(-24 * 30)
    const extended = extendedExpiry(expiry, 1, NOW)
    expect(extended).toBe(hoursFromNow(24))
  })
})

describe('templateDaysAfterEdit', () => {
  it('derives the template duration from created -> new expiry', () => {
    const createdAt = NOW.toISOString()
    expect(templateDaysAfterEdit(hoursFromNow(9 * 24), createdAt)).toBe(9)
  })

  it('rounds partial days up', () => {
    const createdAt = NOW.toISOString()
    expect(templateDaysAfterEdit(hoursFromNow(30), createdAt)).toBe(2)
  })

  it('never goes below one day', () => {
    const createdAt = NOW.toISOString()
    expect(templateDaysAfterEdit(hoursFromNow(-5), createdAt)).toBe(1)
  })
})

describe('formatDaySpan', () => {
  it('keeps spans under a week in days', () => {
    expect(formatDaySpan(1)).toBe('1 day')
    expect(formatDaySpan(5)).toBe('5 days')
    expect(formatDaySpan(6.9)).toBe('6 days')
  })

  it('folds full weeks out', () => {
    expect(formatDaySpan(7)).toBe('1 week')
    expect(formatDaySpan(9)).toBe('1 week 2 days')
    expect(formatDaySpan(14)).toBe('2 weeks')
    expect(formatDaySpan(15)).toBe('2 weeks 1 day')
  })
})
