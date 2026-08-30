import { describe, it, expect } from 'vitest'
import {
  normalizeFoodName,
  findTemplate,
  printedDateToDays,
  scanStartDate,
  daysSince,
  buildReviewItem,
  buildReviewList,
  reviewReady,
  confirmPayload,
  buildReconcile,
  reconcileReady,
  isStorageScan,
  MAX_RECEIPT_AGE_DAYS
} from '../../../src/store/fridge/scanReview'

const NOW = new Date('2026-08-25T12:00:00')
const TEMPLATES = [
  { title: 'Cheddar Cheese', days: 74 },
  { title: 'Strawberries', days: 10 },
  { title: 'Cucumber', days: 5 }
]

const scanItem = (overrides = {}) => ({
  name: 'Milk',
  knownFoodMatch: '',
  printedDate: '',
  estimatedShelfLifeDays: 7,
  box: { x: 0.1, y: 0.1, width: 0.2, height: 0.3 },
  ...overrides
})

describe('normalizeFoodName / findTemplate', () => {
  it('treats case and a trailing s as spelling, not identity', () => {
    expect(normalizeFoodName('Strawberries')).toBe(normalizeFoodName('strawberrie'))
    expect(findTemplate('cucumbers', TEMPLATES).title).toBe('Cucumber')
    expect(findTemplate('CHEDDAR CHEESE', TEMPLATES).title).toBe('Cheddar Cheese')
  })

  it('does not fuzzy-match different foods', () => {
    expect(findTemplate('Cheddar', TEMPLATES)).toBe(null)
    expect(findTemplate('', TEMPLATES)).toBe(null)
  })
})

describe('printedDateToDays', () => {
  it('counts whole days from now to the printed date', () => {
    expect(printedDateToDays('2026-09-02', NOW)).toBe(8)
  })

  it('floors "expires today" at one day instead of a dead timer', () => {
    expect(printedDateToDays('2026-08-25', NOW)).toBe(1)
  })

  it('rejects past and garbage dates', () => {
    expect(printedDateToDays('2026-08-20', NOW)).toBe(null)
    expect(printedDateToDays('soon', NOW)).toBe(null)
    expect(printedDateToDays('', NOW)).toBe(null)
  })
})

describe('buildReviewItem', () => {
  it('a template match arrives ready, named in the household vocabulary', () => {
    const row = buildReviewItem(scanItem({ name: 'cheddar', knownFoodMatch: 'Cheddar Cheese' }), TEMPLATES, NOW)
    expect(row.name).toBe('Cheddar Cheese')
    expect(row.days).toBe(74)
    expect(row.fromTemplate).toBe(true)
  })

  it('falls back to local matching when the model missed the known food', () => {
    const row = buildReviewItem(scanItem({ name: 'strawberries', knownFoodMatch: '' }), TEMPLATES, NOW)
    expect(row.name).toBe('Strawberries')
    expect(row.days).toBe(10)
  })

  // Matt's call: a new food ALWAYS stops for input. The printed date and the
  // estimate are options, never a prefill.
  it('a new food arrives with days unset, options carried', () => {
    const row = buildReviewItem(scanItem({ printedDate: '2026-09-02' }), TEMPLATES, NOW)
    expect(row.days).toBe(null)
    expect(row.fromTemplate).toBe(false)
    expect(row.printedDays).toBe(8)
    expect(row.estimateDays).toBe(7)
  })

  it('drops a nonsense estimate rather than offering it', () => {
    const row = buildReviewItem(scanItem({ estimatedShelfLifeDays: 0 }), TEMPLATES, NOW)
    expect(row.estimateDays).toBe(null)
  })
})

