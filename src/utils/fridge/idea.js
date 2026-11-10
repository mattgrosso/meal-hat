// Asking for today's idea (see aws-lambda/idea.js for what one is).
//
// The same endpoint, auth and job pipeline as a receipt scan or a
// talk-through; the endpoint tells this one apart by the `idea` in the body.
// It also keeps the one-a-day limit: ask twice in a day and the second ask is
// handed the first one's job, so nothing here needs to count.
//
// Dependencies are arguments, as in scan.js, so it tests without a network.
import { SCAN_URL, ScanError, awaitScan } from './scan'

// An idea takes about half a minute. Five minutes of polling is already a
// broken job, and unlike a scan nobody is standing there waiting for it.
export const IDEA_MAX_POLLS = 75

export const submitIdea = async ({ tally, recent = [] }, { url = SCAN_URL, householdKey, idToken, fetchImpl = fetch } = {}) => {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${householdKey}`,
      // The key is checked by a read of the fridge, and that read needs a
      // session: see submitScan.
      'X-Firebase-Token': idToken || ''
    },
    body: JSON.stringify({ idea: { tally, recent } })
  })

  let body = {}
  try { body = await response.json() } catch { /* no body is an error below */ }
  if (!response.ok) {
    // 429 here is not "slow down": it is "today has had its tries".
    const error = new ScanError(body.error || 'Could not ask for an idea.', { retryable: response.status >= 500 })
    error.spent = response.status === 429
    throw error
  }
  if (!body.jobId) throw new ScanError('The idea did not start properly.')
  return body.jobId
}

// Ask and wait. Resolves with the idea itself: { name, line, minutes,
// ingredients, steps }.
export const requestIdea = async (request, options = {}) => {
  const result = await awaitScan(await submitIdea(request, options), { maxPolls: IDEA_MAX_POLLS, ...options })
  if (!result?.idea?.name) throw new ScanError('The idea came back empty.')
  return result.idea
}

// WHETHER THIS DEVICE SHOWS (AND ASKS FOR) THE IDEA.
//
// Off unless asked for, while Matt looks at it: the wall's look is not to
// change without his say-so (CLAUDE.md, "The wall"). `?idea=1` turns it on for
// a device and is remembered, `?idea=0` turns it off again, exactly as
// `?view=` works in viewMode.js and for the same reason: the wall tablet's
// start URL is awkward to change, so one visit has to be enough.
const STORAGE_KEY = 'fridge.idea'
export const IDEA_ON_BY_DEFAULT = false

export const resolveIdeaFlag = ({
  location = window.location,
  storage = window.localStorage,
  fallback = IDEA_ON_BY_DEFAULT
} = {}) => {
  const asked = new URLSearchParams(location.search).get('idea')
  if (asked === '1' || asked === '0') {
    try { storage.setItem(STORAGE_KEY, asked) } catch { /* still honoured for this load */ }
    return asked === '1'
  }
  let kept = null
  try { kept = storage.getItem(STORAGE_KEY) } catch { /* storage blocked */ }
  if (kept === '1' || kept === '0') return kept === '1'
  return fallback
}
