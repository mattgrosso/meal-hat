/* eslint-disable no-console */

import { register } from 'register-service-worker'
import store from './store'

// A deploy should reach an open app on its own, without anyone knowing to pull
// down to refresh.
//
// Two things have to be true for that, and each was separately broken:
//
//   1. Something has to NOTICE the new version. The browser checks for a new
//      service worker on navigation, and App.vue checks again whenever the app
//      is brought back to the foreground — but an installed PWA left open on
//      screen does neither, so it could sit on an old build indefinitely.
//   2. Noticing has to lead to a reload, and not to a reload loop.
//
// Both now live in App.vue, which compares the bundle filename the server
// serves against the one this page actually loaded. This file is the SECONDARY
// signal: it keeps polling, and hands `updated()` straight to the same flag
// instead of reloading on its own. Two independent reload paths racing is
// exactly the bug class this feature exists to close.

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
      console.log('New content is available.');

      // No reload from here any more. This hook is a race the app often loses
      // in the first place — the build sets `skipWaiting`, so a new worker
      // activates immediately rather than sitting in `installed` where this
      // fires — which is precisely why App.vue compares bundle filenames
      // instead. When it does fire, it is a perfectly good extra signal, so it
      // sets the same flag and lets App.vue decide when reloading is safe.
      //
      // The old 30-second rate limit that used to live here is gone with it:
      // App.vue's `shouldAutoAttempt` allows one attempt per detected bundle,
      // which caps the 2026-08-19 loop harder while still letting every real
      // deploy through.
      store.commit('setUpdateAvailable', true);
    },
    offline () {
      console.log('No internet connection found. App is running in offline mode.')
    },
    error (error) {
      console.error('Error during service worker registration:', error)
    }
  })
}
