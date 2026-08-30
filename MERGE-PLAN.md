# Merging Perishable into Meal Hat

Goal: one app that manages groceries, ingredients, meals **and** what is
actually in the fridge. Perishable is retired when this ships.

## Decisions (settled 2026-08-29)

| Question | Answer |
| --- | --- |
| Build system | Port perishable onto meal-hat's vue-cli/webpack. No Vite migration in this pass. |
| Food identity | One unified food record. The grocery catalog absorbs shelf life. |
| Fridge scope | One fridge per hat. Inherits the existing hat sharing model. |
| Old deployment | Shut down when the merge ships. |
| Wall-tablet auth | Capability key, preserved exactly. No Google popup on the kiosk. |
| Fridge data path | `fridge/<key>/…`, top level. The hat stores a `fridgeKey` pointer. |
| Capability key value | Reuse `0rhAwAvV…` so the scan Lambda needs no re-issue. |

### Why the fridge node is top-level, not under the hat

RTDB rules cannot take the capability key as a parameter — there is nowhere in
a request to put it. Perishable's whole scheme works because **the path is the
credential**: `households/<32-char-secret>`. Nesting the fridge under
`<hat>/fridge` would put it behind a guessable key (the hat name is an email),
so the secret has to stay in the path. The hat gets a `fridgeKey` pointer so a
signed-in phone can find its own fridge; the kiosk, which has no sign-in, goes
straight to `fridge/<key>` with the key from its URL.

Net effect: two doors to the same data. The phone arrives authenticated and
looks up the key; the wall arrives holding the key. Neither can reach the other
hat's meals.

## Blocking bug found during recon

**The camera scan is broken in production right now.** Commit `df34068` (today)
made every perishable path require `auth != null`, but the Lambda verifies the
household key with an *unauthenticated* REST read
(`aws-lambda/perishable-vision.js:131`). A live probe of a well-formed key
returns `HTTP 401`, so `verifyHouseholdKey` returns null for every request and
every scan is rejected before reaching the vision model.

Fix, folded into the port: the client sends its anonymous Firebase ID token
alongside the capability key, and the Lambda appends it as `?auth=<idToken>` on
the verification read. No new secrets, and it ends up stronger than the
original — a caller then needs both the key and a real session.

## Meal Hat is not a solo app

The database has **14 hats**, most belonging to other people (carrieseltzer,
eliz-hargrave, matt-swasey, brian-goegan, witoldkesek, natalierosegrosso,
hopper-seth, elray6446, eiske-fetch-ly). Every schema change here lands in
their data too.

So: **additive only.** A hat with no `fridgeKey` must behave exactly as it does
today — no fridge tab, no new required fields, no migration applied to it. The
fridge is opt-in per hat, created on first use.

## Food identity: the actual numbers

93 catalog entries, 58 shelf-life templates, matched with meal-hat's own
`normalizeName` / `levenshtein` / token-subset rules so the merge agrees with
what the app already calls "the same ingredient".

- **27 exact** — auto-merge.
- **16 need review** — some are obvious (`Cucumbers`/`Cucumber`,
  `Hotdogs`/`Hot Dogs`, `Lemons`/`Lemon`, `Tortillas`/`Tortilla`), several are
  wrong and must not be auto-applied:
  - `Peppers (13d)` → `Pepper (Box/can, aisle 12)` — that is the **spice**.
  - `Sausage Pasta (7d)` → `Sausage` — a leftover dish, not the ingredient.
  - `Ice Cream (90d)` → `Ice Cream Sandwiches` — different foods.
  - `Cherries (7d)` → `Peaches, cherries, or berries (whatever looks/smells
    good)` — that catalog entry is a shopping instruction, not a food.
  - `Spinach (10d)` → two candidates, `Fresh Spinach` and `Frozen Spinach`,
    with genuinely different shelf lives.
- **15 template-only** — become new catalog entries.
- **66 catalog entries have no shelf life** — fine, they stay as they are.

### The fridge holds things that are not groceries

`Leftover pizza`, `Leftover chinese`, `Dino Nuggets`, `Corn on the cob` — foods
you put a timer on but never shop for. The unified record must allow a food
that exists only as a fridge item, so "is a shopping item" and "has a shelf
life" are independent properties of one record, not two record types.

## Phases

1. **Pure libs.** `timers`, `history`, `scanReview`, `crop`, `photo`, `scan`,
   `viewMode` move over with their tests. No Firebase, no DOM — mechanical.
2. **Key + store.** `householdKey` → `fridgeKey`, and a `store/fridge.js`
   module talking to `fridge/<key>` on meal-hat's database.
3. **Rules + migration.** Additive rules for the new node; copy 58 templates
   and the live timers across; unify the food records behind the review list.
4. **UI.** Fridge route, wall/phone split preserved, kiosk entry via `?k=`.
5. **Lambda.** Repoint verification at meal-hat's database and fix the auth bug.
6. **Ship.** Deploy, re-point the tablet, then retire perishable.

## The kiosk cannot read the grocery catalog

Found while building phase 4, and it shapes the whole UI phase.

The unified food record lives in the hat, at `<hat>/grocery-catalog`, and the
rules grant that only to hat members keyed by `auth.uid`. The wall tablet has an
anonymous session and a capability key — it is not a member of anything, and
cannot be made one without the sign-in it exists to avoid. **So the wall display
can never read the catalog directly.**

That is not a flaw in the merge, it is the same shape as the Magic Mirror, and
it takes the same answer: the authenticated app PUBLISHES what the unauthored
surface needs. `fridge/<key>/templates` stays, no longer as a second food
database but as a **projection of the catalog's shelf lives**, written by the
signed-in app and read by the kiosk.

Writes flowing the other way — the wall learning a shelf life from a scan — land
in the same node and are reconciled into the catalog by the app on its next
load. The catalog stays authoritative; the projection is a cache with one
writer that matters.

## Open question for Matt

Perishable's phone view deliberately does **not** show timers — it is a capture
surface only ("The UI on the phone shouldn't bother showing me the timers"). But
inside meal-hat, seeing what is in the fridge while building a shopping list is
much of the point of merging. Proposal: the phone fridge tab keeps the camera as
its primary action and gains a compact on-hand list, which is also what feeds
the staple logic. The wall display is untouched.
