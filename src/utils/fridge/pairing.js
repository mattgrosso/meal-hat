// Pairing a wall display without typing the fridge key on it.
//
// The kiosk URL carries a 32-character secret, and on 2026-09-11 Matt typed it
// into the tablet by hand, got one character wrong, and — because a
// well-formed key that names no fridge read back as an EMPTY fridge — saw a
// blank wall with nothing to tell him why. Typing it again on a tablet
// keyboard with no clipboard is exactly the chore this removes.
//
// The shape: the not-connected screen mints a short numeric code and listens
// at `pairings/<code>`. A signed-in phone, which already knows the hat's key,
// writes `{ key, createdAt }` there. The tablet adopts the key, deletes the
// pairing, and reloads with the key in its URL as usual.
//
// Six digits rather than four: an anonymous session can read any pairing it
// can name, so the code is the only thing between a guesser and the key while
// a pairing is open. A million codes, a window measured in seconds (the tablet
// deletes it the moment it lands) and a ten-minute ceiling is enough for what
// the key protects — a list of what is in someone's fridge.

export const PAIRING_CODE_LENGTH = 6
export const PAIRING_TTL_MS = 10 * 60 * 1000

export const CODE_RE = /^[0-9]{6}$/

export const isValidPairingCode = (value) => typeof value === 'string' && CODE_RE.test(value)

// A pasted or typed code, with the spaces and dashes people add when reading
// digits off a screen ("482 116", "482-116") removed.
export const normalizePairingCode = (text) => {
  const digits = String(text || '').replace(/[^0-9]/g, '')
  return isValidPairingCode(digits) ? digits : null
}

export const pairingPath = (code) => `pairings/${code}`

// Six random digits from the CSPRNG, zero-padded so 004821 is as likely as
// any other and reads as six digits on the wall.
export const generatePairingCode = (crypto = window.crypto) => {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return String(buffer[0] % 1000000).padStart(PAIRING_CODE_LENGTH, '0')
}

// The tablet trusts a pairing only if it carries a well-formed key and is
// recent. A stale record left behind by an interrupted attempt must not pair a
// tablet ten days later against a key that has since been replaced.
export const isFreshPairing = (record, now = Date.now(), { isValidKey } = {}) => {
  if (!record || typeof record !== 'object') return false
  if (typeof isValidKey === 'function' && !isValidKey(record.key)) return false
  if (typeof record.key !== 'string' || !record.key) return false
  const createdAt = Number(record.createdAt)
  if (!Number.isFinite(createdAt)) return false
  const age = now - createdAt
  return age >= -60 * 1000 && age <= PAIRING_TTL_MS
}

// The URL a device reloads into once it holds a key: `?k=` replaced, every
// other parameter kept (the wall's `view=wall` pin included), and the route
// hash carried explicitly — this app routes on the hash, and rebuilding the
// address as `pathname?query` alone would land the tablet on Home.
export const urlWithKey = (key, { pathname = '/', search = '' } = {}) => {
  const params = new URLSearchParams(search)
  params.set('k', key)
  return `${pathname}?${params.toString()}#/fridge`
}
