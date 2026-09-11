import { describe, it, expect } from 'vitest'
import {
  generatePairingCode,
  isValidPairingCode,
  normalizePairingCode,
  isFreshPairing,
  pairingPath,
  urlWithKey,
  PAIRING_TTL_MS
} from '../../../src/utils/fridge/pairing'
import { isValidKey } from '../../../src/utils/fridge/fridgeKey'

const KEY = '0rhAwAvV---IB6oZyvWVbGWJBdaO7awf'

describe('generatePairingCode', () => {
  it('is six digits, zero-padded', () => {
    const crypto = { getRandomValues: (buf) => { buf[0] = 4821 } }
    expect(generatePairingCode(crypto)).toBe('004821')
    expect(isValidPairingCode(generatePairingCode(crypto))).toBe(true)
  })

  it('wraps a large random value into the six-digit space', () => {
    const crypto = { getRandomValues: (buf) => { buf[0] = 4294967295 } }
    expect(generatePairingCode(crypto)).toBe('967295')
  })
})

describe('normalizePairingCode', () => {
  it('forgives the spaces and dashes people put between digits', () => {
    expect(normalizePairingCode(' 482 116 ')).toBe('482116')
    expect(normalizePairingCode('482-116')).toBe('482116')
  })

  it('rejects anything that is not exactly six digits', () => {
    expect(normalizePairingCode('48211')).toBeNull()
    expect(normalizePairingCode('4821167')).toBeNull()
    expect(normalizePairingCode('')).toBeNull()
    expect(normalizePairingCode(null)).toBeNull()
  })
})

describe('isFreshPairing', () => {
  const now = 1_800_000_000_000

  it('accepts a recent record with a real key', () => {
    expect(isFreshPairing({ key: KEY, createdAt: now - 5000 }, now, { isValidKey })).toBe(true)
  })

  it('rejects a stale record, so an old attempt cannot pair a tablet later', () => {
    expect(isFreshPairing({ key: KEY, createdAt: now - PAIRING_TTL_MS - 1 }, now, { isValidKey })).toBe(false)
  })

  it('rejects a malformed key, a missing timestamp, and nothing at all', () => {
    expect(isFreshPairing({ key: 'short', createdAt: now }, now, { isValidKey })).toBe(false)
    expect(isFreshPairing({ key: KEY }, now, { isValidKey })).toBe(false)
    expect(isFreshPairing(null, now, { isValidKey })).toBe(false)
  })

  it('tolerates a phone clock slightly ahead of the tablet', () => {
    expect(isFreshPairing({ key: KEY, createdAt: now + 30 * 1000 }, now, { isValidKey })).toBe(true)
  })
})

describe('pairingPath', () => {
  it('lives at the root, beside fridge, not under any hat', () => {
    expect(pairingPath('482116')).toBe('pairings/482116')
  })
})

describe('urlWithKey', () => {
  it('replaces the key, keeps the wall pin, and carries the fridge route', () => {
    expect(urlWithKey(KEY, { pathname: '/', search: '?k=wrongwrongwrongwrongwrongwrongwrong&view=wall' }))
      .toBe(`/?k=${KEY}&view=wall#/fridge`)
  })

  it('works from a bare address', () => {
    expect(urlWithKey(KEY, { pathname: '/', search: '' })).toBe(`/?k=${KEY}#/fridge`)
  })
})
