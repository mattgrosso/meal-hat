const { defineConfig } = require('@vue/cli-service');
const webpack = require('webpack');

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
      // A new service worker installs into the "waiting" state and does not
      // take over until every tab controlled by the old one has closed. The
      // update handler in registerServiceWorker.js responded to that by calling
      // location.reload() — but reloading does NOT promote a waiting worker, so
      // the page came back on the OLD cached bundle, the update fired again, and
      // it reloaded again. Roughly three times a second, indefinitely.
      //
      // It only showed up when a deploy actually happened, which is why two
      // quiet months hid it.
      skipWaiting: true,
      clientsClaim: true,
    },
  },
})