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

### Drawing meals

`src/store/draw.js` picks weighted by how OVERDUE a meal is, not flat random.
The weight is `daysSinceLastDrawn / minDaysBetween`, capped at 3 — measured
against each meal's own cadence rather than in raw days, so a meal you
deliberately marked rare does not become likelier than a frequent one simply by
virtue of being rare. Never-drawn meals get the cap.

It is a nudge, not a rotation: on live data the most overdue meal was 3x as
likely as the most recent, and the least likely still held 8.5%. Keep it that
way — a strict "longest wait wins" makes the schedule deterministic, which is
the opposite of a hat.

### Editing an ingredient

The pencil beside a shopping-list item edits the GROCERY CATALOG entry, not the
row: name, default units, default aisle, default home location, staple, and the
staple interval. Meals reference a grocery by id and never by name, so a rename
propagates everywhere it is used — verified live, where renaming one entry
changed how it read on the shopping list while three meals kept referencing it.

A name that collides with another catalog entry warns rather than blocks. Two
entries sharing a name is legal and occasionally deliberate, and the repo
already has merge tooling (`analyzeIngredientDuplicates`, `findSimilarGroceries`)
for when it is not.

Note `ShoppingList.vue` imports Bootstrap's `Modal` for the quick-add dialog, so
the app's own modal component is aliased to `AppModal` there.

### Pantry staples

A grocery can be flagged `staple` in the catalog. Staples are kept out of the
main shopping list while you should still have them — but the requirement that
shaped the whole design was Matt's: *"in a way where I won't ever end up wishing
I had olive oil but not having it."*

So two rules, and neither is optional:

1. **Relocated, never removed.** `partitionStaples` only decides which SECTION a
   row renders in. The row stays in the stored list with its real quantity, and
   there is a test asserting every input row comes out somewhere. A bug here can
   misplace an item; it cannot lose one.
2. **It returns on its own.** `lastPurchased` is written to the catalog entry
   when an item is ticked off, and once that is `stapleIntervalDays` (default
   60) old the staple goes back on the main list, labelled with how long it has
   been. Never bought, unreadable date, or missing catalog entry all resolve to
   "on the list" — every uncertain case errs toward showing it.

The cupboard section also has a "Need it" button, which forces a staple onto the
list for this session without editing the grocery.

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

### Hat membership

Access to a hat is by **membership, not by knowing its name**. Before
2026-08-19 any signed-in user who guessed a hat name could read and write it,
and the names are guessable — emails with the punctuation swapped for hyphens.

Members are keyed by **`auth.uid`**, never by the email-derived database key:
rules can test `auth.uid` directly and cannot apply the app's punctuation
stripping to an email to rebuild a key.

Joining requires the hat's `joinCode`, which the Share button now puts in the
link. The code is checked SERVER-SIDE by the rules against
`root.child($hat).child('joinCode')`, so a client never needs to read it — and
cannot, until it is a member. Typing a bare hat name no longer joins anything.

`!data.exists()` on the `$hat` write rule is what still allows creating a new
hat, and it is also the app's only honest way to tell "this name is free" from
"this hat exists and you cannot see it": the write is refused in the second
case, which is when the UI tells the user to ask for a share link.

**Anything that creates a hat must write `members` and `joinCode` in the same
breath** — `initializeDB` and `createNewHat` both do. A hat with no members is
readable by nobody, so creating one without claiming it locks out its own owner
on the next load.

Each member record carries an `email` purely as a LABEL for the roster on the
Meal Hats screen — rules key on uid and never look at it. It is visible only to
people already in that hat.

**Nobody can remove themselves.** The guard is in `removeHatMember`, not just in
the template: a hat with no members is readable by nobody, so self-removal from
a hat you are alone in would destroy access permanently, recoverable only by a
CLI write. Because self-removal is impossible, the last member can never be
removed either.

`scripts/backfill-hat-membership.mjs` grandfathered every existing hat before
the rule was deployed; re-run it (dry by default) if membership ever needs
repairing.

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

### Auto-update must keep working

An open app is expected to pick up a deploy on its own, at a moment that does
not cost the user anything. Since 2026-08-22 that is Cinema Roll's mechanism,
ported wholesale — `src/utils/appUpdate.js` plus the wiring in `App.vue`.

**Detection does not go through the service worker.** `App.vue` fetches
`index.html?updateCheck=<ts>` with `cache: 'no-store'` and compares the hashed
`js/app.<hash>.js` filename it finds against the one this page actually loaded
off its own `<script>` tags. The SW `updated()` hook is a race the app usually
loses — `skipWaiting: true` means a new worker activates instead of sitting in
the `installed` state where the hook fires — so it is kept only as a SECONDARY
signal, setting the same `updateAvailable` flag. Both bundle helpers live in
`appUpdate.js` behind `ENTRY_BUNDLE_PATTERN`, so a change in Vue CLI's output
naming breaks `tests/unit/appUpdate.spec.js` instead of silently switching
auto-update off.

**Four triggers, because no single one is reliable.** visibilitychange,
pageshow, window focus, and a 30-minute interval. On an iOS home-screen PWA
visibilitychange sometimes just never fires, and `registered()` still polls
`registration.update()` every five minutes for the same reason.

**Applying it is guarded, and the guards are the point.** Reload immediately
only within 5s of opening or foregrounding (nothing is in flight yet);
otherwise poll every 5s for a 25-second stretch with no pointerdown, keydown,
wheel, touchstart or scroll. Either way `isSafeMomentForReload()` must agree:
never with a form control or contenteditable focused, never with a modal open
(`body.modal-open` for Bootstrap's, `.modal.show` for `Modal.vue`'s), never
with a Shepherd tour step in the document, and never while a screen has
registered a busy reason. `reloadForUpdate()` awaits `waitForNewWorker()` first
so the reload cannot land on a mixed old/new state.

