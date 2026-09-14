import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Vite replaced Vue CLI/webpack here on 2026-09-14, following the recipe the
// ten Around Table Round games and Cinema Roll used the same day (no-thanks
// e817419, cinemaroll ee3e00e), adapted to what this app actually relied on.
// The rules that shaped this file:
//
//  - No src/ logic was rewritten for the move. Every `process.env.VUE_APP_*`
//    read (the Google API key and client id, VUE_APP_VERSION, the build stamp's
//    VUE_APP_BUILD_TIME, the e2e suite's VUE_APP_FIREBASE_EMULATORS) and
//    `process.env.BASE_URL` is statically replaced via `define` below, exactly
//    as webpack's DefinePlugin did. Vite handles `process.env.NODE_ENV` itself
//    and turns any other `process.env.X` into `undefined`, which is what an
//    unset VUE_APP_ var was under Vue CLI too — `firebase.js`'s
//    `VUE_APP_FIREBASE_EMULATORS === '1'` depends on exactly that.
//
//  - `src/utils/appUpdate.js` notices a new deploy by reading the hashed entry
//    bundle's name off index.html, matching `ENTRY_BUNDLE_PATTERN`,
//    /js\/app\.[a-z0-9]+\.js/. The rollup output options below reproduce
//    webpack's `js/app.<hex>.js` naming exactly (Rollup's default hash
//    alphabet is base64, which would never match) — change them and
//    auto-update silently stops working. tests/unit/appUpdate.spec.js is the
//    tripwire.
//
//  - This file is `.mjs` rather than the recipe's `vite.config.js` +
//    `"type": "module"`, because `src/assets/javascript/version.js` (the
//    deploy-time version bump), `playwright.config.js` and `postcss.config.cjs`
//    are CommonJS and stay so.

// The build stamp (src/utils/buildStamp.js, "v1.21.9 · built Sep 14, 1:32 PM").
// This module is evaluated once per build/serve, so the ISO time below names
// the moment THIS bundle was built rather than the moment the page was loaded —
// which is the whole point: a tab left open for a week shows the build it is
// still running. The old vue.config.js set process.env.VUE_APP_BUILD_TIME at
// the same point in the lifecycle, for the same reason. It deliberately does
// not live in .env, which version.js rewrites from a dotenv parse.
const buildTime = new Date().toISOString();

