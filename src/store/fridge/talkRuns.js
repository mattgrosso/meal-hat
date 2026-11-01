// Keeping each talk-through, and learning from what Matt says it got wrong.
//
// Matt, 2026-11-01: the read-through "seems to miss the same things, and
// strange things get missed and I'm not sure why" — and he wanted a way to
// look over what it did and give feedback "so that we can learn from our
// mistakes". Until now nothing was kept: the draft was cleared on apply and
// the reader's answer was thrown away once the timers were written. So a miss
// could have been the READER (it never heard the food) or MEAL HAT (it heard
// it and the name match lost it), and there was no way to tell which.
//
// Two records, both under the hat (members only — the transcript is his own
// words about his own kitchen):
//
//   talk-runs/<id>     his words, what the reader returned, and the report of
//                      what changed. Reopened from the fridge screen, and read
//                      by `scripts/talk-runs.mjs` to find repeat misses.
//   talk-lessons/<id>  one per correction ("Not right" on a row, or the
//                      "You missed..." box). The most recent go to the reader
//                      with every new read-through.
//
// All pure.

import { normalizeFoodName } from './scanReview'

// The reader's own limits — see MAX_LESSONS in aws-lambda/perishable-vision.js.
// Kept a little under them so a lesson is trimmed here, visibly, rather than
// the whole read-through being refused there.
export const LESSONS_SENT = 30
export const MAX_LESSON_CHARS = 380

const text = (value, max = 300) => String(value ?? '').trim().slice(0, max)

// Firebase keeps no empty arrays and no undefined; a run read back has to
// come out the same shape it went in, or the report screen would throw on a
// missing list.
const list = (value) => Array.isArray(value)
  ? value.filter((entry) => entry != null)
  : (value && typeof value === 'object' ? Object.values(value) : [])

/**
 * What the reader sent back, kept close to as-is. This is the half that tells
 * "the reader never heard it" apart from "Meal Hat lost it": if a food is in
 * here and not in the report, the matching dropped it.
 */
export const readerAnswer = (result) => ({
  items: list(result?.items).map((item) => ({
    heard: text(item?.heard),
    name: text(item?.name, 120),
    knownFoodMatch: text(item?.knownFoodMatch, 120),
    quantity: Number(item?.quantity) || 1,
    counted: item?.counted === 'pieces' ? 'pieces' : 'packages',
    perishable: item?.perishable !== false,
    estimatedShelfLifeDays: Number(item?.estimatedShelfLifeDays) || null
  })),
  outOf: list(result?.outOf).map((item) => ({
    heard: text(item?.heard),
    name: text(item?.name, 120),
    knownFoodMatch: text(item?.knownFoodMatch, 120)
  })),
  unclear: list(result?.unclear).map((row) => ({ heard: text(row?.heard), why: text(row?.why) }))
})

/**
 * The report TalkFlow shows, as it can be stored. Dates become strings and
 * nothing derived at read time is frozen into it; each removed card keeps the
 * record "We have it" puts back.
 */
export const storableReport = (report) => ({
  added: list(report?.added).map((row) => ({
    name: text(row.name, 120),
    heard: text(row.heard),
    readAs: text(row.readAs, 120),
    quantity: row.quantity ?? null,
    days: Number(row.days) || null,
    shelfStable: Boolean(row.shelfStable)
  })),
  confirmed: list(report?.confirmed).map((row) => ({
    id: row.id,
    title: text(row.title, 120),
    heard: text(row.heard),
    expiryDate: row.expiryDate || null,
    quantity: row.quantity ?? null,
    pastDate: Boolean(row.pastDate)
  })),
  removed: list(report?.removed).map((row) => ({
    id: row.id,
    title: text(row.title, 120),
    saidOutOf: Boolean(row.saidOutOf),
    record: row.record || null
  })),
  unclear: list(report?.unclear).map((row) => ({ heard: text(row.heard), why: text(row.why) })),
  spoken: list(report?.spoken).map((key) => text(key, 120))
})

/** One talk-through, as saved. */
export const buildTalkRun = ({ transcript, result, report, applied, now = new Date(), corrections = false }) => ({
  at: now.toISOString(),
  transcript: String(transcript || '').slice(0, 20000),
  reader: readerAnswer(result),
  report: storableReport(report),
  applied: {
    added: Number(applied?.added) || 0,
    removed: Number(applied?.removed) || 0,
    failed: Number(applied?.failed) || 0
  },
  ...(corrections ? { corrections: true } : {})
})

