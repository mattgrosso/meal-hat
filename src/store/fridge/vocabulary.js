// The names to hand the model, and the order to hand them in.
//
// NAMES ARE THE JOIN, and they are the join TWICE over. A template match
// decides a food's shelf life; a CATALOG match decides whether a shopping-list
// row can come off the list. Both compare names exactly, so a food spelled two
// ways is not a cosmetic problem — it is a silently severed join, and both
// sides fail quietly. CLAUDE.md has the two times it happened.
//
// The scan flow only ever sent the fridge's TEMPLATES, which is right for
// shelf lives and wrong for shopping. The first real transcript proved it: a
// spoken "box of rotini" came back as "Rotini Pasta" — a perfectly good name
// that matches nothing, while the catalog calls it "Rotini or Farfalle" and
// has it on this week's list. Pantry stores are worse, because they have no
// templates at all: the whole reason for saying "we've got rice" is that rice
// should not be bought again, and nothing in the fridge has ever heard of it.
//
// So both vocabularies go, and the ORDER matters because the list is capped.

// The endpoint's own limit. Kept here so the caller can trim before sending
// rather than discovering the 400.
export const MAX_KNOWN_FOODS = 200

const normalize = (name) => String(name || '').trim().toLowerCase()

/**
 * What this household calls its food, most useful first.
 *
 * 1. Foods on the shopping list right now. These are the whole point — a name
 *    that matches here is a row that can come off the list this afternoon.
 * 2. The fridge's templates. These carry the shelf lives, so a match means a
 *    row arrives ready instead of asking.
 * 3. Everything else in the catalog, which is what makes next week's list
 *    reducible too.
 *
 * Deduplicated case-insensitively while keeping the first spelling seen, and
 * capped — if something has to be dropped it should be the tail.
 */
export function knownFoodNames ({ templates = [], catalog = {}, shoppingList = {} } = {}, limit = MAX_KNOWN_FOODS) {
  const out = []
  const seen = new Set()

  const add = (name) => {
    const text = String(name || '').trim()
    // The endpoint rejects the whole list over an empty or overlong name, and
    // a catalog with one bad row must not cost the household its vocabulary.
    if (!text || text.length > 60) return
    const key = normalize(text)
    if (seen.has(key)) return
    seen.add(key)
    out.push(text)
  }

  Object.values(shoppingList || {}).forEach((row) => {
    if (row?.purchased) return
    add(catalog?.[row?.groceryId]?.name)
  })

  // An explicit null defeats a default parameter, and the store hands these
  // through before its subscriptions have landed.
  ;(templates || []).forEach((template) => add(template?.title))
  Object.values(catalog || {}).forEach((entry) => add(entry?.name))

  return out.slice(0, limit)
}
