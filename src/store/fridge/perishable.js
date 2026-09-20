// Does this food go off, or is it pantry furniture?
//
// Matt, 2026-09-20: "We don't need to list that I have a can of beans that's
// gonna last for years — it should just list the things that actually are
// going to go bad at some point in a reasonable time frame."
//
// Both ways food gets into the house have to answer this the same way. The
// talk-through asks it of something he said; a receipt asks it of a printed
// line. If they disagreed, a bag of rice would be pantry when spoken and
// perishable when bought, and the wall would fill up with whichever one was
// wrong. Hence one module, imported by both.

// Beyond this, a food is not a spoilage problem, it is furniture.
//
// A YEAR, not the six months that first suggested itself, because Matt's own
// wall already carries frozen spinach, frozen mixed vegetables and mustard at
// four to eight months and he wants them there. The line is between "will go
// off while I still own it" and "will outlive my interest in it".
export const PANTRY_THRESHOLD_DAYS = 365

// A fallback for a shelf-stable item nothing gave a number for. Long enough to
// stay out of the way, finite so nothing lives in the record forever
// unexamined.
export const DEFAULT_PANTRY_DAYS = 730

/**
 * @param item      the model's row: `{ perishable?, estimatedShelfLifeDays? }`
 * @param template  the household's own template for this food, if it has one
 *
 * The household's templates win outright. A template exists because somebody
 * taught this app that this food goes off and how fast — a stronger signal
 * than any general knowledge about the food, and it is how "Frozen Spinach"
 * stays on the wall while a can of beans never arrives there.
 */
export const isPerishable = (item, template) => {
  if (template) return true
  if (item?.perishable === false) return false
  const days = Number(item?.estimatedShelfLifeDays)
  if (Number.isFinite(days) && days > 0) return days <= PANTRY_THRESHOLD_DAYS
  // Nothing said either way: treat it as perishable. A countdown on a tin is a
  // row on a screen; no countdown on a chicken is a bad dinner.
  return true
}
