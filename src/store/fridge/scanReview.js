// Turning a scan result into the review list, and the review list into
// timers. All pure — the decisions Matt cares about live here, tested.

import { computeTimeLeft } from './timers'
//
// The duration rules (Matt's calls, 2026-08-25):
//   - A template match fills the duration in and the row is ready as-is —
//     the household's own history is trusted.
//   - A NEW food always stops for input. The printed date and the model's
//     shelf-life estimate are shown as tappable OPTIONS, never pre-applied:
//     "Never prefill from either source; every new food stops for your input."

const DAY_MS = 24 * 60 * 60 * 1000

// "Strawberries" ~ "strawberries" ~ "Strawberry". Case and a trailing s are
// spelling, not identity. Anything fuzzier than this risks merging different
// foods, which on a spoilage tracker means a wrong date on real food.
export const normalizeFoodName = (name) => {
  const lower = String(name || '').trim().toLowerCase()
  return lower.endsWith('s') ? lower.slice(0, -1) : lower
}

export const findTemplate = (name, templates) => {
  const wanted = normalizeFoodName(name)
  if (!wanted) return null
  return (templates || []).find((t) => normalizeFoodName(t.title) === wanted) || null
}

// A printed date -> CALENDAR days from today, floored at 1 so "expires
// today" still yields a live timer rather than one born dead. Calendar days,
// not elapsed time: a timer of N days lands at scan-time-of-day ON the
// printed date — within the last good day, never past it. A tracker of
// things that go off should err early. null when the date is unparseable or
// already past — a past date is information ("eat this now"), not a duration.
export const printedDateToDays = (printedDate, now) => {
  if (!printedDate) return null
  const date = new Date(`${printedDate}T12:00:00`)
  if (Number.isNaN(date.getTime())) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  const days = Math.round((date.getTime() - today.getTime()) / DAY_MS)
  if (days < 0) return null
  return Math.max(1, days)
}

// A receipt's own transaction date, when it has a believable one. Timers on a
// receipt count from when the shopping happened, not from when the photo was
// taken — photograph Saturday's receipt on Monday and the milk is already two
// days along. A date in the future, or improbably far back, is a misread and
// is ignored rather than silently shifting every timer.
export const MAX_RECEIPT_AGE_DAYS = 60

