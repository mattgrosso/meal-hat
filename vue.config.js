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
      // Configure Workbox (used for service worker) here
    },
  },
})