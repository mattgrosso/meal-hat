# meal-hat

A Vue 3 PWA for meal planning and grocery shopping, built with Vite. Live at
https://mealhat.com. See [CLAUDE.md](./CLAUDE.md) for how it all fits together.

## Project setup
```
yarn install
```

### Compiles and hot-reloads for development
```
yarn serve
```
Vite dev server on port 8080, on every interface. No service worker is
generated here — use `yarn preview` to exercise that.

### Compiles and minifies for production
```
yarn build
```
Bumps the version in `.env` first (`VERSION_BUMP=patch|minor|major` to skip the
prompt), then `vite build` into `dist/`.

### Serves the production build locally
```
yarn preview
```

### Lints and fixes files
```
yarn lint
```
ESLint (vue3-essential + @vue/standard) over `src`, `tests` and the root config
files, then stylelint over the `.vue` blocks.

### Tests
```
yarn test:unit    # vitest
yarn test         # Playwright e2e — starts the Firebase emulators itself
```

### Customize configuration
`vite.config.mjs` (build, dev server, service worker) and
`postcss.config.cjs` (autoprefixer). See the [Vite config
reference](https://vitejs.dev/config/).
