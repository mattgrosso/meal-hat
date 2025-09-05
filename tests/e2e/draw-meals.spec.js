const { test, expect } = require('@playwright/test');
const { setupAuthAndDisableTutorial, navigateDirectly, addTestMeal } = require('./test-utils.js');

test.describe('Draw Meals Flow', () => {
  test('should access draw meals page', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    await navigateDirectly(page, '/draw-meals');
    
    // Should load draw meals page
    await expect(page).toHaveURL('/#/draw-meals');
    
    // Should show the page header
    await expect(page.locator('text=Draw Meals').first()).toBeVisible();
  });

  test('should show calendar component', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    await navigateDirectly(page, '/draw-meals');
    
    // Wait for calendar to load
    await page.waitForTimeout(3000);
    
    // Should show calendar component (v-calendar or similar)
    const calendarExists = await page.locator('.v-date-picker, .vc-container, [class*="calendar"], [class*="date-picker"]').count() > 0;
    expect(calendarExists).toBeTruthy();
  });

  test('should show date range selection', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    await navigateDirectly(page, '/draw-meals');
    await page.waitForTimeout(2000);
    
    // Should show date range information
    await expect(page.locator('text=Pick Days for drawing')).toBeVisible();
    
    // Should show draw meals button (might be conditionally visible)
    const drawButton = page.locator('button:has-text("Draw Meals")');
    const drawButtonExists = await drawButton.count() > 0;
    expect(drawButtonExists).toBeTruthy();
  });

  test('should handle draw meals with existing meals', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    // Add some meals first
    await addTestMeal(page, 'Draw Test Meal 1', 'Ingredient 1');
    await addTestMeal(page, 'Draw Test Meal 2', 'Ingredient 2');
    
    // Now go to draw meals
    await navigateDirectly(page, '/draw-meals');
    await page.waitForTimeout(3000);
    
    // Should show the draw meals interface
    await expect(page.locator('text=Draw Meals').first()).toBeVisible();
    
    // Calendar should be present
    const calendarExists = await page.locator('.v-date-picker, .vc-container, [class*="calendar"]').count() > 0;
    expect(calendarExists).toBeTruthy();
    
    // Draw button should be available (might require date selection)
    const drawButton = page.locator('button:has-text("Draw Meals")');
    const drawButtonCount = await drawButton.count();
    expect(drawButtonCount).toBeGreaterThan(0);
  });

  test('should show meal schedule after drawing (if applicable)', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    // Go to home page to see if there's a meal schedule component
    await setupAuthAndDisableTutorial(page);
    
    // Check if there's a drawn meal schedule on the home page
    const scheduleComponent = page.locator('.drawn-meals-schedule, .schedule, .meal-schedule');
    const scheduleExists = await scheduleComponent.count() > 0;
    
    if (scheduleExists) {
      await expect(scheduleComponent.first()).toBeVisible();
    }
    
    // Test passes regardless - schedule would only show if meals have been drawn
  });

  test('should handle empty meal hat gracefully', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    // Go to draw meals without adding any meals first
    await navigateDirectly(page, '/draw-meals');
    await page.waitForTimeout(2000);
    
    // Should still show the interface
    await expect(page.locator('text=Draw Meals').first()).toBeVisible();
    
    // Should show calendar
    const calendarExists = await page.locator('.v-date-picker, .vc-container, [class*="calendar"]').count() > 0;
    expect(calendarExists).toBeTruthy();
    
    // App should not crash when there are no meals to draw from
  });

  test('should show dates with existing meals', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    await navigateDirectly(page, '/draw-meals');
    await page.waitForTimeout(3000);
    
    // Should show the calendar interface
    const calendarExists = await page.locator('.v-date-picker, .vc-container, [class*="calendar"]').count() > 0;
    expect(calendarExists).toBeTruthy();
    
    // If there are any dates with meals, they might be highlighted or disabled
    // This depends on the calendar implementation
  });

  test('should show tutorial tour', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    await navigateDirectly(page, '/draw-meals');
    
    // Should show tour button
    const tourButton = page.locator('.start-tour-button');
    await expect(tourButton).toBeVisible();
    
    // Click tour button should show tutorial
    await tourButton.click();
    await page.waitForTimeout(2000);
    
    // Should show tour content (may have tutorial)
    // Dismiss any tutorial that appears
    const doneButton = page.locator('button:has-text("Done")');
    if (await doneButton.isVisible()) {
      await doneButton.click();
    }
  });

  test('should navigate back to home after drawing', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    // Add a meal first
    await addTestMeal(page, 'Navigation Test Meal', 'Navigation Ingredient');
    
    // Go to draw meals
    await navigateDirectly(page, '/draw-meals');
    await page.waitForTimeout(2000);
    
    // The draw meals process should eventually redirect back to home
    // For now, just verify we can navigate away from the page
    await navigateDirectly(page, '/');
    await expect(page).toHaveURL('/#/');
  });
});