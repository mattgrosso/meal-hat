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

### Checking items off

The tick on a shopping-list row sets `purchased: true`; it does **not** delete
the row. Deleting was the old behaviour and it did not survive: the meal half of
the list is rebuilt from the upcoming schedule on every regeneration, with a new
uuid per row, so a deletion was simply never an input to that calculation and
anything bought for a still-upcoming meal came back. Manual items stayed gone,
so the same gesture quietly meant two different things.

`src/store/purchases.js` (`withPreservedPurchases`) re-applies the flag to the
rebuilt rows. It matches on **`groceryId`, not row id** — the id is regenerated
every time — and reopens an item when the newly required quantity exceeds what
was bought, so a redraw that needs more chicken does not leave you short.

Purchased meal rows clean themselves up: once their meal is in the past,
`aggregateMealIngredients` stops deriving them and the row goes.

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

### Security rules

Rules live in **`database.rules.json`** (wired up by `firebase.json`) and deploy
with `firebase deploy --only database`. Before 2026-08-19 they existed only in
the Firebase console and left the database open — an unauthenticated
`GET /.json?shallow=true` returned every top-level key, and those keys are email
addresses.

Now: root read and write denied; each `$hat` readable and writable by any signed
-in user. That is the sharing model the app has always had (know a hat's name,
join it). It is **not** a membership model — closing that needs a per-hat member
list, which is a product change.

Two consequences to respect:

- **Never read the database root.** `initializeDB` used to subscribe to it just
  to build a list of hat names, which handed every client every other account's
  data. Use a targeted read (see the `hatExists` action).
  `tests/unit/no-root-database-reads.spec.js` fences this.
- **Auth must be live, not just remembered.** The router's `loggedIn()` decides
  from localStorage, which tells Firebase nothing. `getAuth()` therefore runs at
  module scope in the store and `initializeDB` awaits the restored session
  before reading — otherwise the database client sends requests with no token
  and every read silently returns nothing.

### Service worker (read before deploying)

On 2026-08-19 a deploy put the live app into a reload loop, ~3 page loads per
second, indefinitely. A new worker installs into the **waiting** state;
`updated()` answered that with `location.reload()`, but reloading does not
promote a waiting worker, so the page returned on the old cached bundle,
`register-service-worker` saw `registration.waiting` still there, fired
`updated()` again, and reloaded again.

Three things keep it dead, all load-bearing:

- **`skipWaiting` + `clientsClaim`** — the worker activates on install and never
  occupies the `waiting` slot the re-fire branch keys on. Verified by
  measurement: a fresh registration reports `everSatInWaiting: false` and
  reaches `activated` in under a millisecond.
- **`exclude: [/.*/]` — precache nothing.** This is what makes a *stuck* client
  recoverable. The default manifest was 1.25MB, which cannot finish installing
  inside the ~300ms the loop left between reloads, so the corrected worker was
  aborted mid-install every time. Zero install payload wins that race on any
  connection. Do not reintroduce precaching without re-checking this.
- **`updated()` reloads at most once per tab** (sessionStorage). Belt and
  braces: if promotion ever fails again the cost is one wasted reload, not a
  loop.

Offline comes from **runtime caching**, not precaching: `meal-hat-pages`
(NetworkFirst, the app shell), `meal-hat-assets`, `meal-hat-images`,
`meal-hat-fonts`. An earlier attempt precached only `index.html` and turned out
to precache nothing at all, leaving `navigateFallback` bound to an entry that
never existed — assets cached, HTML did not, and a cold offline start would have
failed. If you change caching, verify `caches.match('/')` actually hits.

`kill-service-worker.js` is kept as the remedy if a bad worker ever ships again:
upload it over `s3://meal-hat/service-worker.js`, let clients shed the bad
worker, then `yarn deploy` to restore the real one. It is NOT currently
deployed.

## Bug reports

In-app reports go to a top-level `bugReports/` node, outside any hat, and the
rule makes it **write-only** — see the note in `database.rules.json` for why
that block is load-bearing against the `$hat` wildcard.

