import { describe, it, expect } from 'vitest';
import { reconcileShelfLives, fridgeFoodId } from '../../../src/store/fridge/reconcile';

const food = (id, name, extra = {}) => ({ id, name, ...extra });
const tmpl = (title, days) => ({ title, days });

describe('reconcileShelfLives', () => {
  it('leaves alone the foods neither side knows a shelf life for', () => {
    // Most of the catalog is in this state — 55 of 112 entries after the
    // migration — and it is not a problem to solve.
    const result = reconcileShelfLives({
      catalog: { a: food('a', 'Toothpaste'), b: food('b', 'Flour') },
      templates: {}
    });
    expect(result.toCatalog).toEqual([]);
    expect(result.toTemplates).toEqual([]);
    expect(result.newFoods).toEqual([]);
  });

  it('adopts a shelf life the fridge learned for a food that had none', () => {
    const result = reconcileShelfLives({
      catalog: { a: food('a', 'Olive Oil') },
      templates: { 'Olive Oil': tmpl('Olive Oil', 120) }
    });
    expect(result.toCatalog).toEqual([{ id: 'a', name: 'Olive Oil', days: 120 }]);
    expect(result.toTemplates).toEqual([]);
  });

  it('publishes a catalog shelf life the fridge cannot otherwise see', () => {
    // The wall tablet is a member of no hat and can never read the catalog, so
    // an unpublished shelf life is invisible to it.
    const result = reconcileShelfLives({
      catalog: { a: food('a', 'Butter', { shelfLifeDays: 90 }) },
      templates: {}
    });
    expect(result.toTemplates).toEqual([{ title: 'Butter', days: 90 }]);
    expect(result.toCatalog).toEqual([]);
  });

  it('writes the agreed value back as the base the first time', () => {
    // Without a base, neither side's later edit is attributable, and every
    // disagreement would look like a conflict forever.
    const result = reconcileShelfLives({
      catalog: { a: food('a', 'Eggs', { shelfLifeDays: 28 }) },
      templates: { Eggs: tmpl('Eggs', 28) }
    });
    expect(result.toCatalog).toEqual([{ id: 'a', name: 'Eggs', days: 28 }]);
    expect(result.conflicts).toEqual([]);
  });

  it('says nothing when both sides agree and the base already records it', () => {
    const result = reconcileShelfLives({
      catalog: { a: food('a', 'Eggs', { shelfLifeDays: 28, shelfLifeSyncedDays: 28 }) },
      templates: { Eggs: tmpl('Eggs', 28) }
    });
    expect(result.toCatalog).toEqual([]);
    expect(result.toTemplates).toEqual([]);
  });

  it('takes the fridge\'s edit when only the fridge moved', () => {
    const result = reconcileShelfLives({
      catalog: { a: food('a', 'Ham', { shelfLifeDays: 7, shelfLifeSyncedDays: 7 }) },
      templates: { Ham: tmpl('Ham', 10) }
    });
    expect(result.toCatalog).toEqual([{ id: 'a', name: 'Ham', days: 10 }]);
    expect(result.toTemplates).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('publishes the catalog\'s edit when only the catalog moved', () => {
    const result = reconcileShelfLives({
      catalog: { a: food('a', 'Ham', { shelfLifeDays: 14, shelfLifeSyncedDays: 7 }) },
      templates: { Ham: tmpl('Ham', 7) }
    });
    expect(result.toTemplates).toEqual([{ title: 'Ham', days: 14 }]);
    expect(result.toCatalog).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('gives a genuine simultaneous edit to the fridge, and reports it', () => {
    // The fridge wins because it is closer to the food: someone stood in the
    // kitchen, photographed the item and confirmed a date. But swallowing the
    // loss silently is how a wrong shelf life goes unnoticed for weeks.
    const result = reconcileShelfLives({
      catalog: { a: food('a', 'Ham', { shelfLifeDays: 14, shelfLifeSyncedDays: 7 }) },
      templates: { Ham: tmpl('Ham', 21) }
    });
    expect(result.toCatalog).toEqual([{ id: 'a', name: 'Ham', days: 21 }]);
    expect(result.conflicts).toEqual([
      { id: 'a', name: 'Ham', fromFridge: 21, inCatalog: 14, base: 7 }
    ]);
  });

  it('creates a food the fridge invented and the catalog never knew', () => {
    const result = reconcileShelfLives({
      catalog: {},
      templates: { 'Leftover chinese': tmpl('Leftover chinese', 5) }
    });
    expect(result.newFoods).toEqual([
      { title: 'Leftover chinese', days: 5, fridgeOnly: true }
    ]);
  });

  it('does not mark an ordinary grocery as fridge-only', () => {
    // The rule is a "leftover" prefix and nothing else. The tempting broader
    // rule would have hidden Grapes, Potatoes and Watermelon from the shopping
    // list, which is the expensive direction to be wrong in.
    const result = reconcileShelfLives({
      catalog: {},
      templates: {
        Watermelon: tmpl('Watermelon', 7),
        Grapes: tmpl('Grapes', 14)
      }
    });
    expect(result.newFoods.every((f) => !f.fridgeOnly)).toBe(true);
    expect(result.newFoods).toHaveLength(2);
  });

  it('will not create a duplicate for a name that only differs by case', () => {
    // templateKey and normalizeName are not the same function; without this
    // guard "cheddar cheese" from the wall would spawn a second entry beside
    // the catalog's "Cheddar Cheese".
    const result = reconcileShelfLives({
      catalog: { a: food('a', 'Cheddar Cheese', { shelfLifeDays: 74 }) },
      templates: { 'cheddar cheese': tmpl('cheddar cheese', 74) }
    });
    expect(result.newFoods).toEqual([]);
  });

  it('ignores junk days rather than writing them anywhere', () => {
    const result = reconcileShelfLives({
      catalog: { a: food('a', 'Milk', { shelfLifeDays: 0 }) },
      templates: { Milk: tmpl('Milk', -3), Bread: tmpl('Bread', 1.5) }
    });
    expect(result.toCatalog).toEqual([]);
    expect(result.toTemplates).toEqual([]);
    expect(result.newFoods).toEqual([]);
  });

  it('survives entries with no name or id', () => {
    const result = reconcileShelfLives({
      catalog: { a: { id: 'a' }, b: { name: 'Nameless' }, c: null },
      templates: { '': tmpl('', 5) }
    });
    expect(result.toCatalog).toEqual([]);
    expect(result.newFoods).toEqual([]);
  });
});

describe('fridgeFoodId', () => {
  it('is stable, so the same food learned twice cannot become two entries', () => {
    expect(fridgeFoodId('Leftover pizza')).toBe(fridgeFoodId('Leftover pizza'));
    expect(fridgeFoodId('Leftover pizza')).toBe('fridge-leftover-pizza');
  });

  it('survives the characters Firebase refuses in a key', () => {
    expect(fridgeFoodId('Dr. Pepper')).not.toMatch(/[.$#[\]/]/);
  });
});
