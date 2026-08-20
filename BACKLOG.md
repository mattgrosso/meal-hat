# Meal Hat — backlog

Replaces `FeatureIdeas.md` and `todos.md`, which had drifted: most of what was
in them had been built. Delete-from-schedule, grocery autosuggest, one-input
filter-and-add, shared multi-user hats and marking ingredients acquired all
exist. What survived from those files is folded in below.

Last reviewed 2026-08-19.

**Done since:** drawnMeals is now loaded as a bounded 400-day window rather than
in full (461 rows migrated to ISO, 247 loaded, and it stops growing); routes,
the tour library and the calendar are all loaded on demand, taking the initial
transfer from 306KB to 200KB gzipped; `axios` and `lodash` are gone; Node is on
22.22.3 and a clean `yarn install` works again; `yarn lint` passes; the bug
report button is built and live (v1.5.0); checking items off now sticks across
a regeneration (v1.6.0); the draw is weighted by how overdue a meal is
(v1.7.0); pantry staples (v1.8.0); hats are membership-gated with invite links
(v1.9.0), with a members roster you can manage (v1.10.0).

**Follow-up on hats:** two top-level keys were deliberately left without members
and are now readable by nobody — `carrieseltzerandmattgrosso-gmail-com` (an
empty shell: a meal-hats-list and a most-recent-database, no meals, no shopping
list) and `test-example-com` (leftover test data, which still carries the
deprecated split-model nodes). Neither loses anything. Grant access with
`scripts/backfill-hat-membership.mjs` or a CLI write if either is ever wanted
back.

**Possible follow-up on staples:** the per-item `stapleIntervalDays` is stored
and honoured but has no UI — everything uses the 60-day default. Salt and flour
plainly want different numbers. Worth adding only once the default proves wrong
in practice. See the
service-worker and dates sections of `CLAUDE.md` for the traps involved.

## Next up

**Optional: drop responsive variants of the Bootstrap utilities.** Measured, and
deliberately not taken. The utilities API is 7.9KB gzipped of the CSS that
remains, most of it responsive variants generated at six breakpoints — and the
templates use exactly ONE breakpoint class, `col-md-2`, which comes from the
grid rather than the utilities API. Disabling responsive utilities measured
22.5KB -> 18.5KB gzipped.

Not done because the failure mode is silent: a missing component renders
obviously unstyled, but a `d-md-none` added later would just quietly do nothing.
4KB against a 200KB critical path did not seem worth that. The patch is four
lines (`@each` over `$utilities` setting `responsive: false`, after
`bootstrap/scss/utilities` and before `utilities/api`).

**Dead classes in the templates.** `md-col-8` (DrawnMealSchedule) and `md-col-4`
(ShowMeals) are not Bootstrap classes — Bootstrap's form is `col-md-*`. They
have never done anything. Decide whether those layouts wanted a breakpoint and
fix, or delete them.

## Features


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
