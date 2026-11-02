const { test, expect } = require('@playwright/test');
const { setupAuthAndDisableTutorial, navigateDirectly } = require('./test-utils.js');

// The Magic Mirror must follow the schedule, not just the draw.
//
// Bug report (2026-11-02, Matt): "on the magic mirror it's saying tonight
// we're supposed to have pesto pasta, but here on the app it says tortellini
// soup." Only a draw and a hand-placed meal republished the mirror's feed, so
// swapping two nights or deleting one left the mirror on the old plan.
//
// Seeding order as in schedule-row-fits: sign in first so the app creates the
// hat WITH its members, then seed over the owner REST API and reload.
const DB = 'http://localhost:9000';
const NS = '?ns=meal-hat-default-rtdb';
const OWNER = { Authorization: 'Bearer owner' };
const HAT = 'test-example-com';
const SECRET = 'mirrortestsecret0123456789abcdef';

const isoIn = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function put (request, path, data) {
  // Serialised by hand: Playwright sends a bare string as-is, which is not
  // JSON, and the emulator refuses it.
  const response = await request.put(`${DB}/${path}.json${NS}`, {
    headers: { ...OWNER, 'Content-Type': 'application/json' },
    data: JSON.stringify(data)
  });
  expect(response.ok(), `seeding ${path}`).toBe(true);
}

async function mirrorShows (request) {
  const response = await request.get(`${DB}/mirrorFeed/${HAT}/${SECRET}.json${NS}`, { headers: OWNER });
  const feed = await response.json();
  return (feed?.upcoming || []).map((row) => `${row.assignedDate} ${row.meal.name}`);
}

async function homeWithTwoNights (page, request) {
  await page.setViewportSize({ width: 402, height: 850 });
  await setupAuthAndDisableTutorial(page);
  await navigateDirectly(page, '/');
  await page.waitForSelector('.drawn-meals-schedule', { timeout: 15000 });

  // Wipe whatever an earlier test left on the schedule.
  await put(request, `${HAT}/drawnMeals`, null);
  await put(request, `mirrorFeed/${HAT}`, null);
  await put(request, `${HAT}/meals/mirror-pesto`, { id: 'mirror-pesto', name: 'Pesto Pasta', minDaysBetween: 14, ingredients: [] });
  await put(request, `${HAT}/meals/mirror-soup`, { id: 'mirror-soup', name: 'Tortellini Soup', minDaysBetween: 14, ingredients: [] });
  await put(request, `${HAT}/drawnMeals/mirror-a`, { id: 'mirror-a', mealId: 'mirror-pesto', assignedDate: isoIn(0) });
  await put(request, `${HAT}/drawnMeals/mirror-b`, { id: 'mirror-b', mealId: 'mirror-soup', assignedDate: isoIn(1) });
  await put(request, `${HAT}/mirrorFeedKey`, SECRET);

  await page.reload();
  await page.waitForSelector('.schedule-meal', { timeout: 15000 });
  await page.locator('.shepherd-cancel-icon').click({ timeout: 2000 }).catch(() => {});

  // Opening the app with a feed key publishes the schedule as it stands.
  await expect.poll(() => mirrorShows(request), { timeout: 10000 })
    .toEqual([`${isoIn(0)} Pesto Pasta`, `${isoIn(1)} Tortellini Soup`]);
}

test.describe('the Magic Mirror feed follows the schedule', () => {
  test.describe.configure({ mode: 'serial' });

  test('swapping two nights on the schedule republishes it', async ({ page, request }) => {
    await homeWithTwoNights(page, request);

    const grips = page.locator('.schedule-meal .bi-grip-vertical');
    await grips.nth(1).dragTo(grips.nth(0));

    await expect(page.locator('.schedule-meal').first()).toContainText('Tortellini Soup', { timeout: 5000 });
    await expect.poll(() => mirrorShows(request), { timeout: 10000 })
      .toEqual([`${isoIn(0)} Tortellini Soup`, `${isoIn(1)} Pesto Pasta`]);
  });

  test('deleting a night republishes it', async ({ page, request }) => {
    await homeWithTwoNights(page, request);

    const tonight = page.locator('.schedule-meal').filter({ hasText: 'Pesto Pasta' });
    await tonight.click();
    await page.waitForTimeout(400);
    await tonight.locator('.delete-button').click();
    await page.locator('.modal .btn-primary', { hasText: 'Remove it' }).click();

    await expect.poll(() => mirrorShows(request), { timeout: 10000 })
      .toEqual([`${isoIn(1)} Tortellini Soup`]);
  });

  // Enjoy Cooking moves nights for lessons, and another phone can swap them;
  // neither runs this device's swap code. The drawnMeals listener has to
  // carry those to the mirror too.
  test('a change made somewhere else reaches the mirror', async ({ page, request }) => {
    await homeWithTwoNights(page, request);

    await put(request, `${HAT}/drawnMeals/mirror-a/assignedDate`, isoIn(2));

    await expect.poll(() => mirrorShows(request), { timeout: 10000 })
      .toEqual([`${isoIn(1)} Tortellini Soup`, `${isoIn(2)} Pesto Pasta`]);
  });
});