**Busy reasons are for state only memory knows about.** `markBusy` in mounted,
`clearBusy` in beforeUnmount — a reason left behind by a destroyed component
blocks every future update, forever. `ShoppingList` registers while the user is
mid-edit, has the grocery edit form open (a working copy, unsaved until Save),
or has forced a staple onto the list (session-only by design). `DrawMeals`
registers for its whole lifetime: the picked date range is in memory, and a
reload between `applyDraw` and `generateShoppingListFromMeals` leaves a
schedule with no shopping list behind it.

**The loop guard is `shouldAutoAttempt`:** one attempt per detected bundle,
in sessionStorage. It replaced the old 30-second rate limit in
`registerServiceWorker.js` and is strictly stronger, because each deploy
carries its own key — a loop is impossible, and a genuine second deploy still
gets through.

**service-worker.js must still CHANGE between builds.** The browser compares
bytes. Precaching index.html is what supplies the variance, via its revision
hash — with an empty manifest the generated worker is pure static config and
comes out byte-identical every time. Silent: the app looks healthy and deploys
simply never arrive. Do not set `exclude` to everything. The BannerPlugin's
"Current version" does NOT reach this file — workbox generates it after
webpack's banner stage.

If a deploy is not reaching an open app, check in that order: is the bundle
comparison seeing a different filename, is something holding a busy reason,
is service-worker.js changing between builds.

### The 2026-08-19 reload loop

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
- **`updated()` no longer reloads at all** (2026-08-22). It sets the
  `updateAvailable` flag and App.vue decides, behind `shouldAutoAttempt` — one
  attempt per detected bundle, in sessionStorage. Belt and braces: if promotion
  ever fails again the cost is one wasted reload, not a loop.

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

### Magic Mirror feed

Matt's hallway Magic Mirror shows the next three meals. It has no keyboard and
no login, so it cannot authenticate — and it used to read
`mattgrosso-gmail-com.json` over unauthenticated REST, which is precisely what
the 2026-08-19 lockdown closed. The panel went blank and said nothing: the
mirror's fetch is inside a try/catch that leaves its list empty, and an empty
list renders as no panel.

So the app **publishes** rather than the mirror peeking. `buildMirrorFeed`
(`src/assets/javascript/mirrorFeed.js`) reduces the hat to dates and meal names
— nothing else — and it goes to `mirrorFeed/<hat>/<secret>`. The rules grant
public read at the **`$secret`** level only, so `mirrorFeed/<hat>.json` is
denied and a feed cannot be found without its 128-bit secret. The secret lives
at `<hat>/mirrorFeedKey`, readable only by members. Same arrangement as Cinema
Roll, which broke the same way five days earlier.

Three things that are deliberate:

- **The feed carries three weeks, not the three meals the mirror shows.** It is
  a snapshot of a moving schedule, refreshed only when someone draws or opens
  the app. Publishing three would empty the mirror three days after a draw even
  though the schedule runs another fortnight. The mirror re-filters by date, so
  a stale feed shows less rather than showing yesterday's dinner.
- **`publishMirrorFeed` re-reads the database** instead of using
  `state.drawnMeals`, which is a trailing window already filtered to upcoming
  entries and may not have echoed back a just-landed draw.
- **The six-hour throttle stamp is written BEFORE the publish, not after.**
  A hat whose publish keeps failing would otherwise retry on every snapshot
  callback for the rest of the session.

`node scripts/publish-mirror-feed.mjs --write` does the same job from the CLI
(dry by default), for bootstrapping the URL before anyone has pressed the button
and for repairing a stale feed. It prints the URL to paste into the mirror.

The mirror end is the `magic-mirror` repo: `src/mealHatFeed.js` holds the URL
and the date helpers, `src/App.vue`'s `getUpcomingMeals` reads the feed.

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

## Measure at phone width

This is a PWA used on a phone. A layout verified in a desktop browser window is
a layout no phone ever renders.

Learned the expensive way on 2026-08-19: the staple checkbox was added to the
shopping list, checked at 1559px where it looked fine, and shipped. On the
reporter's 402px iPhone that row was already using its full width — the extra
52px control overflowed it by 15px and squeezed the aisle input from 72px to
18px. Constrain to ~402px and measure `scrollWidth` against
`getBoundingClientRect().width` before shipping any row that gains a control.

## Guided tours

Each step attaches by `[data-step="N"]`. Nothing at runtime checks the anchor
exists — Shepherd just floats an unanchored step in the middle of the screen,
pointing at nothing, with no error. `tests/unit/tour-anchors.spec.js` pairs the
two halves and fails in both directions: a step pointing at a missing anchor,
and an anchor no step uses. It found ShowMeals had been skipping the Schedule
button entirely.

It cannot check the WORDS are still true. When a screen gains a feature, update
its tour copy by hand — the shopping list tour described `+`/`-` long after the
tick, staples and the cupboard existed.

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

**Responsive utility variants are NOT generated** (`responsive: false` applied
across `$utilities`). The templates use exactly one breakpoint class, `col-md-2`
in Header.vue, and that comes from the grid rather than the utilities API.

This has a silent failure mode — `d-md-none` added later will not error, it will
simply do nothing — so `tests/unit/no-responsive-utilities.spec.js` scans the
templates and fails with an explanation if one appears. Grid breakpoints
(`col-*`, `offset-*`, `row-cols-*`) stay allowed. To use a responsive utility,
either write a media query in the component's own `<style>`, or re-enable
responsive utilities and delete that test.

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
