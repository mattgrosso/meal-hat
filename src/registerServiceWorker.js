/* eslint-disable no-console */

import { register } from 'register-service-worker'

if (process.env.NODE_ENV === 'production') {
  register(`${process.env.BASE_URL}service-worker.js`, {
    ready () {
      console.log(
        'App is being served from cache by a service worker.\n' +
        'For more details, visit https://goo.gl/AFskqB'
      )
    },
    registered () {
      console.log('Service worker has been registered.')
    },
    cached () {
      console.log('Content has been cached for offline use.')
    },
    updatefound () {
      console.log('New content is downloading.')
    },
    updated () {
      console.log('New content is available; please refresh.');

      // Reload AT MOST ONCE per tab, ever.
      //
      // This used to reload unconditionally. A reload does not promote a
      // waiting service worker, so the page came straight back on the old
      // cached bundle, `updated` fired again, and it reloaded again — about
      // three times a second, forever. workboxOptions.skipWaiting now makes the
      // new worker take over on install, but this guard stays: it is the thing
      // that makes the failure a single wasted reload instead of a loop, and it
      // costs nothing when the update works.
      //
      // sessionStorage, not localStorage — scoped to this tab, so a genuine
      // update later in the day still gets its reload.
      if (window.sessionStorage.getItem('mealHatReloadedForUpdate')) {
        console.log('Already reloaded once for an update; not reloading again.');
        return;
      }
      window.sessionStorage.setItem('mealHatReloadedForUpdate', '1');

      // Use safe reload if available, otherwise fallback to normal reload
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
