// Vue CLI ran every stylesheet through autoprefixer against the `browserslist`
// block in package.json; Vite only does so when a PostCSS config is present,
// so this keeps the shipped CSS the same. It matters on iOS, where the phone
// is the only place Matt ever opens this app: `user-select`, `backdrop-filter`
// and friends still want their -webkit- twins in Safari, and those were only
// ever there because of this pass.
//
// `.cjs`, not `.js`, because this package has no "type": "module" — see
// vite.config.mjs's header for why it stays that way.
module.exports = {
  plugins: {
    autoprefixer: {},
  },
};
