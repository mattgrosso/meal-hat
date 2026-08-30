// The fridge's capability key — ported from perishable's householdKey.js, and
// the reasoning survives the move intact.
//
// All of a fridge's data lives under `fridge/<key>` where the key is a long
// random secret. The rules deny reads everywhere else, so KNOWING THE KEY IS
// THE AUTHORIZATION. That is not a shortcut around meal-hat's Google sign-in;
// it is the only scheme the kitchen wall tablet can use. Google's popup refuses
// to run inside kiosk WebViews, and a session that lapses on a wall display
// fails silently — a blank kitchen screen nobody notices for a week.
//
// Why the key must be in the PATH rather than a parameter: RTDB rules have
// nowhere to receive a credential. `fridge/<secret>` works because the path is
// the credential. Nesting under the hat would put the fridge behind a guessable
// key (the hat name is an email), so the secret stays where the rules can see
// it. The hat stores a `fridgeKey` pointer for signed-in phones instead.
//
// THE KEY STAYS IN THE URL. Perishable's first version adopted `?k=` into
// localStorage and then stripped it from the address for tidiness, which
// quietly deleted the only way back in. On 2026-08-26 both the wall tablet and
// the phone lost their stored key (iOS clearing site data, Fully Kiosk clearing
// web storage on restart — either does it) and neither could recover without
// being handed the secret again. So:
//
//   - a valid `?k=` is stored AND left in the address bar
//   - a stored key is PUT BACK into the address bar when the URL lacks it
//
// The tradeoff is that the secret shows in the address bar and browser history;
// for a list of what is in the fridge that is the right trade against a screen
// that bricks.

const STORAGE_KEY = 'mealHat.fridgeKey'
const COOKIE_KEY = 'meal_hat_fridge_key'
const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60

// 32+ url-safe chars. Short or malformed values are ignored rather than
// stored, so a truncated link can't quietly replace a working key.
export const KEY_RE = /^[A-Za-z0-9_-]{32,}$/

export const isValidKey = (value) => typeof value === 'string' && KEY_RE.test(value)

// 24 random bytes -> 32 url-safe characters, matching KEY_RE. Used when a hat
// gets a fridge for the first time; every existing hat stays fridgeless until
// someone asks for one.
export const generateFridgeKey = (crypto = window.crypto) => {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// A pasted setup link, or a bare key, or a key with stray whitespace around
// it -> the key. Powers the "paste your link" box on the not-connected
// screen, so a person can always reconnect a device themselves.
export const extractKey = (text) => {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null
  if (isValidKey(trimmed)) return trimmed

  // Any k=... in there, whether it's a full URL or just the query fragment.
  const match = /[?&]k=([A-Za-z0-9_-]+)/.exec(trimmed)
  if (match && isValidKey(match[1])) return match[1]
  return null
}

// Two stores rather than one: localStorage is the primary, a long-lived
// cookie is the backup. They are cleared by different things, so a wipe of
// one often leaves the other — and the URL is the third copy.
const readCookie = (doc) => {
  try {
    const match = new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]*)`).exec(doc.cookie || '')
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

const writeCookie = (doc, key, isSecure) => {
  try {
    doc.cookie =
      `${COOKIE_KEY}=${encodeURIComponent(key)}; max-age=${TEN_YEARS_SECONDS}; path=/; SameSite=Lax` +
      (isSecure ? '; Secure' : '')
  } catch {
    // Cookies blocked; localStorage and the URL still carry it.
  }
}

const readStored = (storage, doc) => {
  let stored = null
  try {
    stored = storage.getItem(STORAGE_KEY)
  } catch {
    // Storage blocked — the cookie may still have it.
  }
  if (isValidKey(stored)) return stored
  const fromCookie = readCookie(doc)
  return isValidKey(fromCookie) ? fromCookie : null
}

export const storeFridgeKey = (key, {
  storage = window.localStorage,
  doc = document,
  isSecure = window.location?.protocol === 'https:'
} = {}) => {
  if (!isValidKey(key)) return false
  try {
    storage.setItem(STORAGE_KEY, key)
  } catch {
    // Can't persist here; the cookie and the URL still can.
  }
  writeCookie(doc, key, isSecure)
  return true
}

// Puts the key into the address bar without navigating, so whatever the person
// bookmarks or adds to their home screen from here carries it.
//
// MEAL-HAT DIFFERENCE, and it is load-bearing: this app uses hash routing, so
// the route lives in `location.hash` and the key rides in `location.search`
// ahead of it — `/?k=<key>#/fridge`. Perishable rebuilt the URL as
// `pathname?query` because it had no hash to lose. Doing that here would drop
// `#/fridge` and send the kiosk back to Home on its next load, which is the
// same class of self-inflicted outage as stripping the key was.
const ensureKeyInUrl = (key, location, history) => {
  try {
    const params = new URLSearchParams(location.search)
    if (params.get('k') === key) return
    params.set('k', key)
    history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash || ''}`)
  } catch {
    // Cosmetic only — the key still works for this load.
  }
}

// Returns the active key or null, and leaves it in the URL either way.
export const adoptFridgeKey = ({
  location = window.location,
  storage = window.localStorage,
  history = window.history,
  doc = document,
  isSecure = window.location?.protocol === 'https:'
} = {}) => {
  const fromUrl = new URLSearchParams(location.search).get('k')

  if (isValidKey(fromUrl)) {
    storeFridgeKey(fromUrl, { storage, doc, isSecure })
    return fromUrl
  }

  const stored = readStored(storage, doc)
  if (stored) {
    // The URL lost it (a bare bookmark, a kiosk reload of the stripped
    // address); put it back so this page is shareable to the next device.
    ensureKeyInUrl(stored, location, history)
    return stored
  }

  return null
}
