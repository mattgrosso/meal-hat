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
});
