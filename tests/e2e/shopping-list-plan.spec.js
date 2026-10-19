const { test, expect } = require('@playwright/test');
const { setupAuthAndDisableTutorial, navigateDirectly } = require('./test-utils.js');

// The shopping list is worked out when it is OPENED (src/store/shoppingPlan.js).
//
// Matt, 2026-10-11: "one side is what we have, one side is what we need"; "it
// shouldn't matter what order I do this in"; and "sometimes I just open the
// list because I just got to the store ... we don't reset things just because
// I've opened it twice." This drives all three on a seeded hat, at his
// phone's width.
//
// Same seeding order as schedule-row-fits: sign in first so the app creates
// (and claims) the hat, then seed with the emulator's owner token.
const DB = 'http://localhost:9000';
const NS = '?ns=meal-hat-default-rtdb';
const OWNER = { Authorization: 'Bearer owner' };
const HAT = 'test-example-com';
const FRIDGE = 'e2eplanfridgekey0123456789abcdef';

const isoIn = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const at = (days) => new Date(Date.now() + days * 864e5).toISOString();

const put = (request, path, data) =>
  request.put(`${DB}/${path}.json${NS}`, { headers: OWNER, data });

async function seed (request) {
  await put(request, `${HAT}/grocery-catalog`, {
    buns: { id: 'buns', name: 'Hamburger Buns', defaultUnits: 'buns', defaultAisle: 3, packageSize: 8 },
    beef: { id: 'beef', name: 'Beef patties', defaultUnits: 'patties', defaultAisle: 7, packageSize: 4 },
    coke: { id: 'coke', name: 'Diet coke', defaultUnits: 'Case', defaultAisle: 9, staple: true, lastPurchased: isoIn(-6) },
    ketchup: { id: 'ketchup', name: 'Ketchup', defaultUnits: 'Bottle', defaultAisle: 4 }
  });
  await put(request, `${HAT}/meals/burgers`, {
    id: 'burgers',
    name: 'Hamburgers',
    minDaysBetween: 14,
    ingredients: [{ groceryItemId: 'buns', quantity: 8 }, { groceryItemId: 'beef', quantity: 4 }]
  });
  await put(request, `${HAT}/drawnMeals`, {
    eaten: { id: 'eaten', mealId: 'burgers', assignedDate: isoIn(-2) },
    soon: { id: 'soon', mealId: 'burgers', assignedDate: isoIn(1) }
  });
  // Diet Coke: ten counted a week ago, three counted yesterday — a can a day.
  await put(request, `${HAT}/usage-log`, {
    coke: { [isoIn(-8)]: { count: 10 }, [isoIn(-1)]: { count: 3 } }
  });
  // What the list looked like on 2026-10-11: a meal row left over from a meal
  // already eaten, a talk-through's running-low guess, and a row ticked off
  // on an earlier trip. All three should go; his own open ketchup stays.
  await put(request, `${HAT}/shopping-list`, {
    'old-uuid': { id: 'old-uuid', groceryId: 'beef', quantity: 11, source: 'meal', purchased: false },
    'old-guess': { id: 'old-guess', groceryId: 'ketchup', quantity: 1, source: 'manual', purchased: false, runningLow: { runsOutOn: isoIn(-4) } },
    'last-trip': { id: 'last-trip', groceryId: 'coke', quantity: 1, source: 'manual', purchased: true },
    mine: { id: 'mine', groceryId: 'ketchup', quantity: 1, units: 'Bottle', aisle: 4, source: 'manual', purchased: false }
  });
  // The kitchen: a full bag of buns, said this week.
  // JSON-quoted: Playwright sends a bare string as raw text, which the
  // database rejects, and the hat silently has no fridge.
  await put(request, `${HAT}/fridgeKey`, JSON.stringify(FRIDGE));
  await put(request, `fridge/${FRIDGE}/timers`, {
    t1: { title: 'Hamburger Buns', quantity: 1, expiryDate: at(5), createdAt: at(-1) }
  });
}

const names = (page, selector) =>
  page.locator(selector).evaluateAll((els) => els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()));

