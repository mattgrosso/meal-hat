// Remembering a job that is still being worked on, so leaving the app is safe.
//
// MATT, 2026-09-20, after his first real read-through: "Is it safe for me to
// leave the app and do other things while it's thinking?"
//
// It was not, and the answer had two separate halves both going wrong.
//
//   1. The result of a scan lives in S3 and is only ever collected by the
//      PAGE that submitted it. Close the tab — or let iOS discard a
//      backgrounded web view, which it does freely — and the model has done
//      the work, been paid for, and nobody ever picks the answer up. Nothing
//      is applied and nothing says so.
//
//   2. The poll gave up after four minutes of WALL CLOCK. A phone that locks
//      for five minutes comes back to a timer that has already expired, so
//      the very first check after unlocking throws "this is taking longer
//      than it should" — about a job that finished twenty seconds in.
//
// So the job id is written here the moment it is submitted, and the fridge
// screen looks for one every time it opens. Coming back to the app IS the
// recovery: whatever was in flight is collected and applied, usually
// instantly, because the answer has been sitting in S3 waiting.
//
// Storage may THROW rather than fail quietly (Safari, private mode), so every
// access is wrapped. Losing the pointer costs a re-read; taking the screen
// down with it would cost the whole feature.

const KEY = 'mealhat.fridge.pendingJob'

// Jobs expire from the bucket after a day, so a pointer older than that can
// only ever resolve to "no such scan". Kept comfortably under it.
export const PENDING_MAX_AGE_MS = 12 * 60 * 60 * 1000

/**
 * @param job.id    the scan job id
 * @param job.kind  'talk' | 'receipt' — which flow should collect it, since
 *                  the two apply their results very differently
 */
export const rememberJob = (job, { storage = window.localStorage, now = Date.now } = {}) => {
  try {
    if (!job?.id) return
    storage.setItem(KEY, JSON.stringify({ id: job.id, kind: job.kind || 'talk', at: now() }))
  } catch {
    // No storage. The in-page poll still works; this is the safety net.
  }
}

export const readPendingJob = ({ storage = window.localStorage, now = Date.now } = {}) => {
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.id) return null
    if (!Number.isFinite(parsed.at) || now() - parsed.at > PENDING_MAX_AGE_MS) return null
    return { id: String(parsed.id), kind: parsed.kind || 'talk', at: parsed.at }
  } catch {
    return null
  }
}

export const clearPendingJob = ({ storage = window.localStorage } = {}) => {
  try {
    storage.removeItem(KEY)
  } catch {
    // Nothing depends on it.
  }
}
