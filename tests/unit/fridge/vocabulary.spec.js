import { describe, it, expect } from 'vitest';
import { knownFoodNames, MAX_KNOWN_FOODS } from '../../../src/store/fridge/vocabulary';

const catalog = {
  g1: { id: 'g1', name: 'Rotini or Farfalle' },
  g2: { id: 'g2', name: 'Cheddar Cheese' },
  g3: { id: 'g3', name: 'Rice' },
  g4: { id: 'g4', name: 'Quince' }
};

const templates = [
  { title: 'Cheddar Cheese', days: 74 },
  { title: 'Frozen Spinach', days: 240 }
];

describe('knownFoodNames', () => {
  // THE CASE THAT MOTIVATED THIS. A spoken "box of rotini" came back as
  // "Rotini Pasta" and matched nothing, because only the fridge's templates
  // were ever sent — and the catalog, which the shopping list joins on, calls
  // it "Rotini or Farfalle" and has it on this week's list.
  it('puts what is on the shopping list first', () => {
    const shoppingList = {
      r1: { groceryId: 'g1', quantity: 1 },
      r2: { groceryId: 'g3', quantity: 1 }
    };
    const names = knownFoodNames({ templates, catalog, shoppingList });
    expect(names.slice(0, 2)).toEqual(['Rotini or Farfalle', 'Rice']);
  });

  it('includes pantry foods the fridge has never heard of', () => {
    // Rice has no template — it never goes off — and saying "we've got rice"
    // is precisely the kind of thing that should stop it being bought.
    expect(knownFoodNames({ templates, catalog })).toContain('Rice');
  });

  it('still carries the templates, which are where shelf lives come from', () => {
    expect(knownFoodNames({ templates, catalog })).toContain('Frozen Spinach');
  });

  it('says each name once, however many places it appears in', () => {
    const shoppingList = { r1: { groceryId: 'g2' } };
    const names = knownFoodNames({ templates, catalog, shoppingList });
    expect(names.filter((n) => n.toLowerCase() === 'cheddar cheese').length).toBe(1);
  });

  it('ignores a row already bought — it is not what to reduce', () => {
    const shoppingList = { r1: { groceryId: 'g1', purchased: true } };
    const names = knownFoodNames({ templates, catalog, shoppingList });
    expect(names[0]).not.toBe('Rotini or Farfalle');
  });

  it('drops a name the endpoint would reject, rather than losing the list to it', () => {
    // The endpoint 400s the WHOLE list over one empty or overlong name, and a
    // catalog with one bad row must not cost the household its vocabulary.
    const bad = { ...catalog, g5: { name: '' }, g6: { name: 'x'.repeat(61) }, g7: {} };
    const names = knownFoodNames({ templates, catalog: bad });
    expect(names.every((n) => n.length > 0 && n.length <= 60)).toBe(true);
    expect(names).toContain('Quince');
  });

  it('stays inside the endpoint\'s cap', () => {
    const big = {};
    for (let i = 0; i < 400; i += 1) big[`g${i}`] = { name: `Food ${i}` };
    expect(knownFoodNames({ catalog: big }).length).toBe(MAX_KNOWN_FOODS);
  });

  it('works for the wall tablet, which cannot read the catalog at all', () => {
    expect(knownFoodNames({ templates })).toEqual(['Cheddar Cheese', 'Frozen Spinach']);
  });

  it('is empty rather than broken with nothing to go on', () => {
    expect(knownFoodNames()).toEqual([]);
    expect(knownFoodNames({ templates: null, catalog: null, shoppingList: null })).toEqual([]);
  });
});