describe('buildReviewList', () => {
  it('dedupes the same food across photos, keeping the first crop', () => {
    const list = buildReviewList([
      { items: [scanItem({ name: 'Milk' })] },
      { items: [scanItem({ name: 'milk', box: { x: 0.9, y: 0.9, width: 0.05, height: 0.05 } })] }
    ], TEMPLATES, NOW)
    expect(list).toHaveLength(1)
    expect(list[0].photoIndex).toBe(0)
    expect(list[0].box.x).toBe(0.1)
  })

  it('a later sighting fills in what the first lacked', () => {
    const list = buildReviewList([
      { items: [scanItem({ name: 'Milk', printedDate: '' })] },
      { items: [scanItem({ name: 'Milk', printedDate: '2026-09-02' })] }
    ], TEMPLATES, NOW)
    expect(list[0].printedDays).toBe(8)
  })

  it('skips nameless items', () => {
    const list = buildReviewList([{ items: [scanItem({ name: '  ' })] }], TEMPLATES, NOW)
    expect(list).toHaveLength(0)
  })
})

describe('reviewReady', () => {
  it('is not ready while an included row has no duration', () => {
    const items = [
      { included: true, days: 5 },
      { included: true, days: null }
    ]
    expect(reviewReady(items)).toBe(false)
  })

  it('an excluded row does not block', () => {
    expect(reviewReady([
      { included: true, days: 5 },
      { included: false, days: null }
    ])).toBe(true)
  })

  it('needs at least one included row', () => {
    expect(reviewReady([{ included: false, days: 5 }])).toBe(false)
    expect(reviewReady([])).toBe(false)
  })
})

describe('scanStartDate', () => {
  const receipt = (purchaseDate) => ({ photoKind: 'receipt', purchaseDate, items: [] })

  it('a receipt starts the clock at the shop, not at the photo', () => {
    expect(scanStartDate(receipt('2026-08-22'), NOW).toISOString().slice(0, 10)).toBe('2026-08-22')
  })

  it('a photo of food itself starts now', () => {
    expect(scanStartDate({ photoKind: 'groceries', items: [] }, NOW)).toBe(NOW)
    expect(scanStartDate(receipt(''), NOW)).toBe(NOW)
    expect(scanStartDate(null, NOW)).toBe(NOW)
  })

  // A misread date would silently shift every timer in the batch, so an
  // impossible one is ignored rather than trusted.
  it('ignores a future date and an improbably old one', () => {
    expect(scanStartDate(receipt('2026-09-10'), NOW)).toBe(NOW)
    expect(scanStartDate(receipt('2020-01-01'), NOW)).toBe(NOW)
    expect(scanStartDate(receipt('nonsense'), NOW)).toBe(NOW)
  })

  it('accepts a receipt right at the age limit', () => {
    const edge = new Date(NOW.getTime() - MAX_RECEIPT_AGE_DAYS * 24 * 60 * 60 * 1000)
    const iso = edge.toISOString().slice(0, 10)
    expect(scanStartDate(receipt(iso), NOW).toISOString().slice(0, 10)).toBe(iso)
  })
})

describe('daysSince', () => {
  it('counts whole days, never negative', () => {
    expect(daysSince(new Date('2026-08-22T12:00:00'), NOW)).toBe(3)
    expect(daysSince(NOW, NOW)).toBe(0)
    expect(daysSince(new Date('2026-09-01T12:00:00'), NOW)).toBe(0)
  })
})

