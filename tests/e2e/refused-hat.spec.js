const { test, expect } = require('@playwright/test');
const { emulatorSignIn, seedFirebaseSession, dismissTutorialIfPresent } = require('./test-utils.js');

// Sentry, 2026-11-01: someone signed in on an iPhone opened a hat they were
// not a member of. The app logged it, then attached every listener anyway -
// each refused - and showed an empty schedule with nothing to say why.
// Now initializeDB stops, goes back to the person's own hat, and Home says
// what happened.
const DB = 'http://localhost:9000';
const NS = 'ns=meal-hat-default-rtdb';
const OTHER_HAT = 'someone-else-example-com';

test('a hat this account is not in sends it home with an explanation', async ({ page }) => {
  // A hat that exists and belongs to somebody else. "Bearer owner" is the
  // emulator's rules bypass.
  await fetch(`${DB}/${OTHER_HAT}.json?${NS}`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer owner' },
    body: JSON.stringify({ joinCode: 'abc123abc123', members: { 'another-uid': { joined: true } }, meals: {} })
  });

  const session = await emulatorSignIn();
  await seedFirebaseSession(page, session);
  // Runs after the seeding script: land on the other hat, as the reporter did.
  await page.addInitScript((hat) => {
    window.localStorage.setItem('mealHatDatabaseTopKey', hat);
  }, OTHER_HAT);

  const refused = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /permission/i.test(msg.text())) refused.push(msg.text());
  });

  await page.goto('/');

  const notice = page.locator('.denied-hat');
  await expect(notice).toBeVisible({ timeout: 15000 });
  await expect(notice).toContainText(OTHER_HAT);
  await expect(notice).toContainText('test@example.com');
  await expect(notice).toContainText('share link');
  await expect(notice).toContainText("You're on your own hat now");

  // Moved to their own hat, and it will be the one opened next time too.
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('mealHatDatabaseTopKey')))
    .toBe('test-example-com');

  // The tester's hat may be brand new here, and a new hat opens the tour.
  await dismissTutorialIfPresent(page);
  await expect(page.locator('.shepherd-modal-is-visible')).toHaveCount(0);
  await notice.getByRole('button', { name: 'OK' }).click();
  await expect(notice).toBeHidden();
  await expect(page.locator('text=Draw Meals')).toBeVisible();

  // No refused listeners: the stop came before any of them attached.
  expect(refused).toEqual([]);
});