/** A run read back from the database, in the shape TalkFlow renders. */
export const readTalkRun = (id, stored) => {
  if (!stored) return null
  const report = storableReport(stored.report || {})
  return {
    id,
    at: stored.at || null,
    transcript: String(stored.transcript || ''),
    report,
    applied: stored.applied || { added: 0, removed: 0, failed: 0 },
    flagged: stored.flagged || {},
    kept: stored.kept || {}
  }
}

/**
 * A correction -> the lesson that is saved and later sent to the reader.
 *
 *   kind 'wrong'   "Not right" on a row: what he said, what it became, and
 *                  (optionally) what it really was.
 *   kind 'missed'  the "You missed..." box: his own words for what it
 *                  should have heard.
 */
export const buildLesson = ({ kind, heard, readAs, said, runId, now = new Date() }) => {
  const lesson = {
    at: now.toISOString(),
    kind: kind === 'missed' ? 'missed' : 'wrong',
    heard: text(heard),
    readAs: text(readAs, 120),
    said: text(said)
  }
  if (runId) lesson.runId = runId
  return lesson
}

/**
 * A lesson in the words the reader is given. Written as what happened, in
 * the first person, because that is how a correction reads to a person too.
 */
export const lessonText = (lesson) => {
  if (!lesson) return ''
  const heard = text(lesson.heard)
  const readAs = text(lesson.readAs, 120)
  const said = text(lesson.said)
  let line = ''
  if (lesson.kind === 'missed') {
    if (!said) return ''
    line = `An earlier reading missed this, which they had said was in the house: ${said}`
  } else if (heard && readAs) {
    line = said
      ? `They said "${heard}" and an earlier reading took it as "${readAs}". What they meant: ${said}`
      : `They said "${heard}" and an earlier reading took it as "${readAs}", which was wrong.`
  } else if (readAs) {
    line = said
      ? `An earlier reading listed "${readAs}" and was wrong. What they meant: ${said}`
      : `An earlier reading listed "${readAs}", which was wrong.`
  } else {
    return ''
  }
  return line.slice(0, MAX_LESSON_CHARS)
}

/** The stored lessons -> the newest few, as text for the reader. */
export const lessonsForReader = (lessons, limit = LESSONS_SENT) =>
  list(lessons)
    .slice()
    .sort((a, b) => String(b?.at || '').localeCompare(String(a?.at || '')))
    .map(lessonText)
    .filter(Boolean)
    .slice(0, limit)

/**
 * Which counts a correction may log. A correction is a few words about a few
 * foods, so a food it does not mention says nothing about whether it is in
 * the house — only what it names is a reading. (A full talk-through logs a
 * zero for every unmentioned food; that rule must not leak in here.)
 */
export const correctionCounts = (review) => {
  const named = new Set([
    ...list(review?.newItems).map((row) => row.name),
    ...list(review?.confirmed).map((row) => row.title)
  ].map(normalizeFoodName))
  const saidOut = new Set(list(review?.notHeard)
    .filter((row) => row.saidOutOf)
    .map((row) => normalizeFoodName(row.title)))
  return Object.fromEntries(Object.entries(review?.counts || {})
    .filter(([key, n]) => (n > 0 && named.has(key)) || (n === 0 && saidOut.has(key))))
}

/**
 * A correction's review, as it may be applied: everything it ADDS or recounts,
 * and a removal only where he said outright that they are out of it. Nothing
 * goes for being unmentioned — that is a whole-kitchen rule, and a correction
 * is not a walk round the kitchen.
 */
export const correctionReview = (review) => ({
  ...review,
  notHeard: list(review?.notHeard).filter((row) => row.saidOutOf)
})

/**
 * The card a wrong "Added" row put on the fridge, so "Not right" can take it
 * off. Matched by name and by being created at or after the run — a card for
 * the same food that was already there is someone else's.
 */
export const addedTimerFor = (row, timers, runAt) => {
  const name = normalizeFoodName(row?.name)
  const since = runAt ? new Date(runAt).getTime() - 60 * 1000 : 0
  return list(timers).find((timer) =>
    normalizeFoodName(timer?.title) === name &&
    (!since || new Date(timer.createdAt || 0).getTime() >= since)
  ) || null
}
