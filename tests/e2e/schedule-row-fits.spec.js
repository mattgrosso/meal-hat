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
// Seeding ORDER matters. The rules only let a hat's members read it, and the
// app claims membership when it CREATES the hat on first sign-in. Seeding
// before that creates the hat with no members — readable by nobody — so the
// schedule came up empty and the first test here skipped itself on every run
// from 2026-08-30 until 2026-09-26. Sign in first, let the app make the hat,
// then seed and reload.
const DB = 'http://localhost:9000';
const NS = '?ns=meal-hat-default-rtdb';
const OWNER = { Authorization: 'Bearer owner' };

const isoIn = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

async function homeWithSchedule (page, request, rows, viewport) {
  await page.setViewportSize(viewport);
  await setupAuthAndDisableTutorial(page);
  await navigateDirectly(page, '/');
  await page.waitForSelector('.drawn-meals-schedule', { timeout: 15000 });

  for (const [i, row] of rows.entries()) {
    const drawn = { id: `fits-drawn-${i}`, assignedDate: isoIn(row.inDays) };
    if (row.oneOff) {
      drawn.name = row.oneOff;
    } else {
      await request.put(`${DB}/test-example-com/meals/fits-meal-${i}.json${NS}`, {
        headers: OWNER,
        data: { id: `fits-meal-${i}`, name: row.name, minDaysBetween: 14, ingredients: [] }
      });
      drawn.mealId = `fits-meal-${i}`;
    }
    await request.put(`${DB}/test-example-com/drawnMeals/${drawn.id}.json${NS}`, { headers: OWNER, data: drawn });
  }

  await page.reload();
  await page.waitForSelector('.schedule-meal', { timeout: 15000 });
  // A fresh hat may still open the welcome tour over the schedule.
  await page.locator('.shepherd-cancel-icon').click({ timeout: 2000 }).catch(() => {});
}

test.describe('the meal schedule row at phone width', () => {
  test.describe.configure({ mode: 'serial' });
  test('reveals both actions without clipping them', async ({ page, request }) => {
    // A long name — the whole question is whether a name can shove the
    // buttons out of the row.
    await homeWithSchedule(page, request, [
      { inDays: 0, name: 'Slow-roasted tomato and ricotta baked ziti' }
    ], { width: 402, height: 850 });

    const row = page.locator('.schedule-meal').first();
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

  // Bug report 2026-09-26: "The panels each got much taller and they don't
  // fit on my phone anymore." Enjoy Cooking had placed a one-off called
  // "Lesson 1: Pork chops with a mustard pan sauce"; its nowrap name widened
  // the meals column, the dates wrapped to two lines, and the equal-height
  // rows took every row from 41px to 65px — and the page scrolled sideways.
  test('one long meal name does not make every row taller', async ({ page, request }) => {
    const shortRows = [
      { inDays: 0, name: 'Order Chinese' },
      { inDays: 1, name: 'Shells and Cheese' }
    ];
    await homeWithSchedule(page, request, [
      ...shortRows,
      { inDays: 6, oneOff: 'Lesson 1: Pork chops with a mustard pan sauce' }
    ], { width: 402, height: 665 });

    const measured = await page.evaluate(() => ({
      heights: [...document.querySelectorAll('.schedule-meal')].map((el) => Math.round(el.getBoundingClientRect().height)),
      dateHeights: [...document.querySelectorAll('.schedule-date')].map((el) => Math.round(el.getBoundingClientRect().height)),
      pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }));

    expect(measured.heights.length).toBeGreaterThanOrEqual(3);
    // One line of text plus padding — about 41px. Two lines was 65.
    for (const h of measured.heights) expect(h, 'every row stays one line tall').toBeLessThan(50);
    for (const h of measured.dateHeights) expect(h, 'dates stay on one line').toBeLessThan(50);
    expect(measured.pageOverflows, 'the page must not scroll sideways').toBe(false);
  });
});