Triage reads through the **Firebase CLI**, not the Admin SDK: the CLI's own
project-owner login bypasses security rules, so there is no service-account key
to generate or keep out of git. The tradeoff is that both scripts need
`firebase login` to still be valid; they say so plainly if it is not.

`src/utils/bugReports.js` stashes to localStorage when a write fails and drains
on the next submit and on app launch. That matters here more than it looks —
this is a PWA used in a grocery store, which is exactly where signal dies.

## Styling

Bootstrap is imported as **hand-picked Sass partials** from
`src/assets/scss/bootstrap.scss`, not as the full `bootstrap.min.css`. The file
lists which components are in and why. **Add a Bootstrap component to a template
and you must add its partial there**, or it renders unstyled.

The configuration block at the top (`functions`, `variables`, `variables-dark`,
`maps`, `mixins`, `utilities`) is Bootstrap 5.3's own required order and is not
negotiable — omitting `maps` fails the build with a bare "Undefined variable"
pointing at `_root.scss` rather than at the missing import. `utilities/api` must
come last; it is what emits the utility classes.

Responsive utility variants ARE still generated. See `BACKLOG.md` for the
measured option to drop them and why it was not taken.

## Toolchain

**Node is pinned to 22.22.3** (`.tool-versions`), raised from 18.4.0 on
2026-08-19. The old pin could not install at all: `stylelint-scss` and
`stylelint-config-sass-guidelines` require `>=18.12.0`, so `yarn install` failed
with "incompatible module". It stayed invisible because the committed
`node_modules` kept working.

**`.yarnrc` sets `--ignore-engines`.** `@achrinza/node-ipc`, a transitive
dependency of `@vue/cli-service`'s dev server, declares `engines.node` as an
enumeration ending at 19 and is unmaintained; it runs fine on 22. Nothing else
in the tree has an upper bound. The flag is blunt — it silences engine checks
for every package — so delete it the day the Vue CLI dev server goes away, and
re-run a clean install to see what it was covering. Same call, same caveat, as
the Cinema Roll repo.

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

## Dates

Calendar dates are ISO `YYYY-MM-DD`, handled by **`src/store/schedule.js`**.
Use it rather than hand-rolling — `new Date('2026-08-19')` parses as UTC
midnight, which is the previous day anywhere west of Greenwich, and that had
already produced four separate off-by-one bugs. `toISODate` stays tolerant of
the older stored shapes (`toDateString()` strings, epoch numbers) indefinitely.

Pass **Date objects** to `VDatePicker`, not ISO strings — v-calendar makes the
same UTC-midnight mistake and will highlight the wrong day.

### drawnMeals is windowed, not whole

`initializeDB` subscribes to a trailing window (`DRAWN_MEALS_WINDOW_DAYS`, 400)
via `orderByChild('assignedDate')`, not to the entire node. It used to load
everything ever drawn — 461 rows at migration time, growing with the calendar
rather than with use — to render a 7-day schedule and some calendar marks.

Two things make that safe, and both matter:

- **`.indexOn: "assignedDate"`** in `database.rules.json`. Without it Firebase
  still answers the query, by downloading the whole node and filtering on the
  client — the exact cost the query exists to avoid — and only warns. Its
  absence is invisible in behaviour and expensive in practice.
- **The `migrateDrawnMealDates` action**, gated on a per-hat marker at
  `<hat>/schema/drawnMealsDateFormat`. The query orders by the stored string, so
  it cannot be trusted until every `assignedDate` in that hat is ISO. An
  unmigrated hat is read in full (as before), repaired in one atomic write, and
  marked; thereafter it is queried. That gating is why the migration and the
  query could ship together instead of waiting for every device to visit.

If you widen the window or add another query, check the index covers it.

## Idea backlog

See `BACKLOG.md`. (It replaced `FeatureIdeas.md` and `todos.md`, which had
drifted — most of what was in them had already been built.)
