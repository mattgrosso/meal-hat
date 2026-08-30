// Perishable is two surfaces sharing one URL and one database.
//
//   'wall'  — the Galaxy tablet mounted in the kitchen. A display: what's in
//             the fridge, glanceable from across the room. Never a camera;
//             nobody photographs groceries with a tablet screwed to a wall.
//   'phone' — Matt's phone. A capture surface: point it at the counter. It
//             deliberately does NOT show the timers (Matt, 2026-08-25: "The
//             UI on the phone shouldn't bother showing me the timers. It
//             should be its own version").
//
// Chosen by viewport width, because that is the actual difference and it
// needs no setup on either device. `?view=wall` / `?view=phone` pins it and
// is remembered, so a misjudged screen is a one-time URL away from fixed —
// worth having, since the wall tablet's start URL is inconvenient to change
// and a wall that flipped to capture mode would be a blank kitchen screen.

const STORAGE_KEY = 'perishable.viewMode'
export const MODES = ['wall', 'phone']

// The kiosk tablet lands far above this; a phone in portrait far below.
export const WALL_MIN_WIDTH = 900

export const modeForWidth = (width) => (width >= WALL_MIN_WIDTH ? 'wall' : 'phone')

export const resolveViewMode = ({
  location = window.location,
  storage = window.localStorage,
  width = window.innerWidth
} = {}) => {
  const requested = new URLSearchParams(location.search).get('view')
  if (MODES.includes(requested)) {
    try {
      storage.setItem(STORAGE_KEY, requested)
    } catch {
      // Can't persist; still honour it for this load.
    }
    return requested
  }

  let pinned = null
  try {
    pinned = storage.getItem(STORAGE_KEY)
  } catch {
    // Storage blocked — fall through to the width.
  }
  if (MODES.includes(pinned)) return pinned

  return modeForWidth(width)
}
