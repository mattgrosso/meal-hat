# Meal Hat — backlog

Replaces `FeatureIdeas.md` and `todos.md`, which had drifted: most of what was
in them had been built. Delete-from-schedule, grocery autosuggest, one-input
filter-and-add, shared multi-user hats and marking ingredients acquired all
exist. What survived from those files is folded in below.

Last reviewed 2026-08-19.

## Next up

**Stop loading the whole draw history.** `initializeDB` subscribes to all of
`drawnMeals` with no constraint, so every page load pulls every meal ever drawn.
Growth is O(time) — it gets worse whether or not the hat changes. The fix is a
range query (`orderByChild('assignedDate').startAt(...)`), which needs two
things first:

1. A one-time migration of existing `assignedDate` values to ISO. New writes are
   already ISO and reads tolerate both, but Firebase would order the old
   `"Wed Aug 19 2026"` strings alphabetically, so the query can't be trusted
   until they're all converted.
2. `.indexOn: "assignedDate"` in `database.rules.json`.

Optionally then archive or drop rows older than the window. Worth doing on its
own merits: the calendar's `disabled-dates` currently maps the entire history on
every render.

**Lazy-load the heavy dependencies.** Biggest speed win available, no behaviour
change:

- The router imports all 7 components eagerly, so there is no route splitting.
- `shepherd.js` is imported by 6 components (plus its CSS) purely for the "?"
  tours — always downloaded, used on click.
- `v-calendar` is registered globally in `main.js` but used by 2 screens.

Vendor is ~257KB gzipped on every load, for an app whose critical path is
"show me this week's dinners".

**Drop the unused dependencies.** `axios` and `lodash` are direct dependencies
with zero imports anywhere in `src/`. `nodemon` is in `dependencies` rather than
`devDependencies`.

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