describe('receipt rows', () => {
  const receiptScan = (purchaseDate, items) => ({ photoKind: 'receipt', purchaseDate, items })

  // Found in real testing: "SRDGH BREAD LOAF" matched the "Sandwich bread"
  // template, which would silently give a sourdough loaf that template's very
  // long shelf life. The substitution has to be visible.
  it('flags when a template renamed what was read', () => {
    const list = buildReviewList([
      receiptScan('', [scanItem({
        name: 'Sourdough Bread',
        knownFoodMatch: 'Sandwich bread',
        printedText: 'SRDGH BREAD LOAF'
      })])
    ], [...TEMPLATES, { title: 'Sandwich bread', days: 76 }], NOW)
    expect(list[0].name).toBe('Sandwich bread')
    expect(list[0].readAs).toBe('Sourdough Bread')
  })

  it('stays quiet when the template name is what was read anyway', () => {
    const list = buildReviewList([
      receiptScan('', [scanItem({ name: 'strawberries', knownFoodMatch: 'Strawberries' })])
    ], TEMPLATES, NOW)
    expect(list[0].readAs).toBe('')
  })

  it('carries the printed line so a bad expansion is catchable', () => {
    const list = buildReviewList([
      receiptScan('', [scanItem({ name: 'Milk', printedText: 'GV MLK 2% GAL' })])
    ], TEMPLATES, NOW)
    expect(list[0].printedText).toBe('GV MLK 2% GAL')
  })

  it('backdates the clock and reports how much is already gone', () => {
    const list = buildReviewList([
      receiptScan('2026-08-22', [scanItem({ name: 'Strawberries' })])
    ], TEMPLATES, NOW)
    expect(list[0].daysElapsed).toBe(3)
    expect(list[0].days).toBe(10) // the template's shelf life, unshortened
  })

  // The whole point of backdating: a 10-day food bought 3 days ago expires in
  // 7, not 10.
  it('expiry counts from the shop, not from the scan', () => {
    const list = buildReviewList([
      receiptScan('2026-08-22', [scanItem({ name: 'Strawberries' })])
    ], TEMPLATES, NOW)
    const { timers } = confirmPayload(list, NOW)
    expect(timers[0].expiryDate.slice(0, 10)).toBe('2026-09-01') // Aug 22 + 10
  })

  // Otherwise photographing an old receipt would permanently teach the app
  // that strawberries last a week less than they do.
  it('teaches the template the full shelf life, not the shortened remainder', () => {
    const list = buildReviewList([
      receiptScan('2026-08-22', [scanItem({ name: 'Strawberries' })])
    ], TEMPLATES, NOW)
    const { templates } = confirmPayload(list, NOW)
    expect(templates[0]).toEqual({ title: 'Strawberries', days: 10 })
  })

  it('a receipt and a counter photo in one batch keep their own start dates', () => {
    const list = buildReviewList([
      receiptScan('2026-08-22', [scanItem({ name: 'Strawberries' })]),
      { photoKind: 'groceries', items: [scanItem({ name: 'Cucumber' })] }
    ], TEMPLATES, NOW)
    expect(list.find((r) => r.name === 'Strawberries').daysElapsed).toBe(3)
    expect(list.find((r) => r.name === 'Cucumber').daysElapsed).toBe(0)
  })
})

describe('confirmPayload', () => {
  it('one timer and one template per included row, excluded rows silent', () => {
    const { timers, templates } = confirmPayload([
      { included: true, days: 5, name: 'Milk' },
      { included: false, days: 7, name: 'Wrong Thing' }
    ], NOW)
    expect(timers).toHaveLength(1)
    expect(timers[0].title).toBe('Milk')
    expect(new Date(timers[0].expiryDate).getDate()).toBe(30)
    expect(templates).toEqual([{ title: 'Milk', days: 5 }])
  })
})

