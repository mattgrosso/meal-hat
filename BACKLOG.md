# Meal Hat — backlog

Replaces `FeatureIdeas.md` and `todos.md`, which had drifted: most of what was
in them had been built. Delete-from-schedule, grocery autosuggest, one-input
filter-and-add, shared multi-user hats and marking ingredients acquired all
exist. What survived from those files is folded in below.

Last reviewed 2026-08-19.

**Done since:** drawnMeals is now loaded as a bounded 400-day window rather than
in full (461 rows migrated to ISO, 247 loaded, and it stops growing); routes,
the tour library and the calendar are all loaded on demand, taking the initial
transfer from 306KB to 200KB gzipped; `axios` and `lodash` are gone. See the
service-worker and dates sections of `CLAUDE.md` for the traps involved.

## Next up

**`.tool-versions` pins Node 18.4.0, and `yarn install` fails on it.**
`stylelint-config-sass-guidelines` requires `>=18.12.0`, so a clean install
errors out with "incompatible module". The existing `node_modules` works and the
build is fine, so this is invisible day to day — but it means the repo cannot
currently be set up from scratch. 18.18.0, 20.20.0 and 22.22.3 are all installed
locally; note that 20.20.0 is an x64 build running under Rosetta, and 22.22.3 is
native arm64. Bump and re-verify the build.

**Bootstrap CSS is 30KB gzipped of the remaining 200KB** and is imported whole
in `main.js`. Importing only the components in use, or moving to Bootstrap's
Sass entry points, is the next real slice — but it is fiddly and easy to get
subtly wrong, so it needs a careful visual pass.

## Features

**Make checking off stick.** The red X works, but it deletes rather than
remembers — and `generateShoppingListFromMeals` rebuilds every `source: 'meal'`
item from all upcoming drawn meals, with no idea you already bought anything. So
anything cleared for a still-upcoming meal comes back the next time you draw,
reorder the schedule, delete a drawn meal, or schedule one from Show Meals.
Manual items stay gone, because they are never regenerated — the same gesture
behaves differently depending on where the item came from.

The `purchased` field already exists for this: mark it bought instead of
deleting, and teach regeneration to leave bought items alone, reopening only if
the required quantity actually goes up.

**Weight the draw.** `getRandomMealForDate` picks uniformly at random among
eligible meals; nothing favours what you haven't eaten in ages. `minDaysBetween`
is the only lever. Weighting by time-since-last-drawn would make the hat feel
smarter with no new UI — and `drawnDates` already keeps enough history to do it.

**Pantry staples.** Things you always have shouldn't keep landing on the list.

**Hat membership.** Any signed-in user who guesses a hat's name can read and
write it — that is the sharing model, but since the rules were tightened it is
the only thing standing between accounts. A per-hat member list would close it
*and* answer the old "delete a hat nobody is using any more" idea.

## Structural, when touched

- **ShoppingList.vue is 794 lines and writes to store state directly in 11
  places** (`this.$store.state.shoppingList[id] = ...`). It works — Vue 3
  reactivity is proxy-based — but it bypasses Vuex, so the mutations are
  decorative, devtools can't trace a change, and the optimistic-update-then-
  persist dance is reimplemented at every call site.
- **`updateDBValue` is `set()`**, so it is last-write-wins. `applyDraw` and
  `reassignDrawnMeals` now use atomic multi-path `update()`; the remaining
  single-key writes should follow where concurrency matters.
- **Keep extracting pure modules.** `ingredients.js` and `schedule.js` are the
  only parts with real unit tests, and that is not a coincidence — logic inside
  the store needs Firebase to test. The shopping-list rules are the obvious next
  candidate.

## Deliberately not doing

Rewrites for their own sake — Pinia, TypeScript, swapping the component library.
The app works, it has one primary user and a few shared-hat guests, and none of
that changes what it does.

## Older notes still worth keeping

- Consider auth providers beyond Google.
- The toast component exists and is barely used.
- "Styles look bad. We should fix that." (Long-standing, still true, still
  vague — needs a direction before it is actionable.)