export const scanStartDate = (scan, now) => {
  if (!scan || scan.photoKind !== 'receipt' || !scan.purchaseDate) return now
  const parsed = new Date(`${scan.purchaseDate}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return now

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  const daysAgo = Math.round((today.getTime() - parsed.getTime()) / DAY_MS)
  if (daysAgo < 0 || daysAgo > MAX_RECEIPT_AGE_DAYS) return now
  return parsed
}

// Whole days between the shop and now, for the row to say so out loud.
export const daysSince = (startsAt, now) => {
  const start = new Date(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate(), 12)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  return Math.max(0, Math.round((today.getTime() - start.getTime()) / DAY_MS))
}

// One scanned item -> one review row. The model's knownFoodMatch is trusted
// first (it can see "cheddar" and "Cheddar Cheese" are one food); the local
// normalize match is the fallback for when it missed one.
export const buildReviewItem = (scanItem, templates, now, photoIndex = 0, startsAt = now) => {
  const template =
    findTemplate(scanItem.knownFoodMatch, templates) ||
    findTemplate(scanItem.name, templates)

  const name = template ? template.title : String(scanItem.name || '').trim()
  const printedDays = printedDateToDays(scanItem.printedDate, now)
  const estimateDays = Number.isInteger(scanItem.estimatedShelfLifeDays) && scanItem.estimatedShelfLifeDays > 0
    ? scanItem.estimatedShelfLifeDays
    : null

  const readAsRaw = String(scanItem.name || '').trim()

  return {
    name,
    // What the scan actually read, when a template renamed it. Real case from
    // testing: "SRDGH BREAD LOAF" matched the "Sandwich bread" template, which
    // would have handed a sourdough loaf that template's 76 days without a
    // word. A substitution has to be visible to be correctable.
    readAs: template && normalizeFoodName(readAsRaw) !== normalizeFoodName(name)
      ? readAsRaw
      : '',
    // The receipt line exactly as printed, so a misexpanded abbreviation is
    // catchable ("GV MLK 2% GAL" under "Milk"). Empty for food photos.
    printedText: scanItem.printedText || '',
    box: scanItem.box || null,
    photoIndex,
    included: true,
    // Template rows arrive ready; new foods arrive needing an answer.
    days: template ? template.days : null,
    fromTemplate: Boolean(template),
    // The options a new-food row offers. Shown, never pre-applied.
    printedDate: scanItem.printedDate || null,
    printedDays,
    estimateDays,
    // When the clock starts: the shop's date on a receipt, else now.
    startsAt,
    daysElapsed: daysSince(startsAt, now)
  }
}

// Many photos -> one deduplicated review list. The same food seen in two
// photos of the same haul is one item; the first sighting keeps its crop.
export const buildReviewList = (scans, templates, now) => {
  const seen = new Map()
  const list = []
  scans.forEach((scan, photoIndex) => {
    // Per-scan, not per-batch: a receipt and a counter photo can arrive in one
    // go and they do not share a start date.
    const startsAt = scanStartDate(scan, now)
    for (const item of scan.items || []) {
      const row = buildReviewItem(item, templates, now, photoIndex, startsAt)
      if (!row.name) continue
      const key = normalizeFoodName(row.name)
      const existing = seen.get(key)
      if (existing) {
        // A later sighting can still contribute what the first lacked.
        if (!existing.days && row.days) {
          existing.days = row.days
          existing.fromTemplate = row.fromTemplate
        }
        if (!existing.printedDays && row.printedDays) {
          existing.printedDate = row.printedDate
          existing.printedDays = row.printedDays
        }
        if (!existing.estimateDays && row.estimateDays) existing.estimateDays = row.estimateDays
        continue
      }
      seen.set(key, row)
      list.push(row)
    }
  })
  return list
}

// --- Reconcile: a fridge or cupboard photo against what's already tracked ---
//
// Three piles, and the important one is the third. A photo of a fridge does
// NOT prove a food is gone — a third of a fridge is behind other food, in a
// drawer, in an opaque tub, or simply on the shelf this photo didn't cover.
// So absence is a SUGGESTION, never an action: "maybe gone" rows arrive
// UNCHECKED and nothing is removed without a deliberate tap (Matt's call,
// 2026-08-25). The reverse mistake — leaving a timer up for food that's been
// eaten — costs a glance; deleting food that's still in the fridge costs the
// thing the app exists to do.

export const isStorageScan = (scan) => scan?.photoKind === 'storage'

export const buildReconcile = (scans, timers, templates, now) => {
  const seen = buildReviewList(scans, templates, now)
  const seenKeys = new Set(seen.map((row) => normalizeFoodName(row.name)))

  const tracked = timers || []
  const trackedKeys = new Set(tracked.map((timer) => normalizeFoodName(timer.title)))

  return {
    // Tracked and visible: nothing to do, but this is the pile that proves the
    // photo was actually understood, so it carries enough to be read as a list
    // rather than counted. Order is the caller's — soonest-expiring first.
    stillHere: tracked
      .filter((timer) => seenKeys.has(normalizeFoodName(timer.title)))
      .map((timer) => ({
        id: timer.id,
        title: timer.title,
        timeLeft: computeTimeLeft(timer.expiryDate, now)
      })),

    // Visible but untracked: the same add flow as a shopping haul, so a new
    // food still stops for a duration.
    newItems: seen.filter((row) => !trackedKeys.has(normalizeFoodName(row.name))),

    // Tracked but not visible. Unchecked, with the context needed to judge:
    // something added this morning is far more likely to be hidden than
    // eaten.
    maybeGone: tracked
      .filter((timer) => !seenKeys.has(normalizeFoodName(timer.title)))
      .map((timer) => ({
        id: timer.id,
        title: timer.title,
        remove: false,
        addedDaysAgo: timer.createdAt ? daysSince(new Date(timer.createdAt), now) : null,
        timeLeft: computeTimeLeft(timer.expiryDate, now)
      }))
  }
}

// Reconcile can be confirmed with nothing added — approving removals, or even
// approving nothing, is a legitimate outcome. Adds still need their durations.
export const reconcileReady = (newItems) =>
  (newItems || []).every((item) => !item.included || (Number.isInteger(item.days) && item.days > 0))

// The confirm button stays dead until every included row has a duration —
// a timer without a length is not a timer.
export const reviewReady = (items) =>
  (items || []).some((item) => item.included) &&
  items.every((item) => !item.included || (Number.isInteger(item.days) && item.days > 0))

// Review list -> what actually gets written: one timer per included row, and
// a template per included row so the app learns this food for next time —
// the same loop a hand-typed add already runs.
export const confirmPayload = (items, now) => {
  const included = (items || []).filter(
    (item) => item.included && Number.isInteger(item.days) && item.days > 0
  )
  return {
    timers: included.map((item) => {
      // `days` is the food's SHELF LIFE, counted from when it was bought —
      // which is the shop's date on a receipt, and now for everything else.
      const expiry = new Date((item.startsAt || now).getTime())
      expiry.setDate(expiry.getDate() + item.days)
      return { title: item.name, expiryDate: expiry.toISOString() }
    }),
    // The template learns the shelf life itself, never the shortened remainder
    // — otherwise photographing an old receipt would permanently teach the app
    // that milk lasts two days.
    templates: included.map((item) => ({ title: item.name, days: item.days }))
  }
}
