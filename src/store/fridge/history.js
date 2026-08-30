// The change log — what actually happened to the fridge, and when.
//
// Every timer added, removed, extended, or re-learned leaves a line here. The
// point is traceability: when a timer looks wrong on the wall, the question is
// always "where did that come from?", and until now nothing could answer it.
// A scan that quietly re-taught a template (the real case: sandwich bread
// drifting to 76 days) was completely invisible.
//
// Pure functions only — the store does the writing, this decides the wording.

const DAY_MS = 24 * 60 * 60 * 1000

// How many entries the sheet loads. Deep enough to cover a month of normal
// use, shallow enough that the wall display isn't holding a year of log in
// memory to show the last ten lines.
export const HISTORY_LIMIT = 200

const ACTION_VERBS = {
  added: 'Added',
  removed: 'Removed',
  extended: 'Extended',
  relearned: 'Re-learned'
}

// Where the change came from. Worth saying out loud: "removed by hand" and
// "removed from a fridge check" are the same row otherwise, and only one of
// them is something you decided on purpose.
const SOURCE_LABELS = {
  hand: 'by hand',
  scan: 'from a photo',
  fridge: 'from a fridge check',
  edit: 'from the wall'
}

// Firebase object -> array, NEWEST FIRST. Push keys already sort
// chronologically, but the timestamp is what's displayed, so sort on that and
// keep the two from ever disagreeing.
export const sortHistory = (historyMap) =>
  Object.keys(historyMap || {})
    .map((id) => ({ id, ...historyMap[id] }))
    .sort((a, b) => new Date(b.at) - new Date(a.at))

const calendarDaysBetween = (then, now) => {
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate(), 12)
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

// "Today" / "Yesterday" / "Sat, Aug 22". Named days for the two that need no
// thought, a date for everything else.
export const dayLabel = (at, now) => {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  const days = calendarDaysBetween(date, now)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export const entryTime = (at) => {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export const describeEntry = (entry) => {
  const verb = ACTION_VERBS[entry?.action] || 'Changed'
  return `${verb} ${entry?.title || 'an item'}`
}

export const describeSource = (entry) => SOURCE_LABELS[entry?.source] || ''

// Entries -> day-headed sections, order preserved within each day. Undated
// entries are dropped rather than filed under a wrong day; a change log that
// lies about when is worse than one that's short.
export const groupByDay = (entries, now) => {
  const sections = []
  let current = null
  for (const entry of entries || []) {
    const label = dayLabel(entry.at, now)
    if (!label) continue
    if (!current || current.label !== label) {
      current = { label, entries: [] }
      sections.push(current)
    }
    current.entries.push(entry)
  }
  return sections
}
