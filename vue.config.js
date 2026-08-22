const { defineConfig } = require('@vue/cli-service');
const webpack = require('webpack');

// The build stamp (see src/utils/buildStamp.js). Set here, at config
// evaluation, so it names the moment THIS build ran rather than the moment
// the page was loaded — an app left open for a week keeps showing the build
// it is still running. vue-cli inlines every VUE_APP_* var it finds on
// process.env when it resolves the client env, which happens after this file
// is read, so assigning it here is enough — it deliberately does not live in
// .env, which version.js rewrites from a dotenv parse.
process.env.VUE_APP_BUILD_TIME = new Date().toISOString();

module.exports = defineConfig({
  transpileDependencies: true,
  configureWebpack: {
    plugins: [
      new webpack.BannerPlugin({
        banner: `Current version: ${process.env.VUE_APP_VERSION}`,
        raw: true,
        entryOnly: true,
        include: /service-worker\.js$/,
      }),
    ],
  },
  pwa: {
    name: 'Meal Hat',
    themeColor: '#000000',
    msTileColor: '#ffffff',
    appleMobileWebAppCapable: 'yes',
    appleMobileWebAppStatusBarStyle: 'black',
    manifestOptions: {
      display: 'standalone',
      background_color: '#ffffff',
      icons: [
        {
          src: './img/icons/android-chrome-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: './img/icons/android-chrome-512x512.png',
          sizes: '512x512',
          type: 'image/png',
        },
      ],
    },
    workboxOptions: {
      // Three settings, all load-bearing after the 2026-08-19 reload loop.
      //
      // What happened: a new worker installs into the "waiting" state and does
      // not take over until every tab controlled by the old one closes.
      // registerServiceWorker's updated() answered that with location.reload(),
      // but reloading does NOT promote a waiting worker — so the page returned
      // on the old cached bundle, register-service-worker saw
      // registration.waiting still sitting there, fired updated() again, and
      // reloaded again. About three times a second, indefinitely.
      //
      // skipWaiting is what breaks that cycle: the worker activates on install
      // and never occupies the `waiting` slot the re-fire branch keys on.
      skipWaiting: true,
      clientsClaim: true,

      // Precache index.html and NOTHING else.
      //
      // Two jobs, and both matter.
      //
      // (a) It keeps the install payload tiny — see below.
      // (b) It is what makes service-worker.js CHANGE BETWEEN BUILDS. The
      //     manifest carries index.html's revision hash, and index.html changes
      //     every build because the bundle filenames do. Without a manifest the
      //     generated worker is pure static config and comes out BYTE-IDENTICAL
      //     every time — the browser compares bytes, finds no difference,
      //     reports no update, and the app never auto-reloads again. That is
      //     exactly what happened between 1.10.1 and 1.11.1, and it is silent:
      //     everything looks healthy, deploys just never arrive.
      //
      // The BannerPlugin in configureWebpack does NOT cover this: workbox
      // generates service-worker.js after webpack's banner stage, so the
      // "Current version" banner never reaches it. Verified on the deployed
      // file.
      //
      // This is the part that decides whether a stuck client can ever recover.
      //
      // The default manifest was 1.25MB across 8 entries (the vendor chunk and
      // its stylesheet), and installing that takes far longer than the ~300ms
      // the loop left between reloads — so the corrected worker was aborted
      // mid-install every time and could never take over. The 2KB throwaway
      // worker that eventually broke the loop won purely on install speed.
      //
      // An empty manifest makes install effectively instantaneous, so recovery
      // no longer depends on someone's connection or on catching them at the
      // right moment.
      exclude: [/^(?!index\.html$).*/],

      // Offline is served entirely by runtime caching instead: each response is
      // cached the first time it is used. Measured, after an earlier attempt
      // that precached only index.html turned out to precache nothing at all
      // and left navigateFallback pointing at an entry that never existed —
      // assets cached, HTML did not, so a cold offline start would have failed.
      //
      // Everything below except the navigation is hash-named, so a cache hit
      // can never be stale: a new build asks for a new filename.
      runtimeCaching: [
        {
          // The app shell. NetworkFirst, so an online visit always gets the
          // current HTML (and with it the current bundle names), while an
          // offline one falls back to the last copy that worked.
          urlPattern: ({ request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: { cacheName: 'meal-hat-pages', networkTimeoutSeconds: 4 },
        },
        {
          urlPattern: /\/(js|css)\/.*\.(js|css)$/,
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'meal-hat-assets' },
        },
        {
          urlPattern: /\/img\/.*\.(png|jpg|jpeg|svg|gif|webp)$/,
          handler: 'CacheFirst',
          options: {
            cacheName: 'meal-hat-images',
            expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
          },
        },
        {
          urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'meal-hat-fonts' },
        },
      ],
    },
  },
})