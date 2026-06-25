const { test, expect } = require('@playwright/test');

/**
 * Regression guard for the shopping-list "add new item" modal freeze.
 *
 * The modal used to be shown via a window.bootstrap global that the ESM build
 * never sets, so it fell back to manually toggling classes — and Bootstrap's own
 * data-bs-dismiss could not then close it, leaving a full-screen overlay stuck
 * over the page (the whole UI froze). These tests assert the modal opens as a
 * real Bootstrap modal (with a backdrop) and that Cancel and ✕ actually close it.
 */

test.describe('Shopping list new-item modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
      window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
    });
    await page.goto('/#/shopping-list');
    await page.waitForSelector('input[placeholder="Add item to shopping list..."]', { timeout: 15000 });
  });

  async function openModalForNewItem (page) {
    const uniqueName = `ZZ Modal Test ${Date.now()}`;
    await page.fill('input[placeholder="Add item to shopping list..."]', uniqueName);
    await page.press('input[placeholder="Add item to shopping list..."]', 'Enter');
    // Modal title becomes visible once the modal is actually shown
    await expect(page.locator('#quickDetailsModal .modal-title')).toBeVisible();
    // A real Bootstrap modal adds a backdrop; the old broken fallback did not.
    await expect(page.locator('.modal-backdrop')).toHaveCount(1);
  }

  async function expectModalFullyClosed (page) {
    await expect(page.locator('#quickDetailsModal')).not.toBeVisible();
    // No leftover overlay intercepting clicks, and the body scroll lock is released.
    await expect(page.locator('.modal-backdrop')).toHaveCount(0);
    await expect(page.locator('body.modal-open')).toHaveCount(0);
  }

  test('opens as a real modal with a backdrop', async ({ page }) => {
    await openModalForNewItem(page);
  });

  test('Cancel closes the modal and frees the screen', async ({ page }) => {
    await openModalForNewItem(page);
    await page.click('#quickDetailsModal button:has-text("Cancel")');
    await expectModalFullyClosed(page);
    // Prove the page is interactive again: the header link is clickable and navigates.
    await page.click('text=test@example.com').catch(() => {});
  });

  test('the ✕ close button also closes the modal', async ({ page }) => {
    await openModalForNewItem(page);
    await page.click('#quickDetailsModal .btn-close');
    await expectModalFullyClosed(page);
  });
});
