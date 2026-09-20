# CLAUDE.md

Guidance for working in this repo.

## What it is

**Meal Hat** is a Vue 3 PWA for meal planning + grocery shopping. You fill a
"hat" with meals you like; the app randomly **draws** meals onto dates so you
never have to decide what's for dinner, and it builds a shopping list from the
drawn meals' ingredients.

**Live:** https://mealhat.com

## Stack

- **Vue 3** built by **Vite 5** (`vite.config.mjs`), **Vuex** (single store),
  **Vue Router** in **hash mode** (`createWebHashHistory` — no server-side
  routing/SPA fallback needed)
- **Bootstrap 5** + bootstrap-icons, **Shepherd.js** for the guided tours
- **Firebase 9** — Google auth (`signInWithPopup`) + Realtime Database
- **Playwright** for tests (`tests/`, `playwright.config.js`)

## Commands

- `yarn serve` — Vite dev server (hot reload) on **port 8080**, on every interface
- `yarn build` — production build into `dist/` (runs an interactive version bump first; see Deploy gotcha)
- `yarn preview` — serve the built `dist/` (port 4173), which is the only way to
  exercise the service worker locally: it is never generated on `yarn serve`
- `yarn lint` — eslint (vue3-essential + @vue/standard) + stylelint
- `yarn test` / `yarn test:headed` / `yarn test:report` — Playwright

## The build is Vite, not Vue CLI

Since 2026-09-14 (the twelfth app of Matt's to move; the recipe is no-thanks
`e817419`, and Cinema Roll `ee3e00e` is the closest analogue). Nothing in `src/`
changed its behaviour: every `process.env.VUE_APP_*` and `process.env.BASE_URL`
read is statically replaced by Vite's `define`, exactly as webpack's
DefinePlugin did, so `.env` keeps the same variable names and `buildStamp.js` /
`firebase.js` / `bugReports.js` are untouched. `vite.config.mjs` carries the
reasoning for each option — read it before changing any of them. The three
that are load-bearing:

- **Output must stay `js/app.<hex>.js` and `css/app.<hash>.css`.** That is what
  `rollupOptions.output` (entry named `app`, `hashCharacters: 'hex'`) exists
  for. `appUpdate.js`'s `ENTRY_BUNDLE_PATTERN` reads the bundle name off
  index.html, and Rollup's default base64 hash alphabet would never match it.
- **The service worker must stay `service-worker.js` and precache exactly
  index.html** — see the auto-update section below.
- **`postcss.config.cjs` must exist.** Vue CLI ran autoprefixer over every
  stylesheet against the `browserslist` block in package.json; Vite only does
  when a PostCSS config is present. Without it iOS loses its `-webkit-` twins.

