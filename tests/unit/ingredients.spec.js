import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  findGroceryIdByName,
  aggregateMealIngredients,
  remapMealIngredients,
  analyzeDuplicates,
  findSimilar,
  levenshtein
} from '../../src/store/ingredients.js';

describe('normalizeName', () => {
  it('trims and lowercases', () => {
    expect(normalizeName('  Onion ')).toBe('onion');
    expect(normalizeName('TOMATO Sauce')).toBe('tomato sauce');
  });
  it('handles null/undefined/empty', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName('')).toBe('');
  });
});

describe('findGroceryIdByName', () => {
  const catalog = {
    a: { id: 'a', name: 'Onion' },
    b: { id: 'b', name: 'Garlic' }
  };
  const legacy = {
    c: { id: 'c', name: 'Carrot' }
  };

  it('matches case- and whitespace-insensitively (the dedup guarantee)', () => {
    expect(findGroceryIdByName('onion', catalog)).toBe('a');
    expect(findGroceryIdByName('  ONION  ', catalog)).toBe('a');
  });
  it('prefers the catalog, then falls back to the legacy list', () => {
    expect(findGroceryIdByName('Garlic', catalog, legacy)).toBe('b');
    expect(findGroceryIdByName('carrot', catalog, legacy)).toBe('c');
  });
  it('returns null for no match or empty name', () => {
    expect(findGroceryIdByName('Pepper', catalog, legacy)).toBeNull();
    expect(findGroceryIdByName('   ', catalog, legacy)).toBeNull();
    expect(findGroceryIdByName('', catalog)).toBeNull();
  });
});

describe('aggregateMealIngredients', () => {
  const catalog = {
    onion: { id: 'onion', name: 'Onion', defaultAisle: 1 },
    beef: { id: 'beef', name: 'Beef', defaultAisle: 2 }
  };
  const meals = {
    chili: { id: 'chili', name: 'Chili', ingredients: [{ groceryItemId: 'onion', quantity: 2 }, { groceryItemId: 'beef', quantity: 1 }] },
    soup: { id: 'soup', name: 'Soup', ingredients: [{ groceryItemId: 'onion', quantity: 3 }] }
  };
  const getMeal = (id) => meals[id];
  const now = new Date('2026-06-25T12:00:00');

  it('sums quantities for an ingredient shared across meals', () => {
    const drawn = [
      { mealId: 'chili', assignedDate: '2026-06-26' },
      { mealId: 'soup', assignedDate: '2026-06-27' }
    ];
    const result = aggregateMealIngredients({ drawnMeals: drawn, getMeal, catalog, now });
    // onion: 2 (chili) + 3 (soup) = 5, on a single entry — not two separate lines
    expect(result.onion.quantity).toBe(5);
    expect(result.beef.quantity).toBe(1);
    expect(Object.keys(result).sort()).toEqual(['beef', 'onion']);
  });

  it('excludes meals assigned before today', () => {
    const drawn = [
      { mealId: 'chili', assignedDate: '2026-06-20' }, // past
      { mealId: 'soup', assignedDate: '2026-06-27' } // future
    ];
    const result = aggregateMealIngredients({ drawnMeals: drawn, getMeal, catalog, now });
    expect(result.beef).toBeUndefined(); // chili was in the past
    expect(result.onion.quantity).toBe(3); // only soup
  });

  it('falls back to the legacy grocery-items map when catalog lacks the id', () => {
    const legacy = { milk: { id: 'milk', name: 'Milk' } };
    const mealsWithLegacy = { latte: { id: 'latte', ingredients: [{ groceryItemId: 'milk', quantity: 1 }] } };
    const result = aggregateMealIngredients({
      drawnMeals: [{ mealId: 'latte', assignedDate: '2026-06-26' }],
      getMeal: (id) => mealsWithLegacy[id],
      catalog: {},
      legacyItems: legacy,
      now
    });
    expect(result.milk.quantity).toBe(1);
  });

  it('tags each ingredient with the meal it came from and ignores unmatched ids', () => {
    const drawn = [{ mealId: 'chili', assignedDate: '2026-06-26' }];
    const mealsWithGhost = { chili: { id: 'chili', ingredients: [{ groceryItemId: 'onion', quantity: 1 }, { groceryItemId: 'ghost', quantity: 9 }] } };
    const result = aggregateMealIngredients({ drawnMeals: drawn, getMeal: (id) => mealsWithGhost[id], catalog, now });
    expect(result.onion.mealId).toBe('chili');
    expect(result.ghost).toBeUndefined();
  });

  it('returns an empty map when there are no drawn meals', () => {
    expect(aggregateMealIngredients({ drawnMeals: null, getMeal, catalog, now })).toEqual({});
  });
});

