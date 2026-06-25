// Pure ingredient/grocery logic — no Firebase, Vuex, or DOM dependencies, so it
// can be unit-tested directly. The store and AddMeal delegate to these helpers;
// the store keeps only the thin wiring (reading state, persisting to Firebase).

// Normalize a grocery name for matching so trivial variations (case, surrounding
// whitespace) don't spawn duplicate entries that then can't merge.
export function normalizeName (name) {
  return (name || '').trim().toLowerCase();
}

// Find an existing grocery id by normalized name in the catalog (id -> entry map).
export function findGroceryIdByName (name, catalog = {}) {
  const target = normalizeName(name);
  if (!target) {
    return null;
  }
  const match = Object.values(catalog || {}).find((item) => normalizeName(item.name) === target);
  return match ? match.id : null;
}

// Aggregate the ingredients of upcoming drawn meals into a map keyed by grocery
// id, summing quantities for ingredients shared across meals. `getMeal` resolves
// a meal by id; `catalog` resolves a grocery entry by id.
export function aggregateMealIngredients ({ drawnMeals, getMeal, catalog = {}, now = new Date() }) {
  const mealIngredients = {};
  if (!drawnMeals) {
    return mealIngredients;
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const upcomingMeals = drawnMeals.filter((drawnMeal) => new Date(drawnMeal.assignedDate) >= today);

  upcomingMeals.forEach((drawnMeal) => {
    const meal = getMeal(drawnMeal.mealId);
    if (meal && meal.ingredients) {
      meal.ingredients.forEach((ingredient) => {
        const groceryItem = catalog[ingredient.groceryItemId];
        if (groceryItem) {
          const id = groceryItem.id;
          if (mealIngredients[id]) {
            mealIngredients[id].quantity += ingredient.quantity;
          } else {
            mealIngredients[id] = { ...groceryItem, quantity: ingredient.quantity, mealId: drawnMeal.mealId };
          }
        }
      });
    }
  });

  return mealIngredients;
}

// Repoint a meal's ingredient references through `remap` (oldId -> newId),
// merging any that now collapse onto the same id. Returns the rebuilt ingredient
// list plus whether anything actually changed.
export function remapMealIngredients (ingredients, remap) {
  const byId = {};
  let touched = false;
  (ingredients || []).forEach((ing) => {
    const newId = remap(ing.groceryItemId);
    if (newId !== ing.groceryItemId) touched = true;
    if (byId[newId]) {
      byId[newId].quantity = (Number(byId[newId].quantity) || 0) + (Number(ing.quantity) || 0);
    } else {
      byId[newId] = { groceryItemId: newId, quantity: ing.quantity };
    }
  });
  return { ingredients: Object.values(byId), touched };
}

// Report grocery entries that share a normalized name (likely the same
// ingredient split across multiple ids), with how heavily each is referenced.
export function analyzeDuplicates ({ catalog = {}, meals = [], shoppingList = {} }) {
  // Count references to each grocery id across meals and the shopping list.
  const refCounts = {};
  (meals || []).forEach((m) => (m.ingredients || []).forEach((ing) => {
    refCounts[ing.groceryItemId] = (refCounts[ing.groceryItemId] || 0) + 1;
  }));
  Object.values(shoppingList || {}).forEach((item) => {
    if (item.groceryId) {
      refCounts[item.groceryId] = (refCounts[item.groceryId] || 0) + 1;
    }
  });

  // Group catalog entries by normalized name.
  const groups = {};
  Object.values(catalog || {}).forEach((item) => {
    const key = normalizeName(item.name);
    if (!key) return;
    (groups[key] = groups[key] || []).push(item);
  });

  const clusters = Object.entries(groups)
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => {
      const sorted = [...items].sort((a, b) => (refCounts[b.id] || 0) - (refCounts[a.id] || 0));
      const canonical = sorted[0];
      return {
        normalizedName: key,
        canonicalId: canonical.id,
        entries: sorted.map((it) => ({
          id: it.id,
          name: it.name,
          aisle: it.defaultAisle,
          refs: refCounts[it.id] || 0,
          canonical: it.id === canonical.id
        }))
      };
    })
    .sort((a, b) => b.entries.length - a.entries.length);

  return {
    catalogCount: Object.keys(catalog || {}).length,
    duplicateClusters: clusters.length,
    redundantEntries: clusters.reduce((n, c) => n + c.entries.length - 1, 0),
    clusters
  };
}

// Generic grocery words that shouldn't, on their own, make two items "similar".
const SIMILARITY_STOPWORDS = new Set(['cheese', 'sauce', 'fresh', 'ground', 'sliced', 'shredded',
  'organic', 'large', 'small', 'whole', 'can', 'canned', 'jar', 'bag', 'box',
  'of', 'the', 'and', 'frozen', 'dried', 'raw', 'mix', 'powder', 'boneless', 'skinless']);

function tokenize (s) {
  return normalizeName(s).split(/[^a-z0-9]+/).filter(Boolean);
}

export function levenshtein (a, b) {
  const m = a.length; const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[n];
}

// Find catalog entries that are LIKELY the same ingredient but named differently
// — close spellings (typos) and "one name contains the other" sharing a
// meaningful word. Heuristic candidates for human review, not auto-merges.
export function findSimilar (catalog = {}) {
  const meta = Object.values(catalog || {})
    .filter((i) => i && i.name)
    .map((i) => {
      const toks = tokenize(i.name);
      return { id: i.id, name: i.name, norm: normalizeName(i.name), toks: new Set(toks), sig: toks.filter((t) => !SIMILARITY_STOPWORDS.has(t)) };
    });

  const pairs = [];
  for (let i = 0; i < meta.length; i++) {
    for (let j = i + 1; j < meta.length; j++) {
      const A = meta[i]; const B = meta[j];
      if (A.norm === B.norm) continue; // exact-normalized dupes handled separately
      const reasons = [];

      const d = levenshtein(A.norm, B.norm);
      if (Math.max(A.norm.length, B.norm.length) >= 4 && d > 0 && d <= 2) {
        reasons.push(`close spelling (edit distance ${d})`);
      }

      const aSub = [...A.toks].every((t) => B.toks.has(t));
      const bSub = [...B.toks].every((t) => A.toks.has(t));
      if (aSub || bSub) {
        const smaller = aSub ? A : B;
        if (smaller.sig.length) reasons.push('one name contains the other');
      }

      if (reasons.length) {
        pairs.push({ aId: A.id, a: A.name, bId: B.id, b: B.name, reasons });
      }
    }
  }
  return { candidatePairs: pairs.length, pairs };
}
