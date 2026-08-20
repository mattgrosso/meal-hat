/* eslint-disable no-console */

import { register } from 'register-service-worker'

// A deploy should reach an open app on its own, without anyone knowing to pull
// down to refresh.
//
// Two things have to be true for that, and each was separately broken:
//
//   1. Something has to NOTICE the new version. The browser checks for a new
//      service worker on navigation, and App.vue checks again whenever the app
//      is brought back to the foreground — but an installed PWA left open on
//      screen does neither, so it could sit on an old build indefinitely.
//   2. Noticing has to lead to a reload. It did not: see the guard below.
const RELOAD_GUARD_KEY = 'mealHatLastUpdateReload';

// A runaway update loop reloads several times a SECOND. A real deploy arrives
// minutes or hours apart. Thirty seconds sits far above the first and far below
// the second, so it caps a loop at roughly two reloads a minute while letting
// every genuine update through.
const MIN_MS_BETWEEN_RELOADS = 30_000;

// How often an open app asks whether there is a new build. Cheap — one
// conditional request for a ~1KB file.
const UPDATE_CHECK_MS = 5 * 60 * 1000;

if (process.env.NODE_ENV === 'production') {
  register(`${process.env.BASE_URL}service-worker.js`, {
    ready () {
      console.log(
        'App is being served from cache by a service worker.\n' +
        'For more details, visit https://goo.gl/AFskqB'
      )
    },
    registered (registration) {
      console.log('Service worker has been registered.')

      // Poll, because the app can stay open and foregrounded for hours. Without
      // this, an installed PWA only ever checks on a cold start or when it
      // comes back from the background.
      setInterval(() => {
        registration.update().catch(() => {
          // Offline, or the check failed. The next tick tries again.
        });
      }, UPDATE_CHECK_MS);
    },
    cached () {
      console.log('Content has been cached for offline use.')
    },
    updatefound () {
      console.log('New content is downloading.')
    },
    updated () {
      console.log('New content is available; reloading.');

      // Rate-limited, NOT once-per-tab.
      //
      // This started life as an unconditional reload, which looped: a reload
      // does not promote a waiting worker, so the page came back on the old
      // bundle, `updated` fired again, and round it went about three times a
      // second. The fix for that was "reload at most once per tab, ever" —
      // which stopped the loop and also stopped every legitimate update after
      // the first. An installed PWA that stays open would take one update and
      // then quietly ignore the rest, which is precisely what got reported.
      //
      // A time window separates the two cases cleanly, because they differ by
      // three orders of magnitude in frequency. sessionStorage, so a fresh tab
      // is never blocked by an older one's timestamp.
      const last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0;
      const sinceLast = Date.now() - last;

      if (last && sinceLast < MIN_MS_BETWEEN_RELOADS) {
        console.warn(
          `Update reload suppressed — one already happened ${Math.round(sinceLast / 1000)}s ago. ` +
          'This is the loop guard; if you see it repeatedly, the new worker is not taking over.'
        );
        return;
      }

      window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));

      // safeReload defers while the user is mid-edit (see ShoppingList's
      // setupReloadProtection) and reloads once they stop. Reloading out from
      // under somebody typing an aisle number is its own bug.
      if (window.safeReload) {
        window.safeReload();
      } else {
        window.location.reload();
      }
    },
    offline () {
      console.log('No internet connection found. App is running in offline mode.')
    },
    error (error) {
      console.error('Error during service worker registration:', error)
    }
  })
}
