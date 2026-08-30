import { describe, it, expect } from 'vitest';
import { planMealConsumption } from '../../../src/store/fridge/consume';

const meal = (...ingredients) => ({ name: 'Test meal', ingredients });
const timer = (id, title, expiryDate, quantity) => [id, { title, expiryDate, quantity }];
const timers = (...entries) => Object.fromEntries(entries);

describe('planMealConsumption', () => {
  it('eats exactly one can of a 28-unit tomato sauce', () => {
    // THE CASE THAT MOTIVATED packageSize. The meal says 28 and the catalog
    // calls the unit "can", but 28 is ounces. Without a package size this
    // subtracts 28 from a timer holding 1 and clears a can that was the right
    // size to begin with.
    const plan = planMealConsumption({
      meal: meal({ groceryItemId: 'g1', quantity: 28 }),
      catalog: { g1: { id: 'g1', name: 'Tomato Sauce', defaultUnits: 'can', packageSize: 28 } },
      timers: timers(timer('t1', 'Tomato Sauce', '2026-09-10', 1))
    });

    expect(plan.uses).toHaveLength(1);
    expect(plan.uses[0]).toMatchObject({ timerId: 't1', before: 1, after: 0, clears: true });
    expect(plan.missing).toEqual([]);
  });

  it('takes a fraction of a package when the recipe wants less than one', () => {
    // 13 oz of ricotta out of a 15 oz tub.
    const plan = planMealConsumption({
      meal: meal({ groceryItemId: 'g1', quantity: 13 }),
      catalog: { g1: { id: 'g1', name: 'Ricotta', defaultUnits: 'Oz', packageSize: 15 } },
      timers: timers(timer('t1', 'Ricotta', '2026-09-10', 1))
    });

    expect(plan.uses[0].after).toBeCloseTo(0.133, 3);
    expect(plan.uses[0].clears).toBe(false);
  });

  it('leaves package-counted foods alone — they already worked', () => {
    const plan = planMealConsumption({
      meal: meal({ groceryItemId: 'g1', quantity: 1 }),
      catalog: { g1: { id: 'g1', name: 'Orzo', defaultUnits: 'Box', packageSize: 1 } },
      timers: timers(timer('t1', 'Orzo', '2026-09-10', 2))
    });
    expect(plan.uses[0]).toMatchObject({ before: 2, after: 1, clears: false });
  });

  it('spends the soonest-expiring package first', () => {
    // Fridge order. Using the newest carton while an older one goes off is
    // exactly backwards.
    const plan = planMealConsumption({
      meal: meal({ groceryItemId: 'g1', quantity: 1 }),
      catalog: { g1: { id: 'g1', name: 'Eggs', packageSize: 1 } },
      timers: timers(
        timer('new', 'Eggs', '2026-12-01', 1),
        timer('old', 'Eggs', '2026-09-01', 1)
      )
    });
    expect(plan.uses[0].timerId).toBe('old');
  });

  it('spreads across packages when one is not enough', () => {
    const plan = planMealConsumption({
      meal: meal({ groceryItemId: 'g1', quantity: 3 }),
      catalog: { g1: { id: 'g1', name: 'Eggs', packageSize: 1 } },
      timers: timers(
        timer('a', 'Eggs', '2026-09-01', 2),
        timer('b', 'Eggs', '2026-10-01', 5)
      )
    });
    expect(plan.uses.map((u) => [u.timerId, u.after])).toEqual([['a', 0], ['b', 4]]);
    expect(plan.clearing).toBe(1);
  });

  it('clamps at zero and reports the shortfall rather than going negative', () => {
    const plan = planMealConsumption({
      meal: meal({ groceryItemId: 'g1', quantity: 5 }),
      catalog: { g1: { id: 'g1', name: 'Eggs', packageSize: 1 } },
      timers: timers(timer('a', 'Eggs', '2026-09-01', 2))
    });
    expect(plan.uses[0].after).toBe(0);
    expect(plan.missing).toEqual([
      { groceryId: 'g1', name: 'Eggs', needed: 5, short: true, units: '' }
    ]);
  });

  it('reports a food the fridge has never seen, and touches nothing', () => {
    // No timer is NOT evidence you lack the food — nothing may have been
    // photographed. Same rule as the scan flow: absence never acts.
    const plan = planMealConsumption({
      meal: meal({ groceryItemId: 'g1', quantity: 1 }),
      catalog: { g1: { id: 'g1', name: 'Saffron', packageSize: 1 } },
      timers: {}
    });
    expect(plan.uses).toEqual([]);
    expect(plan.missing[0]).toMatchObject({ name: 'Saffron' });
  });

  it('assumes one package when no size is recorded, and flags the guess', () => {
    // 24 Cottage cheese with no unit and no package size. Assuming a whole tub
    // is the only sane default, but it is a guess that may clear a timer, so it
    // has to be visible before it happens.
    const plan = planMealConsumption({
      meal: meal({ groceryItemId: 'g1', quantity: 24 }),
      catalog: { g1: { id: 'g1', name: 'Cottage cheese' } },
      timers: timers(timer('t1', 'Cottage cheese', '2026-09-10', 1))
    });
    expect(plan.uses[0]).toMatchObject({ after: 0, clears: true, assumedPackageSize: true });
    expect(plan.assuming).toBe(1);
  });

  it('treats a timer with no quantity as holding one package', () => {
    // Every one of the 42 timers migrated from Perishable is in this state.
    const plan = planMealConsumption({
      meal: meal({ groceryItemId: 'g1', quantity: 1 }),
      catalog: { g1: { id: 'g1', name: 'Butter', packageSize: 1 } },
      timers: timers(['t1', { title: 'Butter', expiryDate: '2026-09-10' }])
    });
    expect(plan.uses[0]).toMatchObject({ before: 1, after: 0, clears: true });
  });

  it('does not leave a sliver of a package behind', () => {
    // 0.1 + 0.2 arithmetic would strand 1e-16 of a package, which reads as
    // "still have some" and never clears.
    const plan = planMealConsumption({
      meal: meal({ groceryItemId: 'g1', quantity: 0.3 }),
      catalog: { g1: { id: 'g1', name: 'Cream', packageSize: 0.1 } },
      timers: timers(timer('t1', 'Cream', '2026-09-10', 3))
    });
    expect(plan.uses[0].after).toBe(0);
    expect(plan.uses[0].clears).toBe(true);
  });

  it('matches the fridge\'s name casing', () => {
    const plan = planMealConsumption({
      meal: meal({ groceryItemId: 'g1', quantity: 1 }),
      catalog: { g1: { id: 'g1', name: 'Cheddar Cheese', packageSize: 1 } },
      timers: timers(timer('t1', 'cheddar cheese', '2026-09-10', 1))
    });
    expect(plan.uses).toHaveLength(1);
  });

  it('skips junk ingredients instead of throwing', () => {
    const plan = planMealConsumption({
      meal: meal(
        { groceryItemId: 'nope', quantity: 1 },
        { groceryItemId: 'g1', quantity: 0 },
        { groceryItemId: 'g1' },
        null
      ),
      catalog: { g1: { id: 'g1', name: 'Eggs', packageSize: 1 } },
      timers: timers(timer('t1', 'Eggs', '2026-09-10', 1))
    });
    expect(plan.uses).toEqual([]);
    expect(plan.missing).toEqual([]);
  });

  it('handles a meal with nothing in it', () => {
    expect(planMealConsumption({}).uses).toEqual([]);
    expect(planMealConsumption({ meal: { ingredients: [] } }).missing).toEqual([]);
  });
});