test.describe('the shopping list, worked out on open', () => {
  test.describe.configure({ mode: 'serial' });

  test('need minus have, regulars on cadence, and opening twice resets nothing', async ({ page, request }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await setupAuthAndDisableTutorial(page);
    await navigateDirectly(page, '/');
    await page.waitForSelector('.drawn-meals-schedule', { timeout: 15000 });
    await seed(request);

    await navigateDirectly(page, '/shopping-list');
    await page.locator('.shepherd-cancel-icon').click({ timeout: 2000 }).catch(() => {});
    await expect(page.locator('.planned-line')).toContainText('Worked out at', { timeout: 15000 });

    const toBuy = await names(page, '.list-group[data-step="2"] > li .fw-bold');
    expect(toBuy.some((t) => t.startsWith('Beef patties'))).toBe(true);
    expect(toBuy.some((t) => t.startsWith('Diet coke') && t.includes('running low'))).toBe(true);
    expect(toBuy.some((t) => t.startsWith('Ketchup'))).toBe(true);
    // The kitchen has the buns.
    expect(toBuy.some((t) => t.startsWith('Hamburger Buns'))).toBe(false);
    await expect(page.locator('.cupboard-toggle')).toContainText('Already have (1)');

    // The stored list is clean: fixed ids, nothing stale, his row untouched.
    const stored = await (await request.get(`${DB}/${HAT}/shopping-list.json${NS}`, { headers: OWNER })).json();
    expect(Object.keys(stored).sort()).toEqual(['meal-beef', 'meal-buns', 'mine', 'stock-coke']);
    expect(stored['meal-beef'].quantity).toBe(4);

    await page.screenshot({ path: 'test-results/shopping-list-plan.png', fullPage: true });

    // At the store: tick the beef, then open the list again.
    const beef = page.locator('.list-group[data-step="2"] > li').filter({ hasText: 'Beef patties' });
    await beef.locator('button[title="Got it"]').click();
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.locator('.planned-line')).toContainText('Worked out at', { timeout: 15000 });

    const after = await names(page, '.list-group[data-step="2"] > li .fw-bold');
    expect(after.some((t) => t.startsWith('Beef patties'))).toBe(false);
    await expect(page.locator('.purchased-toggle')).toContainText('Bought (1)');
    const again = await (await request.get(`${DB}/${HAT}/shopping-list.json${NS}`, { headers: OWNER })).json();
    expect(again['meal-beef'].purchased).toBe(true);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, 'the page must not scroll sideways').toBe(false);
  });

  // Matt, 2026-10-11: "a section at the top of items that ... Meal Hat thinks
  // we maybe should include, and then I can approve or not ... I don't want
  // you to just guess and add them automatically."
  test('maybe add these: offered, written only on an answer, yes makes a staple', async ({ page, request }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await setupAuthAndDisableTutorial(page);
    await navigateDirectly(page, '/');
    await page.waitForSelector('.drawn-meals-schedule', { timeout: 15000 });

    await put(request, `${HAT}/grocery-catalog`, {
      seltzer: { id: 'seltzer', name: 'Lime seltzer, the big twelve-pack', defaultUnits: 'Case', defaultAisle: 9 },
      bread: { id: 'bread', name: 'Sandwich Bread', defaultUnits: 'Loaf', defaultAisle: 2 },
      oil: { id: 'oil', name: 'Olive Oil', staple: true, lastPurchased: isoIn(-3) }
    });
    await put(request, `${HAT}/drawnMeals`, null);
    await put(request, `${HAT}/shopping-list`, null);
    await put(request, `${HAT}/usage-log`, {
      // A can a day, three left: runs out this week.
      seltzer: { [isoIn(-8)]: { count: 10 }, [isoIn(-1)]: { count: 3 } },
      // Added by hand three times lately.
      bread: { [isoIn(-80)]: { bought: 'manual' }, [isoIn(-73)]: { bought: 'manual' }, [isoIn(-66)]: { bought: 'manual' } }
    });

    await navigateDirectly(page, '/shopping-list');
    await page.locator('.shepherd-cancel-icon').click({ timeout: 2000 }).catch(() => {});
    await expect(page.locator('.planned-line')).toContainText('Worked out at', { timeout: 15000 });

    const box = page.locator('.regular-suggestions');
    await expect(box).toContainText('Maybe add these?');
    await expect(box.locator('li')).toHaveCount(2);
    await expect(box.locator('li').first()).toContainText('Lime seltzer');
    await expect(box).not.toContainText('Olive Oil');

    // Nothing was written just by showing them.
    const listBefore = await (await request.get(`${DB}/${HAT}/shopping-list.json${NS}`, { headers: OWNER })).json();
    expect(listBefore).toBeNull();

    await page.screenshot({ path: 'test-results/shopping-list-suggestions.png', fullPage: true });
    const rowsOverflow = await box.locator('li').evaluateAll((els) => els.some((el) => el.scrollWidth > el.getBoundingClientRect().width + 0.5));
    expect(rowsOverflow, 'a suggestion row must fit a phone').toBe(false);

    await box.locator('li').filter({ hasText: 'Sandwich Bread' }).getByRole('button', { name: /^No/ }).click();
    await box.locator('li').filter({ hasText: 'Lime seltzer' }).getByRole('button', { name: /^Yes/ }).click();
    await expect(box).toHaveCount(0);

    await expect.poll(async () => (await (await request.get(`${DB}/${HAT}/grocery-catalog.json${NS}`, { headers: OWNER })).json()).seltzer.staple).toBe(true);
    const catalog = await (await request.get(`${DB}/${HAT}/grocery-catalog.json${NS}`, { headers: OWNER })).json();
    expect(catalog.bread.regularDeclinedOn).toBe(isoIn(0));
    expect(catalog.bread.staple).toBeFalsy();
    expect(catalog.seltzer.name).toBe('Lime seltzer, the big twelve-pack');

    await expect.poll(async () => {
      const list = await (await request.get(`${DB}/${HAT}/shopping-list.json${NS}`, { headers: OWNER })).json();
      return Object.values(list || {}).filter((row) => row.groceryId === 'seltzer' && !row.purchased).length;
    }).toBe(1);

    // Open it again: still one seltzer row, and the box stays empty.
    await page.reload();
    await expect(page.locator('.planned-line')).toContainText('Worked out at', { timeout: 15000 });
    await expect(page.locator('.regular-suggestions')).toHaveCount(0);
    const list = await (await request.get(`${DB}/${HAT}/shopping-list.json${NS}`, { headers: OWNER })).json();
    expect(Object.values(list).filter((row) => row.groceryId === 'seltzer')).toHaveLength(1);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, 'the page must not scroll sideways').toBe(false);
  });

  // Matt, 2026-10-18: "I clearly say two bags of shredded mozzarella, and
  // every week you add mozzarella to the list." The bags were counted; the
  // meals ahead wanted more than two 2-cup bags hold, and the row said the
  // whole 5 cups. It says what is still to buy now, and shows the sum.
  test('partly in the house: the row asks for the shortfall, at phone width', async ({ page, request }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await setupAuthAndDisableTutorial(page);
    await navigateDirectly(page, '/');
    await page.waitForSelector('.drawn-meals-schedule', { timeout: 15000 });

    await put(request, `${HAT}/grocery-catalog`, {
      mozz: { id: 'mozz', name: 'Mozzarella', defaultUnits: 'cups', defaultAisle: 3, defaultLocation: 'downstairs', packageSize: 2 }
    });
    await put(request, `${HAT}/meals`, {
      ziti: { id: 'ziti', name: 'Baked ziti', minDaysBetween: 14, ingredients: [{ groceryItemId: 'mozz', quantity: 2 }] },
      pizza: { id: 'pizza', name: 'Homemade Pizza', minDaysBetween: 14, ingredients: [{ groceryItemId: 'mozz', quantity: 3 }] }
    });
    await put(request, `${HAT}/drawnMeals`, {
      a: { id: 'a', mealId: 'ziti', assignedDate: isoIn(2) },
      b: { id: 'b', mealId: 'pizza', assignedDate: isoIn(4) }
    });
    await put(request, `${HAT}/usage-log`, null);
    await put(request, `${HAT}/shopping-list`, null);
    await put(request, `${HAT}/fridgeKey`, JSON.stringify(FRIDGE));
    await put(request, `fridge/${FRIDGE}/timers`, {
      t1: { title: 'Mozzarella', quantity: 2, expiryDate: at(5), createdAt: at(-1) }
    });

    await navigateDirectly(page, '/shopping-list');
    await page.locator('.shepherd-cancel-icon').click({ timeout: 2000 }).catch(() => {});
    await expect(page.locator('.planned-line')).toContainText('Worked out at', { timeout: 15000 });

    const mozz = page.locator('.list-group[data-step="2"] > li').filter({ hasText: 'Mozzarella' });
    await expect(mozz).toContainText('1 more package');
    await expect(mozz).toContainText('you have 2 packages (4 cups), meals need 5 cups');
    // The amount on the right is the shortfall, not the meals' whole 5 cups.
    await expect(mozz.locator('.justify-content-between').first().locator(':scope > span').last()).toHaveText('1 more package');

    await mozz.screenshot({ path: 'test-results/shopping-list-partly.png' });
    const fits = await mozz.evaluate((li) => [li, ...li.querySelectorAll('*')]
      .every((el) => el.scrollWidth <= Math.ceil(el.getBoundingClientRect().width) + 1 || getComputedStyle(el).overflow !== 'visible'));
    expect(fits, 'nothing in the row overflows').toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, 'the page must not scroll sideways').toBe(false);
  });
});
