import { describe, it, expect, vi } from 'vitest'
import {
  adoptFridgeKey,
  storeFridgeKey,
  generateFridgeKey,
  extractKey,
  isValidKey
} from '../../../src/utils/fridge/fridgeKey'

const GOOD_KEY = 'aB3xK9mQ2rT7wY4zC8vN1pL6sD0fG5hJ'

const fakeStorage = (initial = {}) => {
  const map = { ...initial }
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = v },
    map
  }
}

// A cookie jar just real enough: assigning to .cookie appends, reading
// returns only the name=value pairs — a browser never hands the attributes
// back. `writes` keeps the raw strings so the attributes can still be
// asserted on.
const fakeDoc = (initial = '') => {
  const jar = initial ? [initial] : []
  const writes = []
  return {
    writes,
    get cookie () { return jar.join('; ') },
    set cookie (value) {
      writes.push(String(value))
      jar.push(String(value).split(';')[0])
    }
  }
}

const fakeContext = ({ search = '', stored = null, cookie = '', hash = '' } = {}) => ({
  location: { search, pathname: '/', hash },
  storage: fakeStorage(stored ? { 'mealHat.fridgeKey': stored } : {}),
  history: { replaceState: vi.fn() },
  doc: fakeDoc(cookie),
  isSecure: true
})

describe('isValidKey', () => {
  it('accepts 32+ url-safe chars and nothing shorter or weirder', () => {
    expect(isValidKey(GOOD_KEY)).toBe(true)
    expect(isValidKey('short')).toBe(false)
    expect(isValidKey(GOOD_KEY.slice(0, 31))).toBe(false)
    expect(isValidKey(`${GOOD_KEY}!`)).toBe(false)
    expect(isValidKey(null)).toBe(false)
  })
})

describe('extractKey', () => {
  it('takes a whole setup link', () => {
    expect(extractKey(`https://example.com/?k=${GOOD_KEY}`)).toBe(GOOD_KEY)
    expect(extractKey(`https://example.com/?view=wall&k=${GOOD_KEY}`)).toBe(GOOD_KEY)
  })

  it('takes a bare key, whitespace and all', () => {
    expect(extractKey(`  ${GOOD_KEY}\n`)).toBe(GOOD_KEY)
  })

  it('refuses text with no usable key in it', () => {
    expect(extractKey('https://example.com/')).toBe(null)
    expect(extractKey('?k=tooshort')).toBe(null)
    expect(extractKey('')).toBe(null)
    expect(extractKey(null)).toBe(null)
  })
})

