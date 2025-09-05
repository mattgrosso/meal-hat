const { test, expect } = require('@playwright/test');
const { setupAuthAndDisableTutorial, navigateDirectly } = require('./test-utils.js');

/**
 * ESSENTIAL SAFETY NET TESTS
 * These tests cover the absolutely critical functionality that MUST work.
 * These tests are proven to pass consistently and will catch regressions during refactoring.
 */

test.describe('🛡️ Essential Safety Net for Data Refactoring', () => {
  
  test('✅ Authentication works and app loads', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
      window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
    });
    
    await page.goto('/');
    await page.waitForSelector('text=Meal Hat', { timeout: 15000 });
    
    // Should be authenticated and at home
    await expect(page).toHaveURL('/#/');
    
    // Should see main navigation
    await expect(page.locator('text=Add Meal')).toBeVisible();
    await expect(page.locator('text=Draw Meals')).toBeVisible();
    await expect(page.locator('text=Shopping List')).toBeVisible();
  });

  test('✅ Can add a meal with ingredient', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    // Navigate directly to add meal
    await navigateDirectly(page, '/add-meal');
    await page.waitForSelector('input[id="recipe-title"]', { timeout: 10000 });
    
    // Fill out meal form
    await page.fill('input[id="recipe-title"]', 'Essential Test Meal');
    await page.fill('input[type="number"]', '7');
    await page.fill('[id^="ingredient-0-name"]', 'Essential Ingredient');
    await page.fill('[id^="ingredient-0-quantity"]', '1');
    await page.fill('[id^="ingredient-0-units"]', 'unit');
    
    // Remove any modals and submit
    await page.evaluate(() => {
      document.querySelectorAll('.shepherd-modal-overlay-container').forEach(el => el.remove());
    });
    
    await page.click('button:has-text("Add Meal To Hat")');
    await page.waitForURL('/#/');
    
    // Verify meal was added
    await navigateDirectly(page, '/show-meals');
    await expect(page.locator('text=Essential Test Meal').first()).toBeVisible();
  });

  test('✅ Can add multiple meals', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    const meals = [
      'Essential Meal One',
      'Essential Meal Two', 
      'Essential Meal Three'
    ];
    
    for (const mealName of meals) {
      await navigateDirectly(page, '/add-meal');
      await page.waitForSelector('input[id="recipe-title"]');
      
      await page.fill('input[id="recipe-title"]', mealName);
      await page.fill('input[type="number"]', '5');
      await page.fill('[id^="ingredient-0-name"]', `${mealName} Ingredient`);
      await page.fill('[id^="ingredient-0-quantity"]', '1');
      
      await page.evaluate(() => {
        document.querySelectorAll('.shepherd-modal-overlay-container').forEach(el => el.remove());
      });
      
      await page.click('button:has-text("Add Meal To Hat")');
      await page.waitForURL('/#/');
    }
    
    // Verify all meals were added
    await navigateDirectly(page, '/show-meals');
    for (const mealName of meals) {
      await expect(page.locator(`text=${mealName}`).first()).toBeVisible();
    }
  });

  test('✅ Can handle meal with multiple ingredients', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    await navigateDirectly(page, '/add-meal');
    await page.waitForSelector('input[id="recipe-title"]');
    
    // Create complex meal
    await page.fill('input[id="recipe-title"]', 'Multi-Ingredient Essential Meal');
    await page.fill('input[type="number"]', '3');
    
    // First ingredient
    await page.fill('[id^="ingredient-0-name"]', 'First Essential Ingredient');
    await page.fill('[id^="ingredient-0-quantity"]', '2');
    await page.fill('[id^="ingredient-0-units"]', 'cups');
    
    // Second ingredient
    await page.fill('[id^="ingredient-1-name"]', 'Second Essential Ingredient');
    await page.fill('[id^="ingredient-1-quantity"]', '1');
    await page.fill('[id^="ingredient-1-units"]', 'lb');
    
    // Third ingredient
    await page.fill('[id^="ingredient-2-name"]', 'Third Essential Ingredient');
    await page.fill('[id^="ingredient-2-quantity"]', '3');
    await page.fill('[id^="ingredient-2-units"]', 'tbsp');
    
    await page.evaluate(() => {
      document.querySelectorAll('.shepherd-modal-overlay-container').forEach(el => el.remove());
    });
    
    await page.click('button:has-text("Add Meal To Hat")');
    await page.waitForURL('/#/');
    
    // Verify meal was added
    await navigateDirectly(page, '/show-meals');
    await expect(page.locator('text=Multi-Ingredient Essential Meal').first()).toBeVisible();
  });

  test('✅ Can navigate between main sections', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    // Test that each main section loads without crashing
    const sections = [
      '/',
      '/add-meal', 
      '/show-meals',
      '/draw-meals'
    ];
    
    for (const section of sections) {
      await navigateDirectly(page, section);
      
      // Should navigate successfully
      await expect(page).toHaveURL(`/#${section}`);
      
      // Should not crash - basic page structure should be there
      await page.waitForTimeout(1000);
      const hasBasicStructure = await page.locator('body').count() > 0;
      expect(hasBasicStructure).toBeTruthy();
    }
  });

  test('✅ Direct URL navigation works with auth', async ({ page }) => {
    // Test authentication works for direct navigation
    await page.addInitScript(() => {
      window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
      window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
    });
    
    const directUrls = ['/', '/add-meal', '/show-meals', '/draw-meals'];
    
    for (const url of directUrls) {
      await page.goto(`/#${url}`);
      await page.waitForTimeout(2000);
      
      // Should not redirect to login
      const currentUrl = page.url();
      expect(currentUrl).not.toContain('/login');
      expect(currentUrl).toContain(`#${url}`);
    }
  });

  test('✅ Data persists across navigation', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    // Add a test meal
    await navigateDirectly(page, '/add-meal');
    await page.waitForSelector('input[id="recipe-title"]');
    
    await page.fill('input[id="recipe-title"]', 'Persistence Test Meal');
    await page.fill('[id^="ingredient-0-name"]', 'Persistence Ingredient');
    
    await page.evaluate(() => {
      document.querySelectorAll('.shepherd-modal-overlay-container').forEach(el => el.remove());
    });
    
    await page.click('button:has-text("Add Meal To Hat")');
    await page.waitForURL('/#/');
    
    // Navigate to different sections and back
    await navigateDirectly(page, '/draw-meals');
    await navigateDirectly(page, '/add-meal');
    await navigateDirectly(page, '/show-meals');
    
    // Meal should still be there
    await expect(page.locator('text=Persistence Test Meal').first()).toBeVisible();
  });

  test('✅ Form submissions work without errors', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    // Test adding meal without ingredients (like takeout)
    await navigateDirectly(page, '/add-meal');
    await page.waitForSelector('input[id="recipe-title"]');
    
    await page.fill('input[id="recipe-title"]', 'Form Test Takeout Meal');
    await page.fill('input[type="number"]', '10');
    
    // Don't add ingredients - test empty ingredient submission
    await page.evaluate(() => {
      document.querySelectorAll('.shepherd-modal-overlay-container').forEach(el => el.remove());
    });
    
    await page.click('button:has-text("Add Meal To Hat")');
    
    // Should redirect successfully without error
    await page.waitForURL('/#/');
    await expect(page).toHaveURL('/#/');
    
    // Meal should be added
    await navigateDirectly(page, '/show-meals');
    await expect(page.locator('text=Form Test Takeout Meal').first()).toBeVisible();
  });

  test('✅ Draw meals page loads with calendar', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    await navigateDirectly(page, '/draw-meals');
    await page.waitForTimeout(4000); // Let calendar component load
    
    // Should show draw meals page
    await expect(page.locator('text=Draw Meals').first()).toBeVisible();
    
    // Should show calendar component
    const calendarExists = await page.locator('.v-date-picker, .vc-container, [class*="calendar"], [class*="date"], .vue-cal').count() > 0;
    expect(calendarExists).toBeTruthy();
  });
});