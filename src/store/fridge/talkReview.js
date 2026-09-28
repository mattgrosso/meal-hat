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
// Shared with the receipt flow — both ways food enters the house have to
// answer "does this go off?" identically. See perishable.js.
import { isPerishable, DEFAULT_PANTRY_DAYS } from './perishable'
import { guessDays } from './shelfLife'

export { isPerishable, PANTRY_THRESHOLD_DAYS, DEFAULT_PANTRY_DAYS } from './perishable'

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

  // NOBODY IS ASKED HOW LONG ANYTHING LASTS. Matt, 2026-09-20: "Just make your
  // best guess." The household's own history and the model's general knowledge
  // are blended in shelfLife.js — neither is treated as fact — and the result
  // is simply applied.
  const days = perishable
    ? guessDays({ estimate, template })
    : (estimate || DEFAULT_PANTRY_DAYS)

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
    // What the household has to learn from this row. A spoken description
    // carries real information about THIS item — "the lettuce is starting to
    // go" is an observation — so it is worth folding in. A row that merely
    // accepted the standing guess is an echo and is not.
    learn: Boolean(estimate) && perishable,
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
  const spokenByKey = new Map(spoken.map((row) => [normalizeFoodName(row.name), row]))
  const tracked = (timers || []).filter((timer) => timer && timer.title)
  const trackedKeys = new Set(tracked.map((timer) => normalizeFoodName(timer.title)))
  const timersPerKey = new Map()
  tracked.forEach((timer) => {
    const key = normalizeFoodName(timer.title)
    timersPerKey.set(key, (timersPerKey.get(key) || 0) + 1)
  })

  return {
    // Already tracked and he said it is there. Nothing to do — and crucially
    // the timer is NOT restarted. Its expiry knows when the food arrived;
    // seeing it again says nothing about how fresh it is, and a dump every
    // week would otherwise keep a dying carton of milk alive forever.
    confirmed: tracked
      .filter((timer) => spokenKeys.has(normalizeFoodName(timer.title)))
      .filter((timer) => !outOf.has(normalizeFoodName(timer.title)))
      .map((timer) => {
        // The COUNT is new information even though the date is not. Matt,
        // 2026-09-28: "I told her we had two packages of mozzarella" — the
        // timer went on holding one, so a pizza's 3 cups against one 2-cup bag
        // kept mozzarella on the shopping list. Only a count he actually said
        // is used (no number means "there's some", which says nothing about
        // how much), and only when this food has a single timer: the count is
        // for the food, and split across several cards there is no honest way
        // to say which one changed.
        const key = normalizeFoodName(timer.title)
        const said = spokenByKey.get(key)?.quantity
        const had = Number(timer.quantity) > 0 ? Number(timer.quantity) : 1
        const recount = Number.isFinite(said) && said > 0 && timersPerKey.get(key) === 1
          ? Math.max(1, Math.round(said))
          : null
        // PAST ITS DATE BUT SAID TO BE HERE (2026-09-28). The expiry still
        // stands — see above, and the wall keeps showing it as past date so
        // somebody looks at it — but he has just said the food is in the
        // house, and the shopping list must hear that. Six foods in one
        // read-through (cheddar, hot dog buns, hamburger buns, cottage cheese,
        // tortellini, cucumbers) were mentioned, matched to a timer that had
        // already run out, and went straight back onto the list anyway.
        const timeLeft = computeTimeLeft(timer.expiryDate, now)
        return {
          id: timer.id,
          title: timer.title,
          timeLeft,
          ...(timeLeft.expired ? { pastDate: true } : {}),
          ...(recount !== null && recount !== had ? { had, quantity: recount } : {})
        }
      }),

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

    // How many of each food he described, by normalized name — the reading
    // `store/usage.js` learns a rate from. Said-out-of and went-unmentioned
    // are both ZERO, by the same rule that removes their timers: "if I don't
    // list it, then it isn't there". Only catalog foods are ever logged.
    counts: Object.fromEntries([
      ...spoken.map((row) => [normalizeFoodName(row.name), row.quantity ?? 1]),
      ...tracked.map((timer) => normalizeFoodName(timer.title))
        .filter((key) => !spokenKeys.has(key))
        .map((key) => [key, 0]),
      ...[...outOf].map((key) => [key, 0])
    ]),

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

  // ONE TIMER PER FOOD, carrying how many. This was written the other way
  // first — a timer per package, on the theory that the record had always
  // meant one physical thing — and Matt's first real read-through showed why
  // that is wrong: "I'm looking at the screen on the wall and I'm seeing lots
  // of duplicates. I see four entries for hot dogs... five for hot dog buns."
  // 41 extra cards on a wall whose whole job is to be glanced at.
  //
  // The data model already wanted this: `consume.js` decrements `timer
  // .quantity` and `packagesOnHand` sums it, so a single timer holding six is
  // understood everywhere. Six identical cards were never buying anything.
  const timers = included.map((item) => {
    const expiry = new Date((item.startsAt || now).getTime())
    expiry.setDate(expiry.getDate() + item.days)
    const count = Math.max(1, Math.round(item.quantity ?? 1))
    return {
      title: item.name,
      expiryDate: expiry.toISOString(),
      // Left off entirely at one, because that is what a bare timer has always
      // meant and writing `quantity: 1` on every record would say nothing.
      ...(count > 1 ? { quantity: count } : {}),
      // Off the wall, on the shopping list. The flag rather than a date
      // threshold, so the decision is made once, here, and every reader
      // agrees about it afterwards.
      ...(item.shelfStable ? { shelfStable: true } : {})
    }
  })

  return {
    timers,
    // The templates learn only from food that actually goes off, and only from
    // rows carrying a real signal. An observation is EVIDENCE — the store
    // folds it into a running mean rather than overwriting anything. Teaching
    // the app that a can of beans lasts 730 days would put beans on the wall
    // the next time somebody typed one in by hand.
    templates: included
      .filter((item) => !item.shelfStable && item.learn)
      .map((item) => ({ title: item.name, observed: item.days, anchor: item.estimateDays })),
    // Foods he said are here in a different number than the fridge held. The
    // expiry is untouched — see `confirmed` — only how many there are.
    recount: (review?.confirmed || [])
      .filter((row) => row.quantity)
      .map((row) => ({ id: row.id, title: row.title, had: row.had, quantity: row.quantity })),
    // Timers past their date that he has just said are here. Stamped with
    // when, and `fridge/inHouse.js` counts a timer seen after it expired as
    // in the house. Nothing else about the timer changes.
    seen: (review?.confirmed || [])
      .filter((row) => row.pastDate)
      .map((row) => ({ id: row.id, title: row.title })),
    remove: (review?.notHeard || []).filter((row) => row.remove).map((row) => row.id)
  }
}
