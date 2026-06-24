# CLAUDE.md

Guidance for working in this repo.

## What it is

**Meal Hat** is a Vue 3 PWA for meal planning + grocery shopping. You fill a
"hat" with meals you like; the app randomly **draws** meals onto dates so you
never have to decide what's for dinner, and it builds a shopping list from the
drawn meals' ingredients.

**Live:** https://mealhat.com

## Stack

- **Vue 3** (Vue CLI 5), **Vuex** (single store), **Vue Router** in **hash mode**
  (`createWebHashHistory` — no server-side routing/SPA fallback needed)
- **Bootstrap 5** + bootstrap-icons, **Shepherd.js** for the guided tours
- **Firebase 9** — Google auth (`signInWithPopup`) + Realtime Database
- **Playwright** for tests (`tests/`, `playwright.config.js`)

## Commands

- `yarn serve` — dev server (hot reload)
- `yarn build` — production build into `dist/` (runs an interactive version bump first; see Deploy gotcha)
- `yarn lint` — eslint (vue3-essential + @vue/standard) + stylelint
- `yarn test` / `yarn test:headed` / `yarn test:report` — Playwright
- `yarn deploy` — build + ship to AWS (see Deploy)

## Architecture

Almost all logic lives in **`src/store/index.js`** (the Vuex store) and the
components under `src/components/`. Routes are in `src/router/index.js`; every
authed route repeats the same `beforeEnter` login guard (candidate for dedup).

### Firebase data model

Everything for a user is stored under a **"database top key"** — the user's
email with special chars replaced by `-` (e.g. `mattgrosso-gmail-com`). A user
can switch between "hats" (shared meal collections) via the MealHats screen,
which changes the top key.

The shopping data uses a **unified model** (the current source of truth):

- `groceryCatalog` — `id → { id, name, defaultUnits, defaultAisle, defaultLocation }`
- `shoppingList` — `id → { groceryId, quantity, units, aisle, location, source, mealId?, purchased }`
  where `source` is `'manual'` (added by the user) or `'meal'` (generated from drawn meals).

A **deprecated split model** (`groceryItems`, `nonMealShoppingList`,
`purchasedIngredients`, `nonMealGroceryItems`) still lingers and is read during
`initializeDB` for backward-compat / one-time migration (`migrateToUnifiedSystem`).
Prefer the unified model for new work; finishing the migration and removing the
deprecated paths is outstanding cleanup.

### Shopping-list write invariant (don't regress this)

Drawing meals regenerates the `source: 'meal'` items while **preserving manual
items and items added on other devices**. To make that safe:

- **`generateShoppingListFromMeals`** re-reads the authoritative `shopping-list`
  (and `drawnMeals`) from the database before computing, then persists via
  **`mergeDBValue`** (Firebase `update()` — surgical, key-scoped) rather than a
  full-node `set()`.
- **Never** write the whole `shopping-list` (or `grocery-catalog`) node from
  in-memory state with `updateDBValue`/`set()`. That overwrites the entire
  collection and clobbers concurrent edits. Use `mergeDBValue` for shared
  collections; use per-key `updateDBValue` (`path: shopping-list/<id>`) for
  single-item changes (as the manual add/edit paths do).

## Deploy (AWS S3 + CloudFront)

`yarn deploy` builds, then `aws s3 sync dist/ s3://meal-hat` and invalidates
CloudFront, all via the **`personal-deploy`** AWS profile. Infra (account
`298682183644`):

- S3 static-website bucket **`meal-hat`** (us-east-1)
- CloudFront distribution **`E1C9X1FV3WBDN6`**, custom domain `mealhat.com` + www
- Route 53 hosted zone `Z097753917S7LG3I2FEWJ`, ACM cert in us-east-1

**Gotcha:** `yarn build` runs `update-version` (`src/assets/javascript/version.js`),
which prompts for a semver bump via `process.stdin.setRawMode`. That throws in a
non-interactive/non-TTY shell. It works fine in a real terminal. To build from a
non-TTY context, run `npx vue-cli-service build` directly (skips the bump), then
sync + invalidate manually.

## Idea backlog

See `FeatureIdeas.md` and `todos.md` for the running wish list (grocery
autosuggest, deleting drawn meals, hat cleanup, styling).
