const { expect } = require('@playwright/test');

/**
 * Reliable test utilities for Meal Hat app
 * These functions handle authentication and tutorial issues consistently
 */

// Set up authentication and disable tutorial completely
async function setupAuthAndDisableTutorial(page) {
  // Set up authentication and tutorial state BEFORE navigating
  await page.addInitScript(() => {
    // Authentication
    window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
    window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
    
    // Disable tutorial by setting it as already completed
    // This should prevent it from showing up at all
    window.localStorage.setItem('mealHat-tutorial-completed', 'true');
  });
  
  // Navigate to app
  await page.goto('/');
  await page.waitForSelector('text=Meal Hat', { timeout: 15000 });
  
  // Force close any tutorial that might still appear
  await dismissTutorialIfPresent(page);
  
  // Verify we're authenticated and at home
  await expect(page).toHaveURL('/#/');
}

// Dismiss tutorial modal if it appears
async function dismissTutorialIfPresent(page) {
  try {
    // Wait a moment for tutorial to potentially appear
    await page.waitForTimeout(1000);
    
    // Look for tutorial elements and dismiss them
    const doneButton = page.locator('button:has-text("Done")');
    const nextButton = page.locator('button:has-text("Next")');
    const cancelIcon = page.locator('.shepherd-cancel-icon');
    
    // Try clicking Done button first
    if (await doneButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await doneButton.click();
      await page.waitForTimeout(500);
    } 
    // If not Done, try clicking through with Next buttons
    else if (await nextButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Click through tutorial steps
      for (let i = 0; i < 10; i++) { // Max 10 steps to avoid infinite loop
        if (await nextButton.isVisible({ timeout: 1000 }).catch(() => false)) {
          await nextButton.click();
          await page.waitForTimeout(300);
        } else {
          break;
        }
      }
      // Click Done at the end
      if (await doneButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await doneButton.click();
        await page.waitForTimeout(500);
      }
    }
    // Try cancel icon as last resort
    else if (await cancelIcon.isVisible({ timeout: 1000 }).catch(() => false)) {
      await cancelIcon.click();
      await page.waitForTimeout(500);
    }
    
    // Force remove any remaining modal overlays
    await page.evaluate(() => {
      const modals = document.querySelectorAll('.shepherd-modal-overlay-container, .shepherd-element');
      modals.forEach(modal => {
        if (modal.parentNode) {
          modal.parentNode.removeChild(modal);
        }
      });
    });
    
  } catch (e) {
    // Tutorial handling failed, but continue
    console.log('Tutorial dismissal failed or not needed:', e.message);
  }
}

// Navigate directly to a page bypassing home page tutorial
async function navigateDirectly(page, path) {
  await page.addInitScript(() => {
    window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
    window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
  });
  
  await page.goto(`/#${path}`);
  await page.waitForTimeout(2000); // Let page load
  
  // Dismiss any tutorial that might appear on this page
  await dismissTutorialIfPresent(page);
  
  await expect(page).toHaveURL(`/#${path}`);
}

// Add a meal using direct navigation (most reliable)
async function addTestMeal(page, mealName, ingredientName = 'Test Ingredient', quantity = '1', units = 'unit') {
  await navigateDirectly(page, '/add-meal');
  
  await page.waitForSelector('input[id="recipe-title"]', { timeout: 10000 });
  
  // Fill out form
  await page.fill('input[id="recipe-title"]', mealName);
  await page.fill('input[type="number"]', '7'); // frequency
  await page.fill('[id^="ingredient-0-name"]', ingredientName);
  await page.fill('[id^="ingredient-0-quantity"]', quantity);
  if (units) {
    await page.fill('[id^="ingredient-0-units"]', units);
  }
  
  // Remove any modals before submitting
  await page.evaluate(() => {
    document.querySelectorAll('.shepherd-modal-overlay-container').forEach(el => el.remove());
  });
  
  // Submit
  await page.click('button:has-text("Add Meal To Hat")');
  await page.waitForURL('/#/');
  
  return mealName;
}

// Add grocery item using direct navigation
async function addTestGrocery(page, itemName, quantity = '1', units = 'unit', aisle = '1') {
  await navigateDirectly(page, '/add-groceries');
  
  await page.waitForSelector('input[placeholder="New Grocery Item"]', { timeout: 10000 });
  
  await page.fill('input[placeholder="New Grocery Item"]', itemName);
  await page.fill('input[placeholder="Quantity"]', quantity);
  await page.fill('input[placeholder="Units"]', units);
  await page.fill('input[placeholder="Aisle"]', aisle);
  
  await page.click('button:has-text("Add")');
  
  // Verify it was added
  await expect(page.locator(`text=${itemName}`).first()).toBeVisible();
  
  return itemName;
}

// Safe way to click elements that might be blocked by modals
async function safeClick(page, selector) {
  // Remove any modal overlays first
  await page.evaluate(() => {
    document.querySelectorAll('.shepherd-modal-overlay-container').forEach(el => el.remove());
  });
  
  // Wait a moment then click
  await page.waitForTimeout(300);
  await page.click(selector);
}

module.exports = {
  setupAuthAndDisableTutorial,
  dismissTutorialIfPresent,
  navigateDirectly,
  addTestMeal,
  addTestGrocery,
  safeClick
};