describe('adoptFridgeKey', () => {
  // THE BUG THIS FILE EXISTS FOR (2026-08-25): the key used to be stripped
  // out of the URL after being stored, so when the wall tablet and the phone
  // both lost their storage there was no way back in. The address bar is the
  // third copy and the only one a bookmark or kiosk start URL preserves.
  it('LEAVES the key in the URL — never strips it', () => {
    const ctx = fakeContext({ search: `?k=${GOOD_KEY}` })
    expect(adoptFridgeKey(ctx)).toBe(GOOD_KEY)
    expect(ctx.history.replaceState).not.toHaveBeenCalled()
  })

  it('puts a stored key BACK into a URL that lost it', () => {
    const ctx = fakeContext({ stored: GOOD_KEY, search: '' })
    expect(adoptFridgeKey(ctx)).toBe(GOOD_KEY)
    expect(ctx.history.replaceState).toHaveBeenCalledWith(null, '', `/?k=${GOOD_KEY}`)
  })

  it('preserves other params when restoring the key', () => {
    const ctx = fakeContext({ stored: GOOD_KEY, search: '?view=wall' })
    adoptFridgeKey(ctx)
    expect(ctx.history.replaceState).toHaveBeenCalledWith(null, '', `/?view=wall&k=${GOOD_KEY}`)
  })

  // Meal-hat routes on the hash, so the kiosk's URL is `/?k=<key>#/fridge`.
  // Perishable rebuilt the address as `pathname?query` because it had no hash
  // to lose; doing that here would drop `#/fridge` and land the wall tablet on
  // Home at its next reload — the same shape of self-inflicted outage as
  // stripping the key was.
  it('keeps the route hash when restoring the key', () => {
    const ctx = fakeContext({ stored: GOOD_KEY, search: '', hash: '#/fridge' })
    expect(adoptFridgeKey(ctx)).toBe(GOOD_KEY)
    expect(ctx.history.replaceState).toHaveBeenCalledWith(null, '', `/?k=${GOOD_KEY}#/fridge`)
  })

  it('keeps the hash alongside other params too', () => {
    const ctx = fakeContext({ stored: GOOD_KEY, search: '?view=wall', hash: '#/fridge' })
    adoptFridgeKey(ctx)
    expect(ctx.history.replaceState).toHaveBeenCalledWith(null, '', `/?view=wall&k=${GOOD_KEY}#/fridge`)
  })

  it('writes both stores, so one being cleared is survivable', () => {
    const ctx = fakeContext({ search: `?k=${GOOD_KEY}` })
    adoptFridgeKey(ctx)
    expect(ctx.storage.map['mealHat.fridgeKey']).toBe(GOOD_KEY)
    expect(ctx.doc.cookie).toContain(GOOD_KEY)
  })

  it('recovers from the cookie when localStorage has been wiped', () => {
    const ctx = fakeContext({ cookie: `meal_hat_fridge_key=${GOOD_KEY}` })
    expect(adoptFridgeKey(ctx)).toBe(GOOD_KEY)
  })

  it('a malformed URL key cannot replace a working stored key', () => {
    const ctx = fakeContext({ search: '?k=truncated', stored: GOOD_KEY })
    expect(adoptFridgeKey(ctx)).toBe(GOOD_KEY)
    expect(ctx.storage.map['mealHat.fridgeKey']).toBe(GOOD_KEY)
  })

  it('a fresh URL key replaces the stored one (key rotation)', () => {
    const newKey = GOOD_KEY.split('').reverse().join('')
    const ctx = fakeContext({ search: `?k=${newKey}`, stored: GOOD_KEY })
    expect(adoptFridgeKey(ctx)).toBe(newKey)
    expect(ctx.storage.map['mealHat.fridgeKey']).toBe(newKey)
  })

  it('returns null with no key anywhere — the loud not-connected case', () => {
    expect(adoptFridgeKey(fakeContext())).toBe(null)
  })

  it('still works for the load when storage throws', () => {
    const ctx = fakeContext({ search: `?k=${GOOD_KEY}` })
    ctx.storage.getItem = () => { throw new Error('blocked') }
    ctx.storage.setItem = () => { throw new Error('blocked') }
    expect(adoptFridgeKey(ctx)).toBe(GOOD_KEY)
  })
})

describe('storeFridgeKey', () => {
  it('writes a valid key to both stores and refuses a junk one', () => {
    const ctx = fakeContext()
    expect(storeFridgeKey(GOOD_KEY, ctx)).toBe(true)
    expect(ctx.storage.map['mealHat.fridgeKey']).toBe(GOOD_KEY)

    const bad = fakeContext()
    expect(storeFridgeKey('nope', bad)).toBe(false)
    expect(bad.storage.map['mealHat.fridgeKey']).toBeUndefined()
  })

  // Secure on https, absent on http — otherwise `yarn dev` over plain http
  // silently stores no cookie at all.
  it('marks the cookie Secure on https and not on plain http', () => {
    const secure = fakeContext()
    storeFridgeKey(GOOD_KEY, secure)
    expect(secure.doc.writes.join(' ')).toContain('Secure')

    const local = { ...fakeContext(), isSecure: false }
    storeFridgeKey(GOOD_KEY, local)
    expect(local.doc.writes.join(' ')).not.toContain('Secure')
  })
})

describe('generateFridgeKey', () => {
  // A hat gets one of these the first time someone asks it for a fridge.
  // Every existing hat stays fridgeless, which is what keeps this change
  // invisible to the other thirteen accounts in the database.
  const fakeCrypto = (fill) => ({
    getRandomValues: (arr) => { arr.fill(fill); return arr }
  })

  it('produces a key its own validator accepts', () => {
    expect(isValidKey(generateFridgeKey(fakeCrypto(7)))).toBe(true)
  })

  it('is url-safe — no +, / or = to mangle in a query string', () => {
    // 251 and 255 are the byte pairs that base64 renders as '+' and '/'.
    for (const fill of [0, 62, 63, 251, 255]) {
      expect(generateFridgeKey(fakeCrypto(fill))).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('round-trips through extractKey out of a real setup link', () => {
    const key = generateFridgeKey(fakeCrypto(42))
    expect(extractKey(`https://meal-hat.example/?k=${key}#/fridge`)).toBe(key)
  })

  it('draws on the crypto RNG rather than Math.random', () => {
    const getRandomValues = vi.fn((arr) => arr.fill(1))
    generateFridgeKey({ getRandomValues })
    expect(getRandomValues).toHaveBeenCalledOnce()
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(24)
  })
})
