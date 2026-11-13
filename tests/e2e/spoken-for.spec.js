const { test, expect } = require('@playwright/test');
const { setupAuthAndDisableTutorial, navigateDirectly } = require('./test-utils.js');

// Today's idea must not use the food the week's meals are counting on. The
// wall makes the idea and cannot read the schedule, so the signed-in app
// publishes what the coming week holds back under the fridge
// (src/store/fridge/spokenFor.js). This checks the publish, through the real
// rules, and that it follows the schedule as it changes.
//
// Seeding order as in mirror-feed-refresh: sign in first so the app creates
// the hat WITH its members, then seed over the owner REST API and reload.
const DB = 'http://localhost:9000';
const NS = '?ns=meal-hat-default-rtdb';
const OWNER = { Authorization: 'Bearer owner' };
const HAT = 'test-example-com';
const KEY = 'spokenfortestfridgekey0123456789abc';

const isoIn = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function put (request, path, data) {
  const response = await request.put(`${DB}/${path}.json${NS}`, {
    headers: { ...OWNER, 'Content-Type': 'application/json' },
    data: JSON.stringify(data)
  });
  expect(response.ok(), `seeding ${path}`).toBe(true);
}

async function heldBack (request) {
  const response = await request.get(`${DB}/fridge/${KEY}/spokenFor/days.json${NS}`, { headers: OWNER });
  const days = (await response.json()) || {};
  return Object.keys(days).sort().flatMap((date) =>
    Object.values(days[date])
      .filter((food) => food.name.startsWith('SF '))
      .map((food) => `${date} ${food.name} ${food.packages}`).sort());
}

test('the week\'s meals tell the fridge what they need', async ({ page, request }) => {
  await page.setViewportSize({ width: 402, height: 850 });
  await setupAuthAndDisableTutorial(page);
  await navigateDirectly(page, '/');
  await page.waitForSelector('.drawn-meals-schedule', { timeout: 15000 });

  // Only this test's own rows: other spec files share the tester's hat.
  await put(request, `${HAT}/drawnMeals/sf-a`, null);
  await put(request, `${HAT}/drawnMeals/sf-b`, null);
  await put(request, `fridge/${KEY}`, { templates: { 'SF Chicken': { title: 'SF Chicken', days: 3 } } });
  await put(request, `${HAT}/grocery-catalog/sf-chicken`, { id: 'sf-chicken', name: 'SF Chicken', packageSize: 2 });
  await put(request, `${HAT}/grocery-catalog/sf-tortillas`, { id: 'sf-tortillas', name: 'SF Tortillas', packageSize: 10 });
  await put(request, `${HAT}/meals/sf-tacos`, {
    id: 'sf-tacos',
    name: 'Tacos',
    minDaysBetween: 14,
    ingredients: [{ groceryItemId: 'sf-chicken', quantity: 2 }, { groceryItemId: 'sf-tortillas', quantity: 5 }]
  });
  await put(request, `${HAT}/drawnMeals/sf-a`, { id: 'sf-a', mealId: 'sf-tacos', assignedDate: isoIn(1) });
  // Beyond the week: holds nothing.
  await put(request, `${HAT}/drawnMeals/sf-b`, { id: 'sf-b', mealId: 'sf-tacos', assignedDate: isoIn(9) });
  await put(request, `${HAT}/fridgeKey`, KEY);

  await page.reload();
  await page.waitForSelector('.schedule-meal', { timeout: 15000 });

  await expect.poll(() => heldBack(request), { timeout: 10000 })
    .toEqual([`${isoIn(1)} SF Chicken 1`, `${isoIn(1)} SF Tortillas 0.5`]);

  // Moved somewhere else (another phone, Enjoy Cooking): it follows.
  await put(request, `${HAT}/drawnMeals/sf-a/assignedDate`, isoIn(3));
  await expect.poll(() => heldBack(request), { timeout: 10000 })
    .toEqual([`${isoIn(3)} SF Chicken 1`, `${isoIn(3)} SF Tortillas 0.5`]);

  // Taken off the schedule: nothing is held back.
  await put(request, `${HAT}/drawnMeals/sf-a`, null);
  await expect.poll(() => heldBack(request), { timeout: 10000 }).toEqual([]);

  await put(request, `${HAT}/drawnMeals/sf-b`, null);
  await put(request, `${HAT}/fridgeKey`, null);
  await put(request, `fridge/${KEY}`, null);
});
