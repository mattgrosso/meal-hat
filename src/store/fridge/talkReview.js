// Turning a spoken walk around the kitchen into what the fridge should hold.
//
// WHY THIS EXISTS INSTEAD OF THE CAMERA (Matt, 2026-09-20): "what we built for
// that previously was a thing where I take a photo and then you interpret the
// photo, and I don't really trust that." So the input is now a few minutes of
// him opening doors and saying what he sees. A person naming food beats a
// model squinting at a photo of it, and it removes the failure the photo flow
// could never fix: occlusion. You can see behind the milk. A camera cannot.
//
// THE RULE THAT INVERTS HERE, and it is his explicit call:
//
//   "We should assume that if I don't list it, then it isn't there."
//
// Every other read of this data treats absence as a suggestion — a photo that
// missed the mustard is not evidence the mustard is gone, so those rows arrive
// UNCHECKED. A spoken inventory is different in kind: it is a deliberate
// enumeration, made by the one person who can open the drawer. So unmentioned
// timers arrive CHECKED for removal. The review screen still shows every one
// of them and the whole thing is one confirm — the plan shown is the plan
// applied — but the default has flipped, on purpose, and only here.
//
// All pure. Fixes in, decisions out, no store and no clock beyond what is
// passed in.

import { computeTimeLeft } from './timers'
import { normalizeFoodName, findTemplate, daysSince } from './scanReview'

// Beyond this, a food is not a spoilage problem, it is furniture. Matt's call:
// "we don't need to list that I have a can of beans that's gonna last for
// years — it should just list the things that actually are going to go bad at
// some point in a reasonable time frame."
//
// A YEAR, not the six months that first suggested itself, because his own wall
// already carries frozen spinach, frozen mixed vegetables and mustard at four
// to eight months and he wants them there. The line is between "will go off
// while I still own it" and "will outlive my interest in it".
export const PANTRY_THRESHOLD_DAYS = 365

// A fallback for a shelf-stable mention the model gave no number for. Long
// enough to stay out of the way, finite so nothing lives in the fridge record
// forever unexamined.
export const DEFAULT_PANTRY_DAYS = 730

/**
 * Is this food worth a countdown, or is it pantry furniture?
 *
 * The household's own templates win outright. A template exists because
 * somebody taught this app that this food goes off and how fast — that is a
 * stronger signal than any general knowledge about the food, and it is how
 * "Frozen Spinach" stays on the wall while a can of beans never arrives there.
 */
export const isPerishable = (item, template) => {
  if (template) return true
  if (item?.perishable === false) return false
  const days = Number(item?.estimatedShelfLifeDays)
  if (Number.isFinite(days) && days > 0) return days <= PANTRY_THRESHOLD_DAYS
  // Nothing said either way: treat it as perishable. A countdown on a tin is
  // a row on a screen; no countdown on a chicken is a bad dinner.
  return true
}

/**
 * One thing he said -> one row to review.
 *
 * `heard` is the phrase as spoken and it rides all the way to the screen. It
 * is the only way a misparse is catchable: "half a block of pepper jack"
 * arriving as "Pepper" is invisible unless the row can be read back against
 * what was actually said. Same job the receipt flow's `printedText` does.
 */
export const buildTalkItem = (item, templates, now) => {
  const template =
    findTemplate(item?.knownFoodMatch, templates) ||
    findTemplate(item?.name, templates)

  const name = template ? template.title : String(item?.name || '').trim()
  const spoken = String(item?.heard || '').trim()
  const perishable = isPerishable(item, template)

  const estimate = Number.isInteger(item?.estimatedShelfLifeDays) && item.estimatedShelfLifeDays > 0
    ? item.estimatedShelfLifeDays
    : null

  // A NEW food arrives with a number rather than blocking, which is a
  // deliberate departure from the scan flow's "every new food stops for your
  // input". That rule was written where a PRINTED date and a guess were both
  // on offer and picking for him would have hidden the difference. Here there
  // is only ever an estimate, and forty of them in one sitting is not a review,
  // it is data entry. The number is shown, labelled as an estimate, and
  // editable on the row — so nothing unreviewed becomes a timer, which is what
  // the original rule was actually protecting.
  const days = template
    ? template.days
    : (perishable ? estimate : (estimate || DEFAULT_PANTRY_DAYS))

  return {
    name,
    heard: spoken,
    // A template renaming what was said has to be visible, or a sourdough loaf
    // silently inherits sandwich bread's shelf life. The scan flow learned
    // this one the hard way ("SRDGH BREAD LOAF").
    readAs: template && normalizeFoodName(String(item?.name || '')) !== normalizeFoodName(name)
      ? String(item?.name || '').trim()
      : '',
    included: true,
    days,
    fromTemplate: Boolean(template),
    estimateDays: estimate,
    // Pantry rows are tracked so the shopping list can stop asking for food
    // that is demonstrably in the house — but they are kept off the wall,
    // which exists to show what is about to go off.
    shelfStable: !perishable,
    // How many packages he said there were. Absent means one, which is what a
    // timer has always meant.
    quantity: Number.isFinite(Number(item?.quantity)) && Number(item?.quantity) > 0
      ? Number(item.quantity)
      : null,
    startsAt: now
  }
}

/**
 * The whole dump -> the four piles a person has to agree to.
 *
 * Order matters on the screen, not here: what it got RIGHT goes first. Being
 * shown that it heard twenty things correctly is what makes the removals
 * trustworthy — the reconcile screen learned that from Matt's own report
 * ("so I can feel like it did see things").
 */
