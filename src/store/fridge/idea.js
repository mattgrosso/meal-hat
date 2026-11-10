// TODAY'S IDEA (2026-11-09): one thing to cook today from what is already in
// the house. The why, and what Matt settled, is at the top of
// aws-lambda/idea.js, which writes the idea; this file is the app's half:
// which day it is, what the tally looks like to the writer, when to ask, and
// how an idea reads against the fridge as it stands now.
//
// Free of Firebase imports, like paths.js, so it can be tested directly.

const DAY_MS = 24 * 60 * 60 * 1000

// The same day the Lambda keeps (aws-lambda/idea.js): Eastern time, turning
// over at 4am. The house decides the day, not the device, so a phone in
// another timezone and the wall agree on which idea is today's.
export const IDEA_DAY_STARTS_AT_HOUR = 4
export const ideaDay = (now = new Date()) => {
  const shifted = new Date(new Date(now).getTime() - IDEA_DAY_STARTS_AT_HOUR * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(shifted)
}

// "Mon 9 Nov", for the top of the poster. Noon UTC of the day keeps the
// weekday right in any timezone.
export const formatIdeaDay = (day) => {
  const date = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  const part = (options) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(date)
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}`
}

const norm = (text) => String(text || '').trim().toLowerCase().replace(/\s+/g, ' ')

const daysLeft = (timer, now) => {
  const at = new Date(timer.expiryDate).getTime()
  return Number.isNaN(at) ? null : Math.floor((at - now.getTime()) / DAY_MS)
}

// The tally as the writer sees it: one row a food, with how much and how long.
//
// Food the timers say is already PAST its date is left out. The date is an
// estimate and the food may well be fine, but "make dinner out of the thing
// the fridge thinks went off on Tuesday" is not a suggestion to put on a wall.
// Two cards for one food (it happens) become one row.
export const tallyForIdea = (timers = [], now = new Date()) => {
  const rows = new Map()
  for (const timer of timers || []) {
    const title = String(timer?.title || '').trim()
    if (!title) continue
    const quantity = Number.isFinite(timer.quantity) ? timer.quantity : 1
    if (quantity <= 0) continue
    const left = timer.shelfStable ? null : daysLeft(timer, now)
    if (left !== null && left < 0) continue

    const key = norm(title)
    const row = rows.get(key)
    if (!row) {
      rows.set(key, { title, quantity, daysLeft: left, shelfStable: Boolean(timer.shelfStable) })
    } else {
      row.quantity += quantity
      if (left !== null) row.daysLeft = row.daysLeft === null ? left : Math.min(row.daysLeft, left)
      row.shelfStable = row.shelfStable && Boolean(timer.shelfStable)
    }
  }
  return [...rows.values()].map((row) => ({ ...row, quantity: Math.round(row.quantity * 100) / 100 }))
}

// Must match aws-lambda/idea.js: fewer foods than this and the endpoint
// refuses, so the app does not ask.
export const MIN_TALLY = 8

// The names of the last couple of weeks' ideas, newest first, so the writer
// can steer away from them.
export const recentIdeaNames = (ideas = {}, limit = 14) =>
  Object.keys(ideas || {})
    .sort()
    .reverse()
    .map((day) => ideas[day]?.name)
    .filter(Boolean)
    .slice(0, limit)

// What to show: today's, or failing that yesterday's, so the wall is not
// blank between 4am and whenever today's lands. Older than that is not a
// suggestion any more.
export const ideaToShow = (ideas = {}, day = ideaDay()) => {
  if (ideas?.[day]?.name) return { day, idea: ideas[day], today: true }
  const yesterday = ideaDay(new Date(new Date(`${day}T12:00:00Z`).getTime() - DAY_MS + IDEA_DAY_STARTS_AT_HOUR * 60 * 60 * 1000))
  if (ideas?.[yesterday]?.name) return { day: yesterday, idea: ideas[yesterday], today: false }
  return null
}

// Whether to ask for today's. `loaded` matters: before the ideas have arrived
// from the database, "no idea for today" is not yet known, and asking then
// would ask on every page load.
//
// A failed try waits half an hour. The endpoint has its own daily limit, so
// this is manners, not the safeguard.
export const IDEA_RETRY_MS = 30 * 60 * 1000
export const shouldAskForIdea = ({ loaded, ideas, day, tallyCount, asking, lastTriedAt = 0, now = Date.now() }) => {
  if (!loaded || asking) return false
  if (ideas?.[day]?.name) return false
  if (tallyCount < MIN_TALLY) return false
  return now - lastTriedAt >= IDEA_RETRY_MS
}

// A month of ideas is kept (the recent names come from them); older days go.
export const IDEAS_KEPT_DAYS = 30
export const ideaDaysToDrop = (ideas = {}, day = ideaDay()) => {
  const cutoff = new Date(new Date(`${day}T12:00:00Z`).getTime() - IDEAS_KEPT_DAYS * DAY_MS).toISOString().slice(0, 10)
  return Object.keys(ideas || {}).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key) && key < cutoff)
}

// The idea read against the fridge as it stands NOW, which is what makes the
// poster more than a recipe: each food from the house says how long it has
// left, and whether it has gone since the idea was written (somebody ate the
// spinach at lunch).
export const SOON_DAYS = 5
export const ideaIngredients = (idea, timers = [], now = new Date()) => {
  const tally = new Map(tallyForIdea(timers, now).map((row) => [norm(row.title), row]))
  return (idea?.ingredients || []).map((item) => {
    if (item.from !== 'house') return { ...item, soon: false, gone: false, daysLeft: null }
    const row = tally.get(norm(item.listName))
    const left = row ? row.daysLeft : null
    return { ...item, gone: !row, daysLeft: left, soon: left !== null && left <= SOON_DAYS }
  })
}

// What the poster names under the dish: the foods from the house, the ones
// going off soonest first, never the salt and the water.
export const ideaUses = (idea, timers = [], now = new Date()) =>
  ideaIngredients(idea, timers, now)
    .filter((item) => item.from === 'house')
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity))

// How long a food that is going off has, said so it cannot be misread next
// to a dish: "Avocado today" could mean anything, "Avocado use today" can't.
export const formatSoon = (left) => {
  if (left === null || left === undefined) return ''
  if (left <= 0) return 'use today'
  if (left === 1) return '1 day left'
  return `${left} days left`
}

// One flat colour a day, in turn, so each morning's poster looks like a new
// one. Counted from the date, so every device agrees.
export const SWATCHES = ['#ffd60a', '#ff453a', '#0a84ff', '#30d158']
export const swatchFor = (day) => {
  const at = new Date(`${day}T12:00:00Z`).getTime()
  if (Number.isNaN(at)) return SWATCHES[0]
  return SWATCHES[Math.floor(at / DAY_MS) % SWATCHES.length]
}
