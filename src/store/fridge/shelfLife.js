// How long a food lasts: a belief that gets nudged, not a fact that gets set.
//
// MATT, 2026-09-20, and this module exists entirely because of it:
//
//   "Don't confirm with me how long something should be in the pantry or
//    whatever the timers. Just make your best guess. If I modify a timer on
//    perishable, that should inform future guesses mostly. It shouldn't be
//    seen as a fact of how long something can last."
//
// Two separate instructions, and both are load-bearing.
//
// FIRST: never ask. A new food used to stop and wait for a duration. That was
// right when a printed use-by date and a model's guess were both on offer and
// choosing silently would have hidden the difference between them. It is wrong
// as a standing rule — it turns describing a kitchen into forty small
// decisions, and a guess he can correct later beats a question he has to
// answer now. Every path through this module returns a number.
//
// SECOND, and subtler: a correction is EVIDENCE, not TRUTH. The old template
// was last-write-wins — every edit overwrote the shelf life outright, forever,
// and `templateDaysAfterEdit` fed it the timer's whole new lifespan. So
// extending a nearly-dead loaf by a few days re-taught the app that sandwich
// bread lasts that long from new, and the next extension compounded it. Four
// foods measurably ran away with this: sandwich bread to 76 days, hamburger
// buns to 76, cheddar to 74, spinach to 51.
//
// The fix is not a bigger warning. It is to stop treating one edit as the
// answer:
//
//   - a template holds a running MEAN and a COUNT, not a last value
//   - every template carries an ANCHOR — what this food is generally known to
//     keep for — and the mean may never stray more than a factor of two from
//     it, in either direction
//   - a guess blends the household's mean with the model's estimate, weighted
//     by how many times the house has actually been observed
//
// THE ANCHOR IS THE PART THAT ACTUALLY WORKS, and the first attempt at this
// module got it wrong in an instructive way. Clamping each observation against
// the CURRENT MEAN only slows a runaway down: the mean rises, so the next
// clamp is looser, and twelve extensions still took a 7-day bread to 57. A
// bound has to be fixed to something that does not move. The anchor is the
// model's estimate for the food when the template was born, or failing that
// the first observation, and nothing ever updates it.
//
// All pure. No store, no clock, no Firebase.

// Past this, more observations stop adding confidence. A food seen fifty times
// is not twenty-five times surer than one seen eight times, and without a cap
// an old template becomes unmovable — which is the failure mode we started in,
// arrived at from the other direction.
export const MAX_CONFIDENCE_COUNT = 8

// How far ABOVE the model's estimate the household may go. Note the asymmetry,
// which is the important part of this module and was got wrong first time:
//
// The first version blended household and model and clamped in BOTH
// directions. That produced answers worse than either input — a household that
// had carefully taught the app frozen spinach keeps 240 days, against a model
// guessing 900, came out at 680, which is nobody's number and nobody's food.
//
// The two directions are not symmetric and should never have been treated as
// though they were. A belief that is too LONG lets food rot behind a timer
// saying it is fine — the failure this app exists to prevent. A belief that is
// too SHORT costs a glance at something still good, and a spoilage tracker
// errs early on purpose; every other rule here already does.
//
// So: the household may say a food lasts as little as it likes, and no more
// than twice what the food is generally known to keep.
export const MAX_DRIFT_FACTOR = 2

// The furthest ONE observation may move the running mean in a single step.
// Extending a timer says "this lasted longer than I thought", which is real
// evidence worth having — but it is evidence about one loaf, not a new
// definition of bread. This damps; the anchor is what bounds.
export const MAX_STEP_FACTOR = 2

const asDays = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

const clamp = (value, low, high) => Math.min(Math.max(value, low), high)

/** Whole days, never zero — a timer of no length is not a timer. */
export const roundDays = (value) => Math.max(1, Math.round(value))

/**
 * What the household currently believes about a food, as a number and a
 * strength.
 *
 * Templates written before this module have a bare `days` and no `count`.
 * They are read as a single observation, which is honest: one number, written
 * once, with nothing to say how many times it was confirmed.
 */
