// The timer arithmetic, extracted pure from the components so it can be
// tested. Fixes in, numbers out — nothing here touches Firebase or the DOM.

const DAY_MS = 24 * 60 * 60 * 1000

// Firebase object -> array sorted soonest-expiring first.
export const sortTimers = (timersMap) =>
  Object.keys(timersMap || {})
    .map((key) => ({ id: key, ...timersMap[key] }))
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))

export const computeTimeLeft = (expiryDate, now) => {
  const diff = new Date(expiryDate).getTime() - now.getTime()
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true }
  }
  return {
    days: Math.floor(diff / DAY_MS),
    hours: Math.floor((diff % DAY_MS) / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((diff % (1000 * 60)) / 1000),
    expired: false
  }
}

// Card color: red inside a day, orange inside three, green beyond.
export const timerStatus = (timeLeft) => {
  if (timeLeft.expired) return 'expired'
  const totalHours = (timeLeft.days * 24) + timeLeft.hours
  if (totalHours <= 24) return 'warning'
  if (totalHours <= 72) return 'caution'
  return 'good'
}

// Extending a timer counts from its expiry — unless that expiry is already in
// the past, in which case it counts from now. "+1 day" on something that died
// last Tuesday means "good until tomorrow", not "less dead".
export const extendedExpiry = (currentExpiryIso, adjustmentDays, now) => {
  const currentExpiry = new Date(currentExpiryIso)
  const base = currentExpiry > now ? currentExpiry : now
  return new Date(base.getTime() + adjustmentDays * DAY_MS).toISOString()
}

// A timer's whole lifespan in days, floored at one. Rounded UP, because a
// timer set for "today at 6pm" is a one-day timer, not a zero-day one.
export const spanInDays = (fromIso, toIso) => {
  const span = new Date(toIso).getTime() - new Date(fromIso).getTime()
  if (Number.isNaN(span)) return null
  return Math.max(1, Math.ceil(span / DAY_MS))
}

// After an edit, the template relearns its duration from the timer's actual
// new lifespan (created -> new expiry), floored at one day.
export const templateDaysAfterEdit = (newExpiryIso, createdAtIso) =>
  spanInDays(createdAtIso, newExpiryIso)

// "9 days" -> "1 week 2 days"; under a week stays in days. Fractional input
// (days + hours/24) is floored, matching the cards' whole-day display.
export const formatDaySpan = (totalDays) => {
  const whole = Math.floor(totalDays)
  if (whole >= 7) {
    const weeks = Math.floor(whole / 7)
    const remainingDays = whole % 7
    const weeksPart = `${weeks} week${weeks > 1 ? 's' : ''}`
    return remainingDays > 0
      ? `${weeksPart} ${remainingDays} day${remainingDays > 1 ? 's' : ''}`
      : weeksPart
  }
  return `${whole} day${whole > 1 ? 's' : ''}`
}

// A card's count for display: '' for one (a bare card), ×3 for whole packs,
// and quarters for part of one — three loose buns of an eight-pack is ×½,
// not ×0.38. Counts are in packages (talkReview.js `inPackages`).
const QUARTERS = ['', '¼', '½', '¾']
export const formatCount = (quantity) => {
  const n = Number(quantity)
  if (!Number.isFinite(n) || n <= 0 || n === 1) return ''
  const quarters = Math.max(1, Math.round(n * 4))
  const whole = Math.floor(quarters / 4)
  if (whole === 1 && quarters % 4 === 0) return ''
  return `×${whole || ''}${QUARTERS[quarters % 4]}`
}

// What the WALL shows (2026-10-11). Matt: the timers "just sit there expired"
// and the wall had "sort of gotten out of hand" — 53 cards, 17 past date,
// frozen patties and mustard months out. The wall is an EAT-SOON board now:
// perishables going off within WALL_HORIZON_DAYS, soonest first, at most
// WALL_MAX_CARDS. Everything is still tracked (the phone and the shopping
// list read all of it); it is just not on the wall until it matters.
export const WALL_HORIZON_DAYS = 5
export const WALL_MAX_CARDS = 8

export const wallTimers = (timers = [], now = new Date()) => {
  const horizon = now.getTime() + WALL_HORIZON_DAYS * 24 * 60 * 60 * 1000
  return (timers || [])
    .filter((timer) => timer && !timer.shelfStable)
    .filter((timer) => {
      const at = new Date(timer.expiryDate).getTime()
      return !Number.isNaN(at) && at <= horizon
    })
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))
    .slice(0, WALL_MAX_CARDS)
}