export const buildTalkReview = (result, timers, templates, now) => {
  const spoken = []
  const seen = new Map()

  ;(result?.items || []).forEach((item) => {
    const row = buildTalkItem(item, templates, now)
    if (!row.name) return
    const key = normalizeFoodName(row.name)
    const existing = seen.get(key)
    if (existing) {
      // Said twice — "there's cheddar... oh and more cheddar in the door". Two
      // mentions of one food are two packages, not two rows.
      existing.quantity = (existing.quantity ?? 1) + (row.quantity ?? 1)
      if (row.heard && !existing.heard.includes(row.heard)) {
        existing.heard = `${existing.heard}; ${row.heard}`
      }
      return
    }
    seen.set(key, row)
    spoken.push(row)
  })

  // "We're out of milk" is not a food sighting, it is the opposite, and a
  // stream-of-consciousness dump is full of them. Read as a mention it would
  // create a milk timer — exactly backwards.
  const outOf = new Set(
    (result?.outOf || [])
      .map((item) => normalizeFoodName(
        (findTemplate(item?.knownFoodMatch, templates) || findTemplate(item?.name, templates))?.title ||
        item?.name
      ))
      .filter(Boolean)
  )

  const spokenKeys = new Set(spoken.map((row) => normalizeFoodName(row.name)))
  const tracked = (timers || []).filter((timer) => timer && timer.title)
  const trackedKeys = new Set(tracked.map((timer) => normalizeFoodName(timer.title)))

  return {
    // Already tracked and he said it is there. Nothing to do — and crucially
    // the timer is NOT restarted. Its expiry knows when the food arrived;
    // seeing it again says nothing about how fresh it is, and a dump every
    // week would otherwise keep a dying carton of milk alive forever.
    confirmed: tracked
      .filter((timer) => spokenKeys.has(normalizeFoodName(timer.title)))
      .filter((timer) => !outOf.has(normalizeFoodName(timer.title)))
      .map((timer) => ({
        id: timer.id,
        title: timer.title,
        timeLeft: computeTimeLeft(timer.expiryDate, now)
      })),

    // He said it, the fridge has never heard of it. These become timers.
    // "We're out of eggs" wins over a passing mention of eggs — a dump is
    // spoken, not drafted, and the same food can land in both lists.
    newItems: spoken.filter((row) => {
      const key = normalizeFoodName(row.name)
      return !trackedKeys.has(key) && !outOf.has(key)
    }),

    // Going away: everything tracked that he did not say is there, plus
    // anything he said outright that they are out of. CHECKED, per his call —
    // see the top of this file. The context rides along anyway: something added
    // this morning being unmentioned is worth a second look before it goes.
    notHeard: tracked
      .filter((timer) => {
        const key = normalizeFoodName(timer.title)
        return outOf.has(key) || !spokenKeys.has(key)
      })
      .map((timer) => ({
        id: timer.id,
        title: timer.title,
        remove: true,
        // An explicit "we're out of it" is a stronger statement than simply
        // not being mentioned, and the row should say which one this was.
        saidOutOf: outOf.has(normalizeFoodName(timer.title)),
        addedDaysAgo: timer.createdAt ? daysSince(new Date(timer.createdAt), now) : null,
        timeLeft: computeTimeLeft(timer.expiryDate, now)
      })),

    // Said, but not understood well enough to act on. Shown rather than
    // swallowed: the thing he actually said is the record, and a phrase that
    // fell on the floor is worth knowing about.
    unclear: (result?.unclear || []).map((row) => ({
      heard: String(row?.heard || '').trim(),
      why: String(row?.why || '').trim()
    })).filter((row) => row.heard)
  }
}

/** Every new row needs a duration before any of this can be written. */
export const talkReviewReady = (newItems) =>
  (newItems || []).every((item) => !item.included || (Number.isInteger(item.days) && item.days > 0))

/**
 * The review, agreed to -> exactly what gets written.
 *
 * Returned rather than performed, so what was shown on screen and what hits
 * the database are the same object. The same discipline `planMealConsumption`
 * follows for the same reason.
 */
export const talkPayload = (review, now) => {
  const included = (review?.newItems || []).filter(
    (item) => item.included && Number.isInteger(item.days) && item.days > 0
  )

  const timers = []
  included.forEach((item) => {
    const expiry = new Date((item.startsAt || now).getTime())
    expiry.setDate(expiry.getDate() + item.days)
    // Two of a thing are two timers, not one timer holding two — that is what
    // the record has always meant, and it is what lets half of it be eaten.
    const count = Math.max(1, Math.round(item.quantity ?? 1))
    for (let i = 0; i < count; i += 1) {
      timers.push({
        title: item.name,
        expiryDate: expiry.toISOString(),
        // Off the wall, on the shopping list. The flag rather than a date
        // threshold, so the decision is made once, here, and every reader
        // agrees about it afterwards.
        ...(item.shelfStable ? { shelfStable: true } : {})
      })
    }
  })

  return {
    timers,
    // The templates learn only from food that actually goes off. Teaching the
    // app that a can of beans lasts 730 days would put beans on the wall the
    // next time somebody typed one in by hand.
    templates: included
      .filter((item) => !item.shelfStable)
      .map((item) => ({ title: item.name, days: item.days })),
    remove: (review?.notHeard || []).filter((row) => row.remove).map((row) => row.id)
  }
}
