const { test, expect } = require('@playwright/test');
const { setupAuthAndDisableTutorial, navigateDirectly } = require('./test-utils.js');

// "Made it" can fix the guess it warns about.
//
// The sheet used to say "this assumes a whole package" with nowhere to say
// otherwise: the only package-size field was the shopping list's pencil, and a
// food you just cooked from is in the house, so it is rarely on the list. Now a
// guessed row carries the field, the plan redraws as the number goes in, and
// the number is saved on the food — only that one field.
//
// Seeded after the app has created the hat, for the reason in
// schedule-row-fits.spec.js.
const DB = 'http://localhost:9000';
const NS = '?ns=meal-hat-default-rtdb';
const OWNER = { Authorization: 'Bearer owner' };
const HAT = 'test-example-com';
const FRIDGE_KEY = 'madeitpackagesizetestfridgekey0001';

const isoIn = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

test('a guessed package size can be filled in from the "Made it" sheet', async ({ page, request }) => {
  await page.setViewportSize({ width: 402, height: 850 });
  await setupAuthAndDisableTutorial(page);
  await navigateDirectly(page, '/');
  await page.waitForSelector('.drawn-meals-schedule', { timeout: 15000 });

  const put = (path, data) => request.put(`${DB}/${path}.json${NS}`, { headers: OWNER, data });
  await put(`${HAT}/grocery-catalog/pkg-cottage`, {
    id: 'pkg-cottage', name: 'Cottage cheese', defaultUnits: 'oz', defaultAisle: 3, note: 'small curd'
  });
  await put(`${HAT}/meals/pkg-meal`, {
    id: 'pkg-meal',
    name: 'Lasagna',
    minDaysBetween: 14,
    ingredients: [{ groceryItemId: 'pkg-cottage', quantity: 24 }]
  });
  await put(`${HAT}/drawnMeals/pkg-drawn`, { id: 'pkg-drawn', mealId: 'pkg-meal', assignedDate: isoIn(0) });
  await put(`fridge/${FRIDGE_KEY}/timers/pkg-timer`, {
    title: 'Cottage cheese', expiryDate: isoIn(5), quantity: 2
  });
  // A bare string body is sent raw, which is not JSON; quote it.
  await put(`${HAT}/fridgeKey`, JSON.stringify(FRIDGE_KEY));

  await page.reload();
  await page.waitForSelector('.schedule-meal', { timeout: 15000 });
  await page.locator('.shepherd-cancel-icon').click({ timeout: 2000 }).catch(() => {});

  // Other spec files seed rows into the same test hat, so stay on this one.
  const row = page.locator('.schedule-meal', { hasText: 'Lasagna' });
  await row.click();
  await row.locator('.made-button').click();

  const sheet = page.locator('.cooked-sheet');
  // The fridge's timers can land after the sheet opens; the sheet keeps up.
  await expect(sheet.locator('.cooked-guess')).toHaveText('guess', { timeout: 15000 });
  await expect(sheet.locator('.cooked-change')).toHaveText('2 → 1');
  await expect(sheet).toContainText('This meal uses 24 oz.');

  const field = sheet.locator('.cooked-size input');
  await field.fill('32');
  // Redrawn as typed, before anything is saved: 24 of a 32 oz tub.
  await expect(sheet.locator('.cooked-change')).toHaveText('2 → 1.25');
  await expect(sheet.locator('.cooked-warn')).toHaveCount(0);
  // The field stays put once the row is exact, so it can still be corrected.
  await expect(field).toBeVisible();

  const fits = await sheet.evaluate((el) => ({
    sheet: el.scrollWidth <= Math.round(el.getBoundingClientRect().width) + 1,
    page: document.documentElement.scrollWidth <= document.documentElement.clientWidth
  }));
  expect(fits, 'the sheet fits a 402px phone').toEqual({ sheet: true, page: true });
  await page.screenshot({ path: 'test-results/made-it-package-size.png' });

  await field.blur();
  await expect.poll(async () => (await (await request.get(
    `${DB}/${HAT}/grocery-catalog/pkg-cottage.json${NS}`, { headers: OWNER }
  )).json()), { timeout: 5000 }).toEqual({
    // Only packageSize changed; the rest of the entry is untouched.
    id: 'pkg-cottage', name: 'Cottage cheese', defaultUnits: 'oz', defaultAisle: 3, note: 'small curd', packageSize: 32
  });

  // Clearing it goes back to unknown, the pencil editor's rule.
  await field.fill('');
  await field.blur();
  await expect.poll(async () => (await (await request.get(
    `${DB}/${HAT}/grocery-catalog/pkg-cottage/packageSize.json${NS}`, { headers: OWNER }
  )).json()), { timeout: 5000 }).toBeNull();
  await expect(sheet.locator('.cooked-change')).toHaveText('2 → 1');
});
