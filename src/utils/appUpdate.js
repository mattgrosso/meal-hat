// Shared machinery for applying a detected app update.
//
// Matt, 2026-08-22: "All of our apps need the new version auto reload feature
// we have in Cinemaroll." Ported from that repo's src/utils/appUpdate.js, with
// the unsafe-moment list rewritten for what Meal Hat actually holds in memory.
//
// The rule this whole file exists to keep: NEVER reload out from under the
// user. This app is used one-handed in a grocery store, mid-edit, with bad
// signal. A reload that lands on the wrong second loses typing, an unsaved
// grocery edit, a session-only "I'm out of olive oil", or a half-finished draw.

// Waits until no service worker install is in flight, so a reload lands on the
// NEW app instead of a mixed old/new state. Capped; failures never block.
export async function waitForNewWorker (timeoutMs = 15000) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (!registration) return;
    await registration.update().catch(() => {});
    const deadline = Date.now() + timeoutMs;
    while ((registration.installing || registration.waiting) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch {
    // Any surprise here must never eat the reload itself.
  }
}

export async function reloadForUpdate () {
  await waitForNewWorker();
  window.location.reload();
}

// The hashed entry bundle, e.g. `js/app.1acf3f22.js`.
//
// This one pattern is the whole update detector: the filename the server hands
// out versus the one this page actually loaded. Verified against a real
// production build — Vue CLI emits exactly two scripts, `js/chunk-vendors.<hash>.js`
// FIRST and `js/app.<hash>.js` second, both lowercase hex. `chunk-vendors`
// deliberately does not match: it changes only when a dependency does, so it
// would miss most deploys. Kept in one place so a build-output change breaks a
// test rather than silently disabling auto-update.
export const ENTRY_BUNDLE_PATTERN = /js\/app\.[a-z0-9]+\.js/;

/** The entry bundle the server is currently serving, from index.html's text. */
export function entryBundleFromHtml (html) {
  return (html || '').match(ENTRY_BUNDLE_PATTERN)?.[0] || null;
}

/** The entry bundle THIS page is running, from its own script `src`s. */
export function entryBundleFromScripts (sources = []) {
  for (const source of sources) {
    const match = (source || '').match(ENTRY_BUNDLE_PATTERN);
    if (match) return match[0];
  }
  return null;
}

// Screens register a reason while they are holding something that only exists
// in memory. This is the escape hatch for state no DOM check can see: the
// shopping list's session-only forced staples and open grocery edit, and the
// window between `applyDraw` and `generateShoppingListFromMeals` where a reload
// would leave a schedule with no shopping list behind it.
//
// Reasons are strings, and a screen MUST clear its own in beforeUnmount — a
// reason left set after its component is gone blocks updates forever.
const busyReasons = new Set();

export function markBusy (reason) {
  busyReasons.add(reason);
}

export function clearBusy (reason) {
  busyReasons.delete(reason);
}

export function currentBusyReasons () {
  return Array.from(busyReasons);
}

// Is RIGHT NOW a safe moment to reload out from under the user?
// Pure and injectable, because the unit suite runs in the `node` environment
// with no DOM at all — every browser reference arrives as an argument.
//
// Unsafe whenever:
//  - a form control is focused (they are typing an aisle, a quantity, a name),
//  - a modal is open (Meal Hat has two kinds; see below),
//  - a guided tour is running (Shepherd would be left pointing at nothing),
//  - any screen has registered an in-memory flow as busy.
export function isSafeMomentForReload ({
  activeElement = typeof document === 'undefined' ? null : document.activeElement,
  bodyClassList = typeof document === 'undefined' ? null : document.body.classList,
  doc = typeof document === 'undefined' ? null : document,
  busy = busyReasons
} = {}) {
  const tag = activeElement?.tagName || '';
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return false;
  if (activeElement?.isContentEditable) return false;

  // Two modal conventions live side by side. `src/components/Modal.vue` toggles
  // `show d-block` on its own element, while ShoppingList's quick-add uses
  // Bootstrap's Modal, which adds `modal-open` to the body and `show` to the
  // dialog. `.modal.show` catches both; the body class is the belt to its
  // braces, since Bootstrap sets it first.
  if (bodyClassList?.contains?.('modal-open')) return false;
  if (doc?.querySelector?.('.modal.show')) return false;

  // A tour step. Shepherd 11 sets no body class and is imported lazily, so
  // there is no `Shepherd.activeTour` to consult from here — but a live step
  // always has an element in the document, and both complete and cancel
  // destroy it.
  if (doc?.querySelector?.('.shepherd-element')) return false;

  if (busy?.size) return false;

  return true;
}

// One auto-attempt per detected target bundle, ever — if the reload does not
// actually get us onto the new version (stuck worker, cache oddity), we stop
// rather than reloading in a loop. This repo has already lived through a
// reload loop at three page loads a second (2026-08-19); the guard replaces
// the 30-second rate limit that used to sit in registerServiceWorker.js, and
// is strictly stronger because each deploy carries its own key.
const ATTEMPT_KEY = 'auto-update-attempted-for';

export function shouldAutoAttempt (targetBundle, storage = window.sessionStorage) {
  try {
    if (storage.getItem(ATTEMPT_KEY) === targetBundle) return false;
    storage.setItem(ATTEMPT_KEY, targetBundle);
    return true;
  } catch {
    return true; // storage unavailable: still better to try once than never
  }
}