export const beliefFrom = (template) => {
  // `mean` is the precise running average; `days` is its whole-day face, kept
  // because the catalog sync and every display read that field.
  //
  // KEEPING BOTH IS NOT BELT-AND-BRACES, it is the difference between a belief
  // that converges and one that stalls. Fold the ROUNDED value back in each
  // time and the sub-day progress is thrown away every round: a 2-day belief
  // fed twenty observations of 10 climbs to 8 and then sticks there forever,
  // because the increment (0.22 of a day) rounds to nothing. Measured, not
  // theorised — it is what this module did before `mean` existed.
  const precise = asDays(template?.mean)
  const days = precise ?? asDays(template?.days)
  if (days === null) return null
  const count = Number.isInteger(template?.count) && template.count > 0 ? template.count : 1
  // A template written before anchors existed is anchored to what it already
  // says. That is the honest reading — it is the only general statement about
  // the food we have — and it means an old template stops moving rather than
  // continuing a drift it was already partway through.
  const anchor = asDays(template?.anchor) ?? days
  return { days, count, anchor }
}

/**
 * Fold one observation into what the household believes.
 *
 * The clamp comes first and it is the whole anti-drift mechanism: an
 * observation more than MAX_STEP_FACTOR away from the current belief is pulled
 * back to that boundary before it is averaged in. A wild edit still moves the
 * number — it just moves it by a step instead of replacing it.
 */
export const foldObservation = (template, observedDays, { anchor } = {}) => {
  const observed = asDays(observedDays)
  const belief = beliefFrom(template)

  if (observed === null) return belief

  if (!belief) {
    // A brand new food. The anchor is the model's estimate when we have one,
    // because that is a statement about the FOOD; the observation is a
    // statement about one item of it.
    return {
      days: roundDays(observed),
      mean: observed,
      count: 1,
      anchor: roundDays(asDays(anchor) ?? observed)
    }
  }

  const stepped = clamp(observed, belief.days / MAX_STEP_FACTOR, belief.days * MAX_STEP_FACTOR)
  const weight = Math.min(belief.count, MAX_CONFIDENCE_COUNT)
  const averaged = ((belief.days * weight) + stepped) / (weight + 1)

  // The anchor bounds absolutely, and upward only — same asymmetry as the
  // guess. However many times the house insists a loaf lasted three months,
  // the belief cannot climb out of the neighbourhood of what bread is; but it
  // may go as short as the house keeps finding, because erring early is what
  // a spoilage tracker is for.
  const mean = clamp(averaged, 1, belief.anchor * MAX_DRIFT_FACTOR)

  return {
    days: roundDays(mean),
    mean,
    // The count keeps climbing past the confidence cap. It is a record of how
    // often this food has been seen, and only its effect on the blend is
    // capped — resetting it would quietly forget the food's history.
    count: belief.count + 1,
    anchor: belief.anchor
  }
}

/**
 * The guess: how long this food should last, starting now.
 *
 * THE HOUSEHOLD WINS WHEN IT HAS ANYTHING TO SAY. Matt: "If I modify a timer
 * on perishable, that should inform future guesses mostly." What this house
 * has actually observed about its own food, kept in its own fridge, beats
 * general knowledge about the food — so the model's estimate is not a rival
 * number to average against, it is the answer when the house has none, and
 * the ceiling when the house has one.
 *
 *   - nothing at all   -> null, and the caller decides (only a hand-typed add
 *                         with no scan behind it ever gets here)
 *   - no belief        -> the model's estimate
 *   - a belief         -> the belief, capped at MAX_DRIFT_FACTOR x the model
 *
 * The cap is what makes the old drift unreachable. A household that has taught
 * this app 76-day bread, against a model saying a loaf keeps about a week,
 * gets a fortnight — a real answer for bread in a fridge, and not a number
 * anybody typed on purpose.
 */
export const guessDays = ({ estimate, template } = {}) => {
  const belief = beliefFrom(template)
  const modelDays = asDays(estimate)

  if (!belief && modelDays === null) return null
  if (!belief) return roundDays(modelDays)
  if (modelDays === null) return roundDays(belief.days)

  // Only ever capped upward. Going short is safe; going long is the failure.
  return roundDays(Math.min(belief.days, modelDays * MAX_DRIFT_FACTOR))
}

/**
 * Does this row have anything worth teaching the household?
 *
 * A row that simply accepted the standing guess teaches nothing — folding it
 * back in would inflate the count without adding information, and a belief
 * that grows more confident by agreeing with itself is not evidence, it is an
 * echo. Only a real signal counts: a printed date, or a number a person
 * actually changed.
 */
export const isWorthLearning = (row) => Boolean(row?.learn)