// Vite copies public/ verbatim, .DS_Store files included, where Vue CLI's copy
// step skipped them (the last webpack dist/ has none). They would otherwise
// ride along to S3. Removed from dist before the service worker is generated —
// this plugin sits ahead of VitePWA and closeBundle hooks run in plugin order.
function dropDsStore () {
  const sweep = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) sweep(full);
      else if (entry.name === '.DS_Store') rmSync(full);
    }
  };
  let outDir;
  return {
    name: 'meal-hat:drop-ds-store',
    apply: 'build',
    configResolved (config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle: {
      sequential: true,
      handler () {
        try {
          sweep(outDir);
        } catch {
          // dist missing — nothing to sweep.
        }
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  // Same files, same precedence as Vue CLI: .env, .env.local, .env.[mode],
  // .env.[mode].local, plus any VUE_APP_* already on process.env (which is how
  // playwright.config.js passes VUE_APP_FIREBASE_EMULATORS=1 to `yarn serve`).
  // Only keys that are actually set get a define, so an unset one stays
  // `undefined` rather than becoming ''.
  const env = loadEnv(mode, process.cwd(), 'VUE_APP_');

  const define = {
    'process.env.VUE_APP_BUILD_TIME': JSON.stringify(buildTime),
    // Vue CLI's publicPath. registerServiceWorker.js and App.vue's update
    // check build URLs off it.
    'process.env.BASE_URL': JSON.stringify('/'),
  };
  for (const [key, value] of Object.entries(env)) {
    define[`process.env.${key}`] = JSON.stringify(value);
  }

  return {
    base: '/',
    define,
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    css: {
      preprocessorOptions: {
        // sass-loader 13 drove the `sass` package for us before (on its
        // default `legacy` API); Vite drives it directly. `modern` is the same
        // compilation with the same output, and it is what keeps the "legacy
        // JS API is deprecated" notice from printing once per stylesheet.
        // NOT `modern-compiler`: that path calls sass.initAsyncCompiler(),
        // which needs sass >= 1.70, and this repo is pinned at 1.63.4 by the
        // lockfile. The @import deprecation notices from
        // src/assets/scss/bootstrap.scss are Sass's own and unchanged.
        scss: { api: 'modern' },
      },
    },
    server: {
      // Vue CLI's dev server listened on 8080 on every interface (there was no
      // `devServer` block, so this was its default), and playwright.config.js
      // starts `yarn serve --port 8085` on top of it. Vite also restarts
      // itself when .env changes — the deploy-time version bump — so the old
      // `nodemon --watch .env` wrapper around `yarn serve` is gone.
      port: 8080,
      host: true,
      watch: {
        // VS Code Local History snapshots: never imported, and a lot of churn.
        ignored: ['**/.history/**'],
      },
    },
    build: {
      // Vue CLI shipped source maps for the JS bundles (productionSourceMap
      // defaults to true) and they went to S3 with everything else; keep that.
      // The service worker never precaches them — it precaches index.html and
      // nothing else, see below.
      sourcemap: true,
      // Everything non-lazy (vue, vuex, vue-router, firebase, bootstrap) lands
      // in the one entry chunk; Vue CLI split its node_modules half into
      // chunk-vendors, Vite doesn't by default. The total is what it was, so
      // raise the warning threshold rather than add a manual chunking rule.
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        // Naming the entry `app` (not Vite's default `index`) is what makes
        // the bundle come out as js/app.<hash>.js and the CSS as
        // css/app.<hash>.css — the webpack layout every deployed client and
        // appUpdate.js's ENTRY_BUNDLE_PATTERN already know.
        input: {
          app: fileURLToPath(new URL('./index.html', import.meta.url)),
        },
        output: {
          // Lowercase hex, like webpack's contenthash — see the header
          // comment. Requires Rollup >= 4.10 (Vite 5.4 bundles 4.2x).
          hashCharacters: 'hex',
          entryFileNames: 'js/[name].[hash].js',
          chunkFileNames: 'js/[name].[hash].js',
          // The same top-level folders the webpack build used: css/, fonts/,
          // img/ (src/assets/icon.png — public/img/icons/ is copied as-is and
          // untouched by this). The `meal-hat-assets` and `meal-hat-images`
          // runtime caches match on those two prefixes, so they are not
          // cosmetic.
          assetFileNames: (info) => {
            const name = info.name || '';
            if (/\.css$/i.test(name)) return 'css/[name].[hash][extname]';
            if (/\.(woff2?|ttf|eot|otf)$/i.test(name)) return 'fonts/[name].[hash][extname]';
            if (/\.(png|jpe?g|gif|svg|webp|avif)$/i.test(name)) return 'img/[name].[hash][extname]';
            return 'assets/[name].[hash][extname]';
          },
        },
      },
    },
    plugins: [
      vue(),
      dropDsStore(),
      // The service worker, one option for one with what @vue/cli-plugin-pwa
      // (workbox GenerateSW) built from the old vue.config.js. Verified
      // against the last webpack-built dist/service-worker.js.
      //
      //  - `filename: 'service-worker.js'` (not the plugin's default sw.js) is
      //    what src/registerServiceWorker.js registers and what every
      //    already-installed client is checking for updates at. A renamed
      //    worker would leave them controlled by the old one forever.
      //  - `manifest: false` + `injectRegister: false`: the manifest is the
      //    static public/manifest.json, the meta/link tags are hand-written in
      //    index.html, registration is register-service-worker in
      //    src/registerServiceWorker.js (production only). Nothing injected.
      //  - No worker on `yarn serve` (devOptions.enabled stays false), same as
      //    before, so the dev server's module requests are never served by a
      //    stale cache.
      VitePWA({
        strategies: 'generateSW',
        filename: 'service-worker.js',
        // autoUpdate = skipWaiting + clientsClaim; both are also set
        // explicitly below so the intent survives if this is ever touched.
        registerType: 'autoUpdate',
        injectRegister: false,
        manifest: false,
        workbox: {
          // PRECACHE index.html AND NOTHING ELSE. This is the single most
          // load-bearing line in the file, and it has two jobs:
          //
          // (a) It keeps the install payload tiny. The default manifest was
          //     1.25MB across 8 entries, and installing that takes far longer
          //     than the ~300ms the 2026-08-19 reload loop left between
          //     reloads — so the corrected worker was aborted mid-install
          //     every time and could never take over. A one-entry manifest
          //     makes install effectively instantaneous, so recovery never
          //     depends on someone's connection.
          //
          // (b) It is what makes service-worker.js CHANGE BETWEEN BUILDS. The
          //     manifest carries index.html's revision hash, and index.html
          //     changes every build because the bundle filename does. With an
          //     EMPTY manifest the generated worker is pure static config and
          //     comes out BYTE-IDENTICAL every time — the browser compares
          //     bytes, finds no difference, reports no update, and the app
          //     never auto-reloads again. That is exactly what happened
          //     between 1.10.1 and 1.11.1, and it is silent: everything looks
          //     healthy, deploys just never arrive.
          //
          // The old spelling was workbox's inverse, `exclude: [/^(?!index\.html$).*/]`.
          // `globPatterns` is the workbox-build equivalent and yields the same
          // one-entry manifest. If you change it, check the built worker's
          // precacheAndRoute() call: it must list exactly one URL,
          // /index.html, WITH a non-null revision.
          globPatterns: ['index.html'],
          // webpack wrote every precache URL root-absolute ("/index.html");
          // workbox-build's glob yields "index.html". They resolve to the same
          // thing under a root-scoped worker, but this keeps the manifest
          // byte-for-byte the shape it has always had.
          modifyURLPrefix: { '': '/' },
          // Cache-name prefix, as before (the old plugin used the package
          // name). Same prefix + workbox's unchanged "precache-v2" suffix
          // means the new worker updates the existing precache in place
          // instead of orphaning it.
          cacheId: 'meal-hat',
          // Load-bearing after the 2026-08-19 reload loop. A new worker
          // installs into the "waiting" state and does not take over until
          // every tab controlled by the old one closes; registerServiceWorker's
          // updated() used to answer that with location.reload(), but
          // reloading does NOT promote a waiting worker — so the page returned
          // on the old cached bundle, register-service-worker saw
          // registration.waiting still sitting there, fired updated() again,
          // and reloaded again, about three times a second, indefinitely.
          // skipWaiting breaks that cycle: the worker activates on install and
          // never occupies the `waiting` slot the re-fire branch keys on.
          skipWaiting: true,
          clientsClaim: true,
          // The old worker never called cleanupOutdatedCaches(); the plugin
          // defaults it on. Off, to match.
          cleanupOutdatedCaches: false,
          // The plugin's default is a precached-index.html NavigationRoute,
          // which would shadow the NetworkFirst navigate handler below. The
          // old worker registered no navigation route at all. Off.
          navigateFallback: null,
          sourcemap: true,
          // Offline is served entirely by runtime caching instead of by the
          // precache: each response is cached the first time it is used.
          // Everything below except the navigation is hash-named, so a cache
          // hit can never be stale — a new build asks for a new filename.
          // All four routes, in the order the old worker registered them.
          runtimeCaching: [
            {
              // The app shell. NetworkFirst, so an online visit always gets
              // the current HTML (and with it the current bundle name, which
              // is what App.vue's update check compares), while an offline one
              // falls back to the last copy that worked.
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
      }),
    ],
  };
});
