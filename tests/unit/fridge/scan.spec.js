import { describe, it, expect, vi } from 'vitest'
import { submitScan, awaitScan, ScanError, POLL_TIMEOUT_MS } from '../../../src/utils/fridge/scan.js'
import { fitWithin, base64FromDataUrl, preparePhoto, renderAtEdge } from '../../../src/utils/fridge/photo.js'

const options = (fetchImpl, extra = {}) => ({
  url: 'https://scan.example/scan',
  householdKey: 'k'.repeat(32),
  fetchImpl,
  sleep: async () => {},
  ...extra
})

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
})

describe('submitScan', () => {
  it('hands back the job id, authorized by the household key', async () => {
    const fetchImpl = vi.fn(async () => reply(202, { jobId: 'abc', status: 'pending' }))
    const jobId = await submitScan(
      { image: 'x', mediaType: 'image/jpeg' },
      options(fetchImpl, { knownFoods: ['Cheddar Cheese'] })
    )
    expect(jobId).toBe('abc')

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://scan.example/scan')
    expect(init.headers.Authorization).toBe(`Bearer ${'k'.repeat(32)}`)
    // The household vocabulary rides along so the model can use it.
    expect(JSON.parse(init.body).knownFoods).toEqual(['Cheddar Cheese'])
  })

  // A rejected photo will be rejected again; a rate limit or a 502 won't.
  it('marks a rate limit retryable and a bad photo not', async () => {
    const limited = await submitScan({}, options(async () => reply(429, { error: 'slow down' })))
      .catch((error) => error)
    expect(limited).toBeInstanceOf(ScanError)
    expect(limited.retryable).toBe(true)

    const rejected = await submitScan({}, options(async () => reply(413, { error: 'too big' })))
      .catch((error) => error)
    expect(rejected.retryable).toBe(false)
    expect(rejected.message).toBe('too big')
  })

  it('refuses a success that carries no job id', async () => {
    await expect(submitScan({}, options(async () => reply(202, {}))))
      .rejects.toThrow(/did not start/)
  })
})

describe('awaitScan', () => {
  it('returns the reading once the job finishes', async () => {
    const replies = [
      reply(200, { status: 'pending' }),
      reply(200, { status: 'pending' }),
      reply(200, { status: 'done', items: [{ name: 'Milk' }], obscured: 1 })
    ]
    const result = await awaitScan('abc', options(async () => replies.shift()))
    expect(result.items).toHaveLength(1)
    expect(result.obscured).toBe(1)
  })

  it('reports a failed job in the words the server used', async () => {
    await expect(awaitScan('abc', options(async () => reply(200, { status: 'failed', error: 'Too much food' }))))
      .rejects.toThrow('Too much food')
  })

  // A dropped poll is not a failed scan — the server is still working, and
  // the next poll will find it.
  it('rides out a lost connection and keeps polling', async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call += 1
      if (call <= 3) throw new TypeError('Network request failed')
      return reply(200, { status: 'done', items: [] })
    })
    await expect(awaitScan('abc', options(fetchImpl))).resolves.toMatchObject({ status: 'done' })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('rides out a server hiccup too', async () => {
    const replies = [reply(500, {}), reply(502, {}), reply(200, { status: 'done', items: [] })]
    await expect(awaitScan('abc', options(async () => replies.shift()))).resolves.toBeTruthy()
  })

  // A 404 is different in kind: the job is gone and no amount of waiting
  // brings it back.
  it('stops immediately when the job is gone', async () => {
    const fetchImpl = vi.fn(async () => reply(404, { error: 'expired' }))
    await expect(awaitScan('abc', options(fetchImpl))).rejects.toThrow(/expired/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('gives up rather than spinning forever', async () => {
    let clock = 0
    const result = await awaitScan('abc', options(
      async () => reply(200, { status: 'pending' }),
      { now: () => { clock += 30_000; return clock }, timeout: POLL_TIMEOUT_MS }
    )).catch((error) => error)
    expect(result).toBeInstanceOf(ScanError)
    expect(result.message).toMatch(/longer than it should/)
  })

  it('reports how long it has been waiting', async () => {
    const ticks = []
    const replies = [reply(200, { status: 'pending' }), reply(200, { status: 'done' })]
    await awaitScan('abc', options(async () => replies.shift(), { onTick: (ms) => ticks.push(ms) }))
    expect(ticks.length).toBe(2)
  })
})

describe('fitWithin', () => {
  it('brings a phone photo down to the long edge', () => {
    expect(fitWithin(6048, 8064, 1568)).toEqual({ width: 1176, height: 1568 })
  })

  it('keeps the aspect ratio whichever way the photo is turned', () => {
    expect(fitWithin(8064, 6048, 1568)).toEqual({ width: 1568, height: 1176 })
  })

  it('never scales a small photo up', () => {
    expect(fitWithin(800, 600, 1568)).toEqual({ width: 800, height: 600 })
  })

  it('is safe on junk', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 })
    expect(fitWithin(undefined, undefined)).toEqual({ width: 0, height: 0 })
  })
})

describe('preparePhoto', () => {
  it('produces the base64 body the endpoint wants, at the capped size', async () => {
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL: vi.fn(() => 'data:image/jpeg;base64,QUJD')
    }
    const close = vi.fn()

    const photo = await preparePhoto('file', {
      createBitmap: async () => ({ width: 6048, height: 8064, close }),
      makeCanvas: (width, height) => Object.assign(canvas, { width, height })
    })

    expect(photo).toMatchObject({ image: 'QUJD', mediaType: 'image/jpeg', width: 1176, height: 1568 })
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1176, 1568)
    expect(close).toHaveBeenCalled()
  })

  it('strips the data-url prefix', () => {
    expect(base64FromDataUrl('data:image/jpeg;base64,AAAA')).toBe('AAAA')
    expect(base64FromDataUrl('nonsense')).toBe('')
    expect(base64FromDataUrl(null)).toBe('')
  })
})

describe('renderAtEdge', () => {
  const harness = (natural) => {
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL: vi.fn(() => 'data:image/jpeg;base64,BIG')
    }
    const close = vi.fn()
    return {
      drawImage,
      canvas,
      close,
      options: {
        createBitmap: async () => ({ ...natural, close }),
        makeCanvas: (width, height) => Object.assign(canvas, { width, height })
      }
    }
  }

  // The point of it: the upload is capped at 1568 because the API resizes
  // anyway, but a person zooming in wants what the phone actually captured.
  it('renders the original far larger than the uploaded copy', async () => {
    const { canvas, options } = harness({ width: 6048, height: 8064 })
    await renderAtEdge('file', 2600, options)
    expect(Math.max(canvas.width, canvas.height)).toBe(2600)
  })

  it('still never upscales a small photo', async () => {
    const { canvas, options } = harness({ width: 900, height: 600 })
    await renderAtEdge('file', 2600, options)
    expect([canvas.width, canvas.height]).toEqual([900, 600])
  })

  it('frees the bitmap — these are the big ones', async () => {
    const { close, options } = harness({ width: 6048, height: 8064 })
    await renderAtEdge('file', 2600, options)
    expect(close).toHaveBeenCalled()
  })
})
