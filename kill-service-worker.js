// A service worker whose only job is to remove itself.
//
// Deployed to s3://meal-hat/service-worker.js on 2026-08-19 to break a live
// reload loop. The story:
//
// The app's updated() handler called location.reload() whenever a new worker
// was found. A reload does NOT promote a waiting worker, so the page came back
// on the old cached bundle, the update fired again, and it reloaded again —
// about three times a second. Two months without a deploy had kept it hidden.
//
// The loop then defended itself: each page load began installing the corrected
// worker, and ~300ms later the reload killed the install before its ~900KB
// precache finished. So the fix could not reach the clients that needed it.
//
// This worker precaches nothing, so it installs in milliseconds and wins that
// race. It then drops every cache, unregisters itself, and navigates the open
// windows — which, with no worker left in control, fetch from the network and
// get the current build.
//
// TEMPORARY. Once clients are off the poisoned worker, the real generated
// service-worker.js goes back (it now sets skipWaiting + clientsClaim, and the
// updated() handler reloads at most once per tab). Keep this file: it is the
// remedy if a bad worker ever ships again.

self.addEventListener('install', () => {
  // Take over immediately rather than waiting for the old worker's clients to
  // close — those clients are exactly the ones stuck in the loop.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((key) => caches.delete(key)));

    await self.registration.unregister();

    // navigate(), not reload(): a real navigation goes to the network now that
    // nothing is intercepting it.
    const windows = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => {})));
  })());
});

// Never serve from cache — there is no cache, and anything this worker still
// controls should go straight to the network.
self.addEventListener('fetch', () => {});
