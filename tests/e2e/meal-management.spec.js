const { test, expect } = require('@playwright/test');
const { setupAuthAndDisableTutorial, navigateDirectly, addTestMeal, safeClick } = require('./test-utils.js');

test.describe('Meal Management Flow', () => {
  test('should add a new meal with ingredients', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    const mealName = 'Test Tacos Supreme';
    await addTestMeal(page, mealName, 'Ground Beef', '1', 'lb');
    
    // Verify meal was added by checking show-meals page
    await navigateDirectly(page, '/show-meals');
    await expect(page.locator(`text=${mealName}`).first()).toBeVisible();
  });

  test('should add multiple meals successfully', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    const meals = [
      { name: 'Spaghetti Bolognese', ingredient: 'Ground Turkey', quantity: '1', units: 'lb' },
      { name: 'Chicken Stir Fry', ingredient: 'Chicken Breast', quantity: '2', units: 'lbs' },
      { name: 'Veggie Pasta', ingredient: 'Mixed Vegetables', quantity: '1', units: 'bag' }
    ];
    
    for (const meal of meals) {
      await addTestMeal(page, meal.name, meal.ingredient, meal.quantity, meal.units);
    }
    
    // Verify all meals are present
    await navigateDirectly(page, '/show-meals');
    for (const meal of meals) {
      await expect(page.locator(`text=${meal.name}`).first()).toBeVisible();
    }
  });

  test('should view all meals in the hat', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    // Add a meal first
    await addTestMeal(page, 'View Test Meal', 'View Test Ingredient');
    
    // Navigate to show meals
    await navigateDirectly(page, '/show-meals');
    
    // Should see the meals list
    await expect(page.locator('text=View Test Meal').first()).toBeVisible();
  });

  test('should handle meal with multiple ingredients', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    await navigateDirectly(page, '/add-meal');
    await page.waitForSelector('input[id="recipe-title"]');
    
    // Fill meal details
    await page.fill('input[id="recipe-title"]', 'Complex Meal');
    await page.fill('input[type="number"]', '5');
    
    // Add multiple ingredients
    await page.fill('[id^="ingredient-0-name"]', 'First Ingredient');
    await page.fill('[id^="ingredient-0-quantity"]', '2');
    await page.fill('[id^="ingredient-0-units"]', 'cups');
    
    await page.fill('[id^="ingredient-1-name"]', 'Second Ingredient');
    await page.fill('[id^="ingredient-1-quantity"]', '1');
    await page.fill('[id^="ingredient-1-units"]', 'lb');
    
    await page.fill('[id^="ingredient-2-name"]', 'Third Ingredient');
    await page.fill('[id^="ingredient-2-quantity"]', '3');
    await page.fill('[id^="ingredient-2-units"]', 'tbsp');
    
    await safeClick(page, 'button:has-text("Add Meal To Hat")');
    await page.waitForURL('/#/');
    
    // Verify meal was added
    await navigateDirectly(page, '/show-meals');
    await expect(page.locator('text=Complex Meal').first()).toBeVisible();
  });

  test('should handle meals with no ingredients (takeout)', async ({ page }) => {
    await setupAuthAndDisableTutorial(page);
    
    await navigateDirectly(page, '/add-meal');
    await page.waitForSelector('input[id="recipe-title"]');
    
    // Add meal without ingredients (like takeout)
    await page.fill('input[id="recipe-title"]', 'Pizza Palace Takeout');
    await page.fill('input[type="number"]', '14'); // Every two weeks
    
    await safeClick(page, 'button:has-text("Add Meal To Hat")');
    await page.waitForURL('/#/');
    
    // Verify meal was added
    await navigateDirectly(page, '/show-meals');
    await expect(page.locator('text=Pizza Palace Takeout').first()).toBeVisible();
  });
});