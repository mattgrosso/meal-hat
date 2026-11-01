const { test, expect } = require('@playwright/test');
const { setupAuthAndDisableTutorial, navigateDirectly } = require('./test-utils.js');

// Looking over the last talk-through, and saying what it got wrong.
//
// Matt, 2026-11-01: the read-through keeps missing things and he could not
// tell why. Each run is now kept in the hat; the fridge screen reopens the
// newest, each row quotes what he said, and "Not right" leaves a lesson for
// the reader and takes a wrong card off the fridge. The "You missed..." box
// calls the reader for real, so it is covered by the unit tests instead.
//
// Seeded after the app has created the hat, for the reason in
// schedule-row-fits.spec.js.
const DB = 'http://localhost:9000';
const NS = '?ns=meal-hat-default-rtdb';
const OWNER = { Authorization: 'Bearer owner' };
const HAT = 'test-example-com';
const FRIDGE_KEY = 'talkrunreviewtestfridgekey00000001';

test('the last read-through can be reopened and corrected', async ({ page, request }) => {
  await page.setViewportSize({ width: 402, height: 850 });
  await setupAuthAndDisableTutorial(page);
  await navigateDirectly(page, '/');
  await page.waitForSelector('.drawn-meals-schedule', { timeout: 15000 });

  const put = (path, data) => request.put(`${DB}/${path}.json${NS}`, { headers: OWNER, data });
  const get = async (path) => (await request.get(`${DB}/${path}.json${NS}`, { headers: OWNER })).json();
  const runAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const soon = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString();

  await put(`fridge/${FRIDGE_KEY}/timers/pepper-card`, {
    title: 'Pepper', expiryDate: soon, createdAt: new Date(Date.parse(runAt) + 5000).toISOString()
  });
  await put(`fridge/${FRIDGE_KEY}/timers/cheddar-card`, { title: 'Cheddar Cheese', expiryDate: soon, createdAt: '2026-10-01T00:00:00Z' });
  await put(`${HAT}/talk-runs/-run0001`, {
    at: runAt,
    transcript: 'Okay fridge. There is a block of pepper jack, and some cheddar that is open but fine.',
    reader: { items: [{ heard: 'a block of pepper jack', name: 'Pepper', knownFoodMatch: '', quantity: 1, counted: 'packages', perishable: true }] },
    report: {
      added: [{ name: 'Pepper', heard: 'a block of pepper jack', days: 9 }],
      confirmed: [{ id: 'cheddar-card', title: 'Cheddar Cheese', heard: 'some cheddar that is open but fine', expiryDate: soon }],
      spoken: ['pepper', 'cheddar cheese']
    },
    applied: { added: 1, removed: 0, failed: 0 }
  });
  await put(`${HAT}/fridgeKey`, JSON.stringify(FRIDGE_KEY));

  await navigateDirectly(page, '/fridge');
  await page.getByRole('button', { name: 'Look over the last read-through' }).click();

  const sheet = page.locator('.talk-content');
  await expect(sheet.locator('h2')).toHaveText('Last read-through');
  await expect(sheet).toContainText('“a block of pepper jack”');
  await expect(sheet).toContainText('“some cheddar that is open but fine”');

  await sheet.getByRole('button', { name: /What I said/ }).click();
  await expect(sheet.locator('.said-text')).toContainText('There is a block of pepper jack');

  const pepper = sheet.locator('.seen-row', { hasText: 'Pepper' });
  await pepper.getByRole('button', { name: 'Not right' }).click();
  await expect(pepper.locator('.flag-input')).toBeVisible();

  const fits = await sheet.evaluate((el) => ({
    sheet: el.scrollWidth <= Math.round(el.getBoundingClientRect().width) + 1,
    page: document.documentElement.scrollWidth <= document.documentElement.clientWidth
  }));
  expect(fits, 'the sheet fits a 402px phone').toEqual({ sheet: true, page: true });
  await page.screenshot({ path: 'test-results/talk-run-review.png', fullPage: true });

  // Blank: it was nothing. The card comes off and the lesson is kept.
  await pepper.getByRole('button', { name: 'Save' }).click();
  await expect(pepper).toContainText('noted, taken off');
  await expect(sheet).toContainText('Took Pepper off');

  await expect.poll(async () => Object.values(await get(`${HAT}/talk-lessons`) || {}).length).toBe(1);
  const [lesson] = Object.values(await get(`${HAT}/talk-lessons`));
  expect(lesson).toMatchObject({ kind: 'wrong', heard: 'a block of pepper jack', readAs: 'Pepper', runId: '-run0001' });
  await expect.poll(async () => get(`fridge/${FRIDGE_KEY}/timers/pepper-card`)).toBeNull();
  // The older cheddar card is untouched.
  expect(await get(`fridge/${FRIDGE_KEY}/timers/cheddar-card`)).not.toBeNull();

  // Reopened, it remembers the correction.
  await sheet.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Look over the last read-through' }).click();
  await expect(page.locator('.talk-content .seen-row', { hasText: 'Pepper' })).toContainText('noted, taken off');
});