`index.html` lives at the repo ROOT now (Vite's entry), not in `public/`, and
it hand-writes the manifest/apple/favicon tags `@vue/cli-plugin-pwa` used to
inject. `public/manifest.json` is that plugin's generated file, committed
byte-for-byte. Two webpack-only spellings in `src/` had to go: the `require()`
calls for `uuid` (ShoppingList) and for the header icon (Header.vue) are now
imports. The `/* webpackChunkName */` hints are inert — Rollup names lazy
chunks after their module, so `js/Home.<hash>.js` rather than
`js/home.<hash>.js`. Nothing reads those names.

## The E2E suite runs against the Firebase EMULATORS

Since 2026-08-27. `playwright.config.js` starts the Auth + Database emulators
(the database one runs on brew's keg-only openjdk — `/usr/bin/java` is only
Apple's "install a runtime" stub) and a dev server on **port 8085** with
`VUE_APP_FIREBASE_EMULATORS=1`, which is what makes `src/store/index.js`
point the SDK at localhost. The flag is compile-time, so production builds
contain no emulator path at all.

Why: the suite used to fake a session with two localStorage keys. When the
membership lockdown made `initializeDB` require a real Firebase user, every
test landed on the Login screen — and for as long as the fake HAD worked, the
tests were writing meals into the **production** database. Now
`tests/e2e/test-utils.js` signs a real tester into the auth emulator over
REST and seeds the browser's IndexedDB with the same session record the SDK
writes (`emulatorSignIn` / `seedFirebaseSession`). If a Firebase SDK upgrade
ever turns the whole suite red at the login screen, that seeding record's
shape is the first suspect.

Port 8085 on purpose: Matt keeps another app's dev server running on 8080,
and with `reuseExistingServer` the suite would silently test whatever app
answered there.

**Fixing the suite exposed a real production bug**: a brand-new user's hat
was never created. `initializeDB` read the hat and created it only if the
read came back empty — but reading a hat you're not a member of is DENIED,
and a hat that doesn't exist has no members, so a new user's read always
threw and the create was unreachable. Invisible until now because every
existing hat was backfilled with members before the rules shipped. The fix
probes with the WRITE (allowed when `!data.exists()`, refused when the hat
exists and you're not a member — which is exactly the invite-link case).
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

A **deprecated split model** still lingers in the database
(`grocery-items`, `non-meal-grocery-items`) but is **dead data**: nothing reads
it. `migrateToUnifiedSystem` no longer exists in the store, so those nodes are
neither read at startup nor kept in step with the catalog. They hold stale
copies of records the catalog has since renamed or merged. Do not update them
alongside a catalog change — rewriting dead data only makes it look live. They
are safe to delete whenever someone wants to.

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
`appUpdate.js` behind `ENTRY_BUNDLE_PATTERN`, so a change in the build's output
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
simply never arrive. The one-entry manifest is now
`workbox.globPatterns: ['index.html']` in `vite.config.mjs` (it was workbox's
inverse, `exclude: [/^(?!index\.html$).*/]`, under Vue CLI); do not widen it and
do not empty it. After any build, check the worker: `precacheAndRoute()` must
list exactly one URL, `/index.html`, **with** a non-null revision.

The worker's filename is also load-bearing: `service-worker.js`, never the
vite-plugin-pwa default `sw.js`. It is what `registerServiceWorker.js`
registers and what every installed phone is checking for updates at; a rename
leaves them controlled by the old worker forever. So is `cacheId: 'meal-hat'` —
same prefix means the new worker updates the existing precache in place.

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

## The fridge (merged in from Perishable, 2026-08-29)

Countdown timers for things that go off, on a `/fridge` route. Two surfaces:
the **kitchen wall tablet** (a Galaxy in Fully Kiosk, glanced at from across
the room) and the **phone** (a capture surface — camera first). Split by
viewport width in `utils/fridge/viewMode.js`; `?view=wall` pins it.

**Do NOT change the wall display's look without asking.** Matt likes it as it
is. That constraint survived the merge intact and is the reason for most of
the styling care below.

### The wall tablet cannot log in, and cannot read the catalog

Both facts drive the whole design.

Google's popup refuses to run in a kiosk WebView, and a session that lapses on
a wall display fails silently — a blank kitchen screen nobody notices for a
week. So the fridge authorizes by **capability key in the path**:
`fridge/<32-char-secret>`. Knowing the key IS the authorization, because RTDB
rules have nowhere to receive a credential as a parameter. `auth != null` rides
alongside, satisfied by a silent **anonymous** session (`ensureSession()` in
`src/firebase.js`) — the one kind a kiosk can get, with no popup and nothing to
lapse. The anonymous session grants nothing on its own; the key is still what
picks the fridge.

`/fridge` is therefore the only route besides `/login` with
`requiresLogin: false`. That is not a hole: without a valid key it renders its
own loud NOT-CONNECTED screen and reads nothing.

**THE KEY MUST STAY IN THE URL.** Perishable stripped it after storing it, for
tidiness, and on 2026-08-26 both devices lost their storage and neither could
get back in. `adoptFridgeKey` leaves it in the address bar and puts it BACK
when a load arrives without it — and, because this app routes on the hash, it
must preserve `location.hash` too. The kiosk URL is `/?k=<key>#/fridge`;
rebuilding it as `pathname?query` drops `#/fridge` and lands the tablet on Home.

The tablet is a member of no hat, so it can **never** read
`<hat>/grocery-catalog`. Hence `fridge/<key>/templates`: a projection of the
catalog's shelf lives, published by the signed-in app — the same arrangement as
the Magic Mirror feed, for the same reason.

### A wrong key must be loud, and the wall pairs by code

Two rules, both learned on 2026-09-11 when Matt typed the kiosk URL into the
tablet by hand and got one character wrong.

**A well-formed key that names no fridge is an error, not an empty fridge.**
The rules grant any 32+ character key a read of its own node, so a typo
subscribes successfully to nothing and the wall shows an empty fridge with no
hint why. `fridge/subscribe` now takes `{ key, verify }`; a key that arrived by
URL or storage is verified (templates or timers must exist — every real fridge
has templates) and reported as `unknown`, which the screen says out loud. The
hat's own pointer is never verified: it came from the database, not a keyboard.

**Nobody types the key on the tablet.** The not-connected screen shows a
six-digit code and listens at `pairings/<code>`; the phone's "Pair a wall
display" writes `{ key, createdAt }` there; the tablet adopts the key, deletes
the pairing, and reloads with `?k=` in its URL as before (`urlWithKey` keeps
the `view=wall` pin and the `#/fridge` hash). Rules: an anonymous session may
read a pairing and may only write null; creating one needs a real account.
`src/utils/fridge/pairing.js`. From the CLI, the phone's half is
`firebase database:set /pairings/<code> '{"key":"<key>","createdAt":<ms>}'`.

**Fully Kiosk's start URL still has to be right.** A pairing fixes THIS load;
the next kiosk restart reloads the start URL, and a valid-looking key in the
URL wins over the stored one. If the wall keeps asking to pair after restarts,
fix the one character in Fully's settings.

### Two copies of a shelf life, and how they stay honest

The catalog is authoritative. Templates are the wall-readable cache. But the
wall also WRITES — a scan teaches a shelf life — so it is a two-way sync, and
`src/store/fridge/reconcile.js` is the merge.

A two-way sync needs a base to tell "they changed it" from "we changed it".
That is **`shelfLifeSyncedDays`** on the catalog entry: the value both sides
last agreed on. Each side's edit is then attributable alone, and only a genuine
simultaneous edit is a conflict. When both moved, **the fridge wins** — someone
stood in the kitchen and confirmed a real date — and it is logged rather than
swallowed.

`reconcileCatalog` runs only for a signed-in client, and only once BOTH
subscriptions have landed. Either can arrive second, and reconciling against a
half-loaded catalog reads every food as new.

### The food record

One record. `shelfLifeDays` sits beside `defaultUnits`, `defaultAisle`,
`staple` and the rest. **`fridgeOnly: true`** marks a food that lives in the
fridge but is never shopped for — `Leftover pizza`, `Leftover chinese`.

That flag is inferred ONLY from a "leftover" prefix. The tempting rule — "any
template with no catalog entry is fridge-only" — would have hidden Grapes,
Potatoes, Watermelon, English muffins and nine other ordinary groceries.
Wrongly hiding something from the shopping list is the expensive direction,
which is the same reasoning that makes every uncertain staple resolve to "on
the list".

### Styling is scoped, and must stay that way

Perishable owned its whole page and styled `body` and `*` from an unscoped
sheet. Here the body-level rules hang off a **`fridge-active`** class that
`Fridge.vue`'s mounted/beforeUnmount add and remove, and everything else nests
under `.fridge-app`. It all rides in the lazy-loaded fridge chunk, so no other
screen pays for it. Break the scoping and every meal-hat screen turns black and
starts fighting Bootstrap's reboot.

### Putting a meal on the schedule by hand

Bug report (2026-08-31, Carrie): *"I'd like to be able to manually enter a
meal."* The schedule could reorder and delete; the only way to get anything
ONTO it was the draw — so there was no way to say "chili on Thursday", and no
way to record a night the hat has no opinion about.

`scheduleMeal` writes one of two shapes, in the same atomic `update()` as
`applyDraw`:

- **a meal from the hat** — `{ mealId }`, and the meal's `drawnDates` gains the
  date exactly as a draw would, so `mealWeight` keeps counting it. A meal you
  placed and ate yesterday must not come straight back up.
- **a one-off** — `{ name, manual: true }` and NO `mealId`. Nothing is added to
  the hat: "we're getting pizza" is not a meal you want drawn later. It brings
  no ingredients, and `aggregateMealIngredients` already skips a drawn row
  whose meal it cannot resolve, so the shopping list is untouched.

**Both readers of a drawn row must fall back to its own `name`.** The schedule's
`drawnMeals` computed and `buildMirrorFeed` each drop a row they cannot resolve
to a hat meal — correct for a meal deleted out of the hat, catastrophic for a
one-off, which would simply never appear. Anything new that joins `mealId` to a
meal needs the same fallback.

### Checking a meal off

"Made it" on a schedule row opens a sheet, and the sheet is the point: cooking a
meal can CLEAR timers, and clearing is the one thing this app will not do
quietly. The plan shown is literally the plan applied (`planMealConsumption` is
pure and returns it), so what you agreed to and what happens cannot drift.

**`packageSize` is the bridge, and it exists because the units do not line up.**
A meal ingredient is `{ groceryItemId, quantity }` with no unit of its own, and
across real meals those quantities are not one kind of thing:

    1  Ziti          (Pound)  package count
    2  Mozzarella    (cups)   recipe measure
    13 Ricotta       (Oz)     recipe measure
    28 Tomato Sauce  (can)    28 OUNCES, mislabelled as cans
    24 Cottage cheese ()      no unit at all

So a timer cannot just hold "quantity" and have meals subtract from it — buying
one can of tomato sauce and subtracting 28 would clear a can that was exactly
right. `packageSize` says how much of a food comes in one package, in whatever
unit that food's recipes already use (Tomato Sauce 28, Mozzarella 2, Ricotta
15, a Box of orzo 1). Timers then hold PACKAGES, and every comparison happens
inside one food's own unit. No meal had to be re-recorded.

Unknown `packageSize` assumes one whole package and **says so in the sheet**. A
guess that clears a timer has to be visible before it happens.

Two rules carried over from the scan flow: a food with no timer is reported and
never acted on (no record ≠ you are out of it), and wanting more than the fridge
holds clamps at zero and reports the shortfall rather than going negative.

Confirming also writes `lastCooked`, which `mealWeight` prefers over the drawn
date. Being drawn is a plan; being cooked is what happened. A meal drawn and
then skipped used to count as recent anyway, so the meals most often skipped
were the ones the hat kept skipping. Meals with no `lastCooked` fall back to the
drawn dates and behave exactly as before.

### Names are the join, and they were broken

`planMealConsumption` matches a timer to a catalog entry by **exact name**
(lowercased and trimmed, nothing fuzzier). `reconcileShelfLives` uses the same
equality to decide whether a template names a food the catalog already knows.
So a food spelled two ways is not a cosmetic problem — it is a silently
severed join, and both sides fail quietly.

It happened twice, in mirror-image forms, and both were repaired on 2026-08-30:

- **A template naming nothing.** `migrate-fridge.mjs` used its `RESOLVED` map
  to push each template's shelf life onto the right catalog entry but never
  renamed the template, so the fridge said `Mozzarella Cheese` where the catalog
  said `Mozzarella`. Twelve of them. Only 15 of the 53 groceries the meals use
  could be matched to a timer at all, and the next signed-in visit to `/fridge`
  would have invented twelve duplicate catalog foods.
  `scripts/align-fridge-names.mjs`.
- **Two catalog entries for one food.** `Parmesean` (5 meals) beside
  `Parmesan Cheese` (1 meal), and `Sliced Cheese` beside a
  `fridge-american-cheese-slices` that the migration invented and no meal used.
  `scripts/merge-duplicate-groceries.mjs`.

If a timer looks right on the wall but "Made it" declines to touch it, this is
the first thing to check — compare the timer's title against the catalog name,
not against what the food is called out loud.

### Every grocery needs a packageSize

`consume.js` explains the mechanism; what the comment cannot say is that for a
long time **no entry had one** — 0 of 112 — so every meal assumed one whole
package and a recipe calling for `1 Bottle` of olive oil cleared the olive oil
timer. Filled in on 2026-08-30 from Matt's numbers
(`scripts/set-package-sizes.mjs`, which records the arithmetic per row).

He gives these as **uses per purchase**, which is the natural way to think about
it and is NOT what the field holds. `packageSize` is in the recipe's own unit:

    packageSize = uses per purchase x what one recipe asks for

Olive oil is 25 either way, because the recipe asks for 1 Bottle. Basil is not:
30 uses of 2 tbsp is a 60 tbsp jar. Ask for uses, then convert, and show the
conversion — a wrong number should be visibly wrong.

Err large. Too big means a timer survives a meal that should have cleared it,
which costs a glance; too small deletes a timer on food that is still there.

**A new grocery ships with no packageSize**, so anything added since needs one
before it consumes correctly. There is no UI for the field yet.

### Starting the fridge over

`scripts/reset-fridge.mjs` clears every timer so the house can be
re-photographed from scratch. **Timers only** — templates and the catalog's
shelf lives are the accumulated knowledge, and they are what makes the re-scan
fast: a template match arrives with its duration filled in, so re-photographing
is a few taps rather than forty manual answers.

All four scripts here are dry by default, take `--apply`, and write a
timestamped backup into `backups/` (gitignored) BEFORE they delete anything.
`reset-fridge` prints the `firebase database:set` line that puts it all back.

### Saying what's in the house, instead of photographing it

Matt, 2026-09-20: *"What we built for that previously was a thing where I take
a photo and then you interpret the photo. I don't really trust that."* So the
way food gets into the fridge is now a **talk-through**: he opens the fridge,
the freezer and the cupboards and says what he sees, into a text box, and the
whole dump is read at once.

`TalkFlow.vue` → `store/fridge/talkReview.js` (pure) → `fridge/applyTalk`.

**It is typing, not recording, and that was the call.** The obvious build is a
record button and a transcription service. The mic on the iOS keyboard is
Apple's own dictation: more accurate on food names than anything we would send
audio to, free per use, and no new infrastructure. The cost is that iOS stops
dictating after a pause, so a long ramble means tapping the mic again — which
is why the box is a real editable textarea and why **the draft is saved on
every keystroke** (`utils/fridge/talkDraft.js`). Losing four minutes of talking
to a backgrounded tab would end the feature.

**The absence rule INVERTS here, and only here.** Everywhere else in this app a
thing missing from a photo is a suggestion, and those rows arrive unchecked,
because a camera cannot see behind the milk. A spoken inventory is a deliberate
enumeration by the one person who can open the drawer, so Matt's call was:
*"We should assume that if I don't list it, then it isn't there."* Unmentioned
timers arrive **checked for removal**. They are all still shown, with how long
is left and how recently they were added, and it is one confirm — the plan
shown is the plan applied — but the default is flipped on purpose.

**"We're out of milk" must never become a milk timer.** A stream-of-
consciousness dump is full of absences and self-corrections ("there's milk — no
wait, that's gone"). The schema has a separate `outOf` array, the prompt says
in as many words that getting this backwards is the one unacceptable error, and
`buildTalkReview` lets `outOf` beat a passing mention of the same food. Tested
both directions.

**A match does NOT restart the timer.** Seeing food again says nothing about how
fresh it is; restarting on every talk-through would keep a dying carton of milk
alive forever.

**A new food arrives with the estimate filled in** rather than stopping for
input, which is a deliberate departure from the scan flow's "every new food
stops for your input". That rule was written where a printed date and a guess
were both on offer and choosing silently would have hidden the difference. Here
there is only ever an estimate, and forty of them in one sitting is data entry,
not review. The number is shown, labelled `estimate`, and editable on the row.

**The condition he describes is the most valuable thing in the transcript and
no photo could ever provide it.** "The lettuce is starting to go" comes back as
2 days, not 10. The prompt asks for it explicitly.

### Pantry stores are tracked, and kept off the wall

*"We don't need to list that I have a can of beans that's gonna last for years
— it should just list the things that actually are going to go bad."*

A talk-through picks up the whole kitchen, and all of it matters to the
shopping list: saying "we've got rice" is exactly the kind of thing that should
stop rice being bought. But a wall display glanced at from across the room
stops working the moment it is ninety rows of flour and tinned tomatoes.

So a timer can carry **`shelfStable: true`**, and the screens read
`fridge/displayTimers` (which filters it out) while everything that decides
what to buy — `onHandUntil`, the coverage math, cooking a meal — keeps reading
`allTimers` and sees the whole house.

The line is a **year** (`PANTRY_THRESHOLD_DAYS`), not the six months that first
suggested itself: his own wall already carries frozen spinach, frozen mixed
vegetables and mustard at four to eight months and he wants them there. **A
household template always wins** — a template exists because somebody taught
this app that this food goes off and how fast, which beats any general
knowledge about the food.

Pantry rows deliberately teach **no template**, or the next hand-typed tin of
beans would arrive on the wall with a two-year countdown.

### The fridge speaks for every food now, not just staples

`store/fridge/inHouse.js`, and it closed a gap worth knowing about.

The fridge could already take a row off the shopping list — but only for a food
flagged `staple`, and exactly **2 of the 126 groceries were**. On the real list
of 2026-09-20, seven rows (Cheddar, American Cheese Slices, Hamburger Buns,
Garlic, Sandwich Bread, Tortellini, Lettuce) sat there asking to be bought
while live timers for all seven sat in the fridge. The inventory existed and the
list ignored it. A staple was never the right gate: "do I already have this?"
is the same question for olive oil and for lettuce.

`rowCoverage` answers it in **quantities**, via the same `packageSize` bridge
`consume.js` uses — a timer holds packages, a row asks in recipe units. 10
slices of bread against a 20-slice loaf is covered. **3 cups of cheddar against
one 2-cup block is NOT**, and that row stays on the list carrying
`partlyOnHand` so it can say "you have some — 1 package, not enough". Suppressing
a partly-covered row is the one mistake that leaves a meal short.

The direction rule is unchanged: the fridge may only ever say YOU HAVE IT. No
timer means nobody has described that food, not that you are out of it, and an
**expired timer does not suppress** — it argues for buying more.

Everything the partition attaches to a row (`onHand`, `packagesOnHand`,
`partlyOnHand`, `stapleDue`…) is derived at read time and **stripped before any
write**. Persisting it would freeze one moment's answer into the row.

### Names are the join TWICE, so send both vocabularies

`store/fridge/vocabulary.js`. The scan flow only ever sent the fridge's
templates as `knownFoods`, which is right for shelf lives and wrong for
shopping: a template match decides a *duration*, a CATALOG match decides whether
a shopping row can come *off the list*.

The first real transcript proved it. A spoken "box of rotini" came back as
"Rotini Pasta" — a perfectly good name matching nothing, while the catalog calls
it "Rotini or Farfalle" and had it on that week's list. Pantry stores are worse:
they have no templates at all. Sending the catalog names too fixed it in one
run.

Order matters because the list is capped at 200: **what is on the shopping list
first**, then templates, then the rest of the catalog. One bad name (empty, or
over 60 characters) is dropped rather than 400ing the whole list.

### The receipt is the SECOND input, not a convenience

Matt corrected me on this the same day, and he was right: *"The receipt
essentially adds more things to our pantry that weren't on the fridge list
because we didn't have them then. And it stops me from having to read through
everything I got from the grocery store."*

Both halves matter. The talk-through describes the house **before** the shop;
the receipt describes what came in **after** it, which by definition the
talk-through could not have seen. Two inputs, one inventory — and it saves a
second brain-dump at the kitchen counter.

**Which exposed a leak: the receipt used to DISCARD tinned and dry food.** The
prompt said to skip "canned goods, dry pasta and rice, unopened shelf-stable
items" along with the non-food. Fine when the fridge only tracked perishables;
a hole in the loop the moment the talk-through started tracking the pantry. He
buys rice, the receipt ignores it, next week's list asks for rice again.

Receipts now record **all food**, flagged `perishable` or not, and skip only
NON-food — paper goods, cleaning supplies, totals. Measured on a synthetic
receipt: 10 foods kept (5 of them pantry, correctly flagged), paper towels,
detergent and the totals correctly skipped.

`isPerishable` lives in `store/fridge/perishable.js` and is imported by BOTH
flows on purpose. If they disagreed, a bag of rice would be pantry when spoken
and perishable when bought, and the wall would fill up with whichever one was
wrong.

**Two presentation rules for a pantry row**, both learned by looking at one:
it gets no duration ladder (offering "3 days / 5 days / 2 weeks" for a 5lb bag
of rice is noise) and no backdating line ("104 weeks 1 day left" is true,
useless and alarming). It shows `pantry — tracked, no countdown` instead. Note
`formatDaySpan` only knows weeks and days, which is why any long duration reads
absurdly — don't route one through it.

A new PERISHABLE food still stops for input. A pantry store does not: nobody
wants to type a number for a tin of beans.

### Retiring the camera, carefully

Matt kept **receipts** and retired the other two photo modes. A receipt is
printed text, which is the one thing that flow was genuinely reliable at; the
haul pile and the fridge reconcile were the guessing.

`ScanFlow` is receipt-facing now, and a photo that comes back as `storage` says
so and points at the talk-through instead of quietly running the retired flow.
**`buildReconcile` and its 15 tests are still in `scanReview.js`**, and the
reconcile stage is still in ScanFlow's template — re-importing it is the whole
of bringing the flow back. Delete both once the talk-through has real weeks
behind it, not before it has actually replaced anything.

### The scan endpoint

`aws-lambda/perishable-vision.js` (the file name is the Lambda's configured
handler — renaming it breaks the function). Deployed with the **`personal`** AWS
profile; `personal-deploy` has no Lambda permissions.

**Its key check reads the database, so that read must be authenticated.** It
was a bare unauthenticated GET, which worked only while the node was open to
anyone. When every path started requiring `auth != null` the read began
returning 401 for EVERY key — verification failed for everybody and every scan
was rejected before reaching the model, with nothing logging it as a fault.
Scanning simply stopped working. The client now sends its Firebase ID token
beside the capability key (`X-Firebase-Token`) and it rides on the read as
`?auth=`. Both the submit AND the poll carry it; omitting it on the poll
strands a job already paid for. `tests/unit/fridge/scan.spec.js` fences this.

The token is fetched per scan, never held: Firebase tokens last an hour and a
wall tablet sits on this page for weeks.

**API Gateway's CORS config overrides the Lambda's.** `ALLOWED_ORIGINS` in the
Lambda is not what the browser sees: the HTTP API `ifnzds1okb` has its own CORS
configuration, and when one is set API Gateway answers the preflight itself and
rewrites the CORS headers on every response. On 2026-09-11 it still listed only
Perishable's old CloudFront origin and no `x-firebase-token` header, so every
scan from mealhat.com reached the model and then failed in the browser as
"Something went wrong reading that photo." Fixed with `aws apigatewayv2
update-api --cors-configuration` (profile `personal`). Keep the two lists in
step; the gateway's is the one that counts.

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

**`.yarnrc` and its `--ignore-engines` are gone** (2026-09-14). It existed for
`@achrinza/node-ipc`, a transitive dependency of `@vue/cli-service`'s dev
server, which declares `engines.node` as an enumeration ending at 19 and is
unmaintained. The Vue CLI dev server went away with the Vite move and that
package is no longer anywhere in the lockfile, so the flag was deleted and a
clean `yarn install --frozen-lockfile` re-run to see what it had been
covering: nothing. Engine checks are enforced again.

**`postcss-html` is NOT a direct devDependency, deliberately.** It was pinned
at `^1.6.0`, which stylelint 13 cannot use (1.x is for stylelint 14+'s
`customSyntax`, and `.stylelintrc.json` sets none). `stylelint@13.12.0` brings
its own `postcss-html@^0.36.0`, whose `extract.js` is what `postcss-syntax`
requires to read `.vue` files. It only ever worked because yarn happened to
nest `postcss-syntax` under `stylelint/`; when the dependency set changed,
`postcss-syntax` hoisted to the root, found the 1.6.0 copy, and `yarn lint`
died with "Cannot find module 'postcss-html/extract'". Put it back and you get
that crash on the next clean install.

## Deploy (AWS S3 + CloudFront)

`yarn deploy` builds, then `aws s3 sync dist/ s3://meal-hat` and invalidates
CloudFront, all via the **`personal-deploy`** AWS profile. Infra (account
`298682183644`):

- S3 static-website bucket **`meal-hat`** (us-east-1)
- CloudFront distribution **`E1C9X1FV3WBDN6`**, custom domain `mealhat.com` + www
- Route 53 hosted zone `Z097753917S7LG3I2FEWJ`, ACM cert in us-east-1

`yarn build` runs `update-version` (`src/assets/javascript/version.js`), which
prompts for a semver bump. It no longer needs a terminal: name the bump up
front with **`VERSION_BUMP=minor yarn deploy`** (`patch`/`minor`/`major`), and
with no TTY and no variable it patches quietly rather than throwing. The
interactive prompt still falls back to a patch after 20 seconds.

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