describe('buildReconcile', () => {
  const hoursFromNow = (h) => new Date(NOW.getTime() + h * 60 * 60 * 1000).toISOString()

  const storage = (names) => ({
    photoKind: 'storage',
    items: names.map((name) => scanItem({ name, estimatedShelfLifeDays: 7 }))
  })

  const timer = (id, title, overrides = {}) => ({
    id,
    title,
    createdAt: '2026-08-20T12:00:00.000Z',
    expiryDate: hoursFromNow(24 * 5),
    ...overrides
  })

  const TRACKED = [
    timer('t1', 'Cheddar Cheese'),
    timer('t2', 'Mozzarella'),
    timer('t3', 'Veggie Dogs')
  ]

  it('sorts the fridge into still-here, new, and maybe-gone', () => {
    const result = buildReconcile(
      [storage(['Cheddar Cheese', 'Mozzarella', 'Yogurt'])],
      TRACKED, TEMPLATES, NOW
    )
    expect(result.stillHere.map((t) => t.title)).toEqual(['Cheddar Cheese', 'Mozzarella'])
    expect(result.newItems.map((r) => r.name)).toEqual(['Yogurt'])
    expect(result.maybeGone.map((r) => r.title)).toEqual(['Veggie Dogs'])
  })

  // The pile that proves the photo was read. It has to be listable — a bare
  // count reads as "trust me", which was the complaint.
  it('gives the still-here pile enough to be listed, not just counted', () => {
    const result = buildReconcile(
      [storage(['Cheddar Cheese'])], TRACKED, TEMPLATES, NOW
    )
    expect(result.stillHere[0]).toMatchObject({ id: 't1', title: 'Cheddar Cheese' })
    expect(result.stillHere[0].timeLeft.days).toBe(5)
    expect(result.stillHere[0].timeLeft.expired).toBe(false)
  })

  it('says so when a food it saw is already past its date', () => {
    const result = buildReconcile(
      [storage(['Cheddar Cheese'])],
      [timer('t1', 'Cheddar Cheese', { expiryDate: hoursFromNow(-48) })],
      TEMPLATES, NOW
    )
    expect(result.stillHere[0].timeLeft.expired).toBe(true)
  })

  // THE SAFETY RULE. A third of a fridge is behind other food, and this photo
  // may not even cover the shelf a thing is on. Absence is a suggestion.
  it('never marks anything for removal by itself', () => {
    const result = buildReconcile([storage([])], TRACKED, TEMPLATES, NOW)
    expect(result.maybeGone).toHaveLength(3)
    expect(result.maybeGone.every((row) => row.remove === false)).toBe(true)
  })

  it('carries the context needed to judge a removal', () => {
    const result = buildReconcile([storage([])], [timer('t1', 'Cheddar Cheese')], TEMPLATES, NOW)
    expect(result.maybeGone[0].addedDaysAgo).toBe(5) // added Aug 20, now Aug 25
    expect(result.maybeGone[0].timeLeft.days).toBe(5) // fixture expires in exactly 5
    expect(result.maybeGone[0].id).toBe('t1')
  })

  it('matches on the same loose spelling the rest of the app uses', () => {
    const result = buildReconcile(
      [storage(['cheddar cheeses'])], [timer('t1', 'Cheddar Cheese')], TEMPLATES, NOW
    )
    expect(result.stillHere).toHaveLength(1)
    expect(result.maybeGone).toHaveLength(0)
  })

  it('a new food found in the fridge still stops for a duration', () => {
    const result = buildReconcile([storage(['Yogurt'])], [], TEMPLATES, NOW)
    expect(result.newItems[0].days).toBe(null)
    expect(reconcileReady(result.newItems)).toBe(false)
  })

  it('a fridge that matches exactly is confirmable with nothing to do', () => {
    const result = buildReconcile(
      [storage(['Cheddar Cheese'])], [timer('t1', 'Cheddar Cheese')], TEMPLATES, NOW
    )
    expect(result.newItems).toHaveLength(0)
    expect(reconcileReady(result.newItems)).toBe(true)
  })

  it('handles an empty fridge and an empty tracker', () => {
    const empty = buildReconcile([storage([])], [], TEMPLATES, NOW)
    expect(empty.stillHere).toEqual([])
    expect(empty.newItems).toEqual([])
    expect(empty.maybeGone).toEqual([])
  })
})

describe('isStorageScan', () => {
  it('only a fridge or cupboard shot routes to reconcile', () => {
    expect(isStorageScan({ photoKind: 'storage' })).toBe(true)
    expect(isStorageScan({ photoKind: 'groceries' })).toBe(false)
    expect(isStorageScan({ photoKind: 'receipt' })).toBe(false)
    expect(isStorageScan(null)).toBe(false)
  })
})
