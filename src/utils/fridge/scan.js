// Talking to the scan endpoint, which is a JOB and not a request.
//
// Reading a dense photo takes 40-100+ seconds (Shelfie's measured numbers; the
// architecture is ported from there). POST returns a job id straight away and
// the result is collected by polling — see aws-lambda/perishable-vision.js.
//
// Auth is the household key (see lib/householdKey.js), sent as a bearer
// token. Everything here takes its dependencies as arguments so the whole
// thing is testable without a network.

export const SCAN_URL = 'https://ifnzds1okb.execute-api.us-east-1.amazonaws.com/scan'

export const POLL_EVERY_MS = 4000
// Comfortably past the slowest real scan plus a cold start. A job that hasn't
// finished by now isn't slow, it's broken, and saying so beats a spinner that
// never stops.
export const POLL_TIMEOUT_MS = 4 * 60 * 1000

export class ScanError extends Error {
  constructor (message, { retryable = false } = {}) {
    super(message)
    this.name = 'ScanError'
    this.retryable = retryable
  }
}

const readBody = async (response) => {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

/**
 * Hand a photo over and get a job id back. Resolves in well under a second —
 * the reading hasn't started yet. knownFoods is the household's template
 * names, so the model answers in the household's own vocabulary.
 */
export const submitScan = async (photo, { url = SCAN_URL, householdKey, knownFoods = [], fetchImpl = fetch } = {}) => {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${householdKey}`
    },
    body: JSON.stringify({ image: photo.image, mediaType: photo.mediaType, knownFoods })
  })

  const body = await readBody(response)
  if (!response.ok) {
    // 429 and 5xx are worth another go; a rejected photo is not.
    throw new ScanError(
      body.error || 'Could not start that scan.',
      { retryable: response.status === 429 || response.status >= 500 }
    )
  }
  if (!body.jobId) throw new ScanError('The scan did not start properly.')
  return body.jobId
}

/**
 * Wait for a job, reporting progress as it goes.
 *
 * A poll that fails is NOT fatal: phones lose signal. The work is happening
 * server-side regardless, so a failed poll is skipped and the next one tries
 * again — only the overall deadline ends it.
 */
export const awaitScan = async (jobId, {
  url = SCAN_URL,
  householdKey,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) }),
  now = () => Date.now(),
  every = POLL_EVERY_MS,
  timeout = POLL_TIMEOUT_MS,
  onTick = () => {}
} = {}) => {
  const startedAt = now()

  for (;;) {
    if (now() - startedAt > timeout) {
      throw new ScanError('That scan is taking longer than it should. Try again.')
    }
    await sleep(every)
    onTick(now() - startedAt)

    let body
    try {
      const response = await fetchImpl(`${url}?job=${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${householdKey}` }
      })
      // A 404 means the job is genuinely gone — retrying can't bring it back.
      if (response.status === 404) throw new ScanError('That scan expired before it finished.')
      if (!response.ok) continue
      body = await readBody(response)
    } catch (error) {
      if (error instanceof ScanError) throw error
      continue // Lost signal. The server is still working.
    }

    if (body.status === 'done') return body
    if (body.status === 'failed') throw new ScanError(body.error || 'That scan failed.')
  }
}

/**
 * Submit and wait. The one call a screen makes per photo.
 */
export const scanPhoto = async (photo, options) =>
  awaitScan(await submitScan(photo, options), options)
