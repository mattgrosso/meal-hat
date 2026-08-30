const { test, expect } = require('@playwright/test');
const { setupAuthAndDisableTutorial, navigateDirectly } = require('./test-utils.js');

// A tapped schedule row must FIT.
//
// This row is one column of a two-column grid — dates on the left, meals on
// the right — so it has roughly half the phone's width, not all of it. Tapping
// it reveals Delete and "Made it" together, and on Matt's phone that came out
// clipped: "I can only see part of the buttons."
//
// Same class of bug as the staple checkbox in 2026-08-19, and the same check:
// constrain to a real phone width and measure scrollWidth against the box.
test.describe('the meal schedule row at phone width', () => {
  test('reveals both actions without clipping them', async ({ page, request }) => {
    // Seed a drawn meal straight into the emulator, with a long name — the
    // whole question is whether a name can shove the buttons out of the row.
    const DB = 'http://localhost:9000';
    const NS = '?ns=meal-hat-default-rtdb';
    const today = new Date().toISOString().slice(0, 10);
    const mealId = 'fits-test-meal';

    await request.put(`${DB}/test-example-com/meals/${mealId}.json${NS}`, {
      headers: { Authorization: 'Bearer owner' },
      data: {
        id: mealId,
        name: 'Slow-roasted tomato and ricotta baked ziti',
        minDaysBetween: 14,
        ingredients: []
      }
    });
    await request.put(`${DB}/test-example-com/drawnMeals/fits-test-drawn.json${NS}`, {
      headers: { Authorization: 'Bearer owner' },
      data: { id: 'fits-test-drawn', mealId, assignedDate: today }
    });

    await page.setViewportSize({ width: 402, height: 850 });
    await setupAuthAndDisableTutorial(page);
    await navigateDirectly(page, '/');
    await page.waitForSelector('.schedule-meal', { timeout: 15000 }).catch(() => null);

    const rows = page.locator('.schedule-meal');
    const count = await rows.count();
    test.skip(count === 0, 'no drawn meals in the emulator to tap');

    const row = rows.first();
    await row.click();
    await page.waitForTimeout(400);

    const measured = await row.evaluate((el) => {
      const made = el.querySelector('.made-button');
      const del = el.querySelector('.delete-button');
      const rowBox = el.getBoundingClientRect();
      const fits = (b) => {
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return {
          width: Math.round(r.width),
          rightEdge: Math.round(r.right),
          insideRow: r.right <= rowBox.right + 1 && r.left >= rowBox.left - 1
        };
      };
      return {
        rowScroll: el.scrollWidth,
        rowWidth: Math.round(rowBox.width),
        overflows: el.scrollWidth > Math.round(rowBox.width) + 1,
        made: fits(made),
        del: fits(del),
        pageOverflows:
          document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });

    expect(measured.overflows, 'the row itself must not overflow').toBe(false);
    expect(measured.pageOverflows, 'the page must not scroll sideways').toBe(false);
    expect(measured.made?.insideRow, '"Made it" must be fully inside the row').toBe(true);
    expect(measured.del?.insideRow, 'Delete must be fully inside the row').toBe(true);
  });
});