describe('remapMealIngredients', () => {
  it('repoints ids and merges entries that collapse onto the same id', () => {
    const ingredients = [
      { groceryItemId: 'old', quantity: 2 },
      { groceryItemId: 'keep', quantity: 1 }
    ];
    const remap = (id) => (id === 'old' ? 'keep' : id);
    const { ingredients: out, touched } = remapMealIngredients(ingredients, remap);
    expect(touched).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ groceryItemId: 'keep', quantity: 3 }); // 2 + 1, numerically
  });

  it('reports touched=false and is a no-op when nothing remaps', () => {
    const ingredients = [{ groceryItemId: 'a', quantity: 1 }];
    const { ingredients: out, touched } = remapMealIngredients(ingredients, (id) => id);
    expect(touched).toBe(false);
    expect(out).toEqual([{ groceryItemId: 'a', quantity: 1 }]);
  });

  it('coerces string quantities when merging', () => {
    const ingredients = [
      { groceryItemId: 'old', quantity: '2' },
      { groceryItemId: 'keep', quantity: '3' }
    ];
    const { ingredients: out } = remapMealIngredients(ingredients, (id) => (id === 'old' ? 'keep' : id));
    expect(out[0].quantity).toBe(5); // not "23"
  });
});

describe('analyzeDuplicates', () => {
  it('clusters entries that share a normalized name and picks the most-referenced as canonical', () => {
    const catalog = {
      x: { id: 'x', name: 'Tomato Sauce' },
      y: { id: 'y', name: 'tomato sauce' },
      z: { id: 'z', name: 'Garlic' }
    };
    const meals = [
      { ingredients: [{ groceryItemId: 'x' }, { groceryItemId: 'x' }] }, // x referenced twice
      { ingredients: [{ groceryItemId: 'y' }] }
    ];
    const report = analyzeDuplicates({ catalog, meals, shoppingList: {} });
    expect(report.catalogCount).toBe(3);
    expect(report.duplicateClusters).toBe(1);
    expect(report.redundantEntries).toBe(1);
    const cluster = report.clusters[0];
    expect(cluster.normalizedName).toBe('tomato sauce');
    expect(cluster.canonicalId).toBe('x'); // most-referenced
  });

  it('counts shopping-list references too', () => {
    const catalog = { a: { id: 'a', name: 'Milk' }, b: { id: 'b', name: 'milk' } };
    const report = analyzeDuplicates({
      catalog,
      meals: [],
      shoppingList: { s1: { groceryId: 'b' }, s2: { groceryId: 'b' } }
    });
    expect(report.clusters[0].canonicalId).toBe('b');
  });

  it('reports no duplicates for a clean catalog', () => {
    const report = analyzeDuplicates({ catalog: { a: { id: 'a', name: 'Onion' } }, meals: [], shoppingList: {} });
    expect(report.duplicateClusters).toBe(0);
    expect(report.clusters).toEqual([]);
  });
});

describe('findSimilar', () => {
  const pairKey = (p) => [p.a, p.b].sort().join(' | ');

  it('flags close spellings (typos)', () => {
    const { pairs } = findSimilar({
      a: { id: 'a', name: 'Mozzerella' },
      b: { id: 'b', name: 'Mozarella' }
    });
    expect(pairs.map(pairKey)).toContain('Mozarella | Mozzerella');
    expect(pairs[0].reasons.join()).toMatch(/close spelling/);
  });

  it('flags "one name contains the other" sharing a meaningful word', () => {
    const { pairs } = findSimilar({
      a: { id: 'a', name: 'Mozzarella' },
      b: { id: 'b', name: 'Mozzarella Cheese' }
    });
    expect(pairs.map(pairKey)).toContain('Mozzarella | Mozzarella Cheese');
  });

  it('does NOT flag generic-word-only overlaps', () => {
    const { pairs } = findSimilar({
      a: { id: 'a', name: 'Cheese' },
      b: { id: 'b', name: 'Sliced Cheese' }
    });
    expect(pairs).toHaveLength(0);
  });

  it('does NOT flag genuinely different items that merely share a word', () => {
    const { pairs } = findSimilar({
      a: { id: 'a', name: 'Black Beans' },
      b: { id: 'b', name: 'Green Beans' }
    });
    expect(pairs).toHaveLength(0);
  });
});

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('mozzerella', 'mozarella')).toBe(2);
  });
});
