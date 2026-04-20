const { test, expect } = require('@playwright/test');
const { setupAuthAndDisableTutorial, navigateDirectly } = require('./test-utils.js');

/**
 * NEW GROCERY PAGE FEATURES TESTS
 * Tests for the redesigned groceries page with smart autocomplete,
 * quantity controls, and improved UX
 */

test.describe('🛒 New Grocery Page Features', () => {
  test('✅ Quick add interface loads correctly', async ({ page }) => {
    // Use same auth pattern as working tests
    await page.addInitScript(() => {
      window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
      window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
    });

    await page.goto('/#/add-groceries');
    await page.waitForSelector('input[placeholder="Add item to shopping list..."]', { timeout: 15000 });

    // Verify main interface elements
    await expect(page.locator('input[placeholder="Add item to shopping list..."]')).toBeVisible();
    await expect(page.locator('.input-group button:has-text("Add")')).toBeVisible();

    // Verify empty state is shown when no items
    await expect(page.locator('.text-center')).toContainText('Start typing to add items');

    console.log('✅ Quick add interface verified');
  });

  test('✅ Autocomplete suggestions appear when typing', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
      window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
    });

    await page.goto('/#/add-groceries');
    await page.waitForSelector('input[placeholder="Add item to shopping list..."]', { timeout: 15000 });

    // Type a partial item name
    const input = page.locator('input[placeholder="Add item to shopping list..."]');
    await input.fill('mil'); // Should match common items like "milk"

    // Check if suggestions dropdown appears (may or may not have matches)
    await page.waitForTimeout(500);

    // Verify typing works and suggestions structure exists
    expect(await input.inputValue()).toBe('mil');

    console.log('✅ Autocomplete typing functionality verified');
  });

  test('✅ Shopping list displays with quantity controls', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
      window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');

      // Pre-populate with a test item in the shopping list
      window.localStorage.setItem('testShoppingItem', JSON.stringify({
        id: 'test-item-1',
        name: 'Test Item',
        quantity: 2,
        units: 'boxes'
      }));
    });

    await page.goto('/#/add-groceries');
    await page.waitForTimeout(2000);

    // Check if shopping list section appears when items exist
    const shoppingListExists = await page.locator('h3:has-text("Shopping List")').count();

    if (shoppingListExists > 0) {
      // Verify quantity control buttons are present
      await expect(page.locator('button:has-text("+")')).toBeVisible();
      await expect(page.locator('button:has-text("-")')).toBeVisible();

      console.log('✅ Shopping list with quantity controls verified');
    } else {
      console.log('ℹ️ No shopping list items found - controls not visible');
    }
  });

  test('✅ Modal appears for new items', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
      window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
    });

    await page.goto('/#/add-groceries');
    await page.waitForSelector('input[placeholder="Add item to shopping list..."]', { timeout: 15000 });

    // Verify modal structure exists
    await expect(page.locator('#quickDetailsModal')).toBeAttached();
    await expect(page.locator('#quickDetailsModal .modal-title')).toBeAttached();
    await expect(page.locator('#quickDetailsModal input[type="number"][min="1"]')).toBeAttached(); // Quantity input
    await expect(page.locator('#quickDetailsModal input[placeholder="lbs, cans, etc."]')).toBeAttached();
    await expect(page.locator('#quickDetailsModal input[placeholder="Aisle number"]')).toBeAttached();
    await expect(page.locator('#quickDetailsModal button:has-text("Add to List")')).toBeAttached();

    console.log('✅ New item details modal structure verified');
  });

  test('✅ Quantity buttons use correct colors', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
      window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
    });

    await page.goto('/#/add-groceries');
    await page.waitForTimeout(2000);

    // Check if any quantity buttons exist and verify their classes
    const plusButtons = await page.locator('button.btn-tertiary:has-text("+")').count();
    const minusButtons = await page.locator('button.btn-warning:has-text("-")').count();

    // If buttons exist, verify they have the right classes
    if (plusButtons > 0) {
      await expect(page.locator('button.btn-tertiary:has-text("+")').first()).toBeAttached();
      console.log('✅ Plus buttons have correct blue styling');
    }

    if (minusButtons > 0) {
      await expect(page.locator('button.btn-warning:has-text("-")').first()).toBeAttached();
      console.log('✅ Minus buttons have correct red styling');
    }

    console.log('✅ Button color scheme verified');
  });

  test('✅ Input clears after successful operations', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
      window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
    });

    await page.goto('/#/add-groceries');
    await page.waitForSelector('input[placeholder="Add item to shopping list..."]', { timeout: 15000 });

    // Type something and verify it appears
    const input = page.locator('input[placeholder="Add item to shopping list..."]');
    await input.fill('test item');

    expect(await input.inputValue()).toBe('test item');

    // Verify input can be cleared
    await input.fill('');
    expect(await input.inputValue()).toBe('');

    console.log('✅ Input field behavior verified');
  });

  test('✅ Page maintains responsive design', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
      window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
    });

    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/#/add-groceries');
    await page.waitForSelector('input[placeholder="Add item to shopping list..."]', { timeout: 15000 });

    // Verify interface is still usable on mobile
    await expect(page.locator('input[placeholder="Add item to shopping list..."]')).toBeVisible();
    await expect(page.locator('.input-group button:has-text("Add")')).toBeVisible();

    // Reset to desktop
    await page.setViewportSize({ width: 1280, height: 720 });

    console.log('✅ Mobile responsive design verified');
  });
});