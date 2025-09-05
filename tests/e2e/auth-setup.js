/**
 * Authentication setup for tests
 * This file handles bypassing or mocking Firebase authentication for testing
 */

const { test, expect } = require('@playwright/test');

// Set up test user credentials in localStorage
async function setupTestAuth(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
    window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
  });
}

// Setup authenticated page
async function setupAuthenticatedPage(page) {
  // Set up authentication BEFORE navigating
  await page.addInitScript(() => {
    window.localStorage.setItem('mealHatUserEmail', 'test@example.com');
    window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
  });
  
  // Now navigate to the app
  await page.goto('/');
  
  // Wait for the app to load and verify we're not on login page
  await page.waitForSelector('text=Meal Hat', { timeout: 15000 });
  
  // Should be at home page, not login
  await expect(page).toHaveURL('/#/');
}

// Setup function to ensure clean test state
async function setupCleanDatabase(page) {
  // Clear any existing test data
  await page.addInitScript(() => {
    // Clear relevant localStorage
    const keysToRemove = [
      'mealHatDatabaseTopKey',
      'mealHatUserEmail'
    ];
    
    keysToRemove.forEach(key => {
      window.localStorage.removeItem(key);
    });
  });
  
  // Set up test user
  await setupTestAuth(page);
}

// Helper to wait for app initialization
async function waitForAppReady(page) {
  // Wait for Vue app to be mounted and store to be initialized
  await page.waitForFunction(() => {
    return window.Vue && document.querySelector('#app').__vue_app__;
  });
  
  // Wait for store to have basic state
  await page.waitForFunction(() => {
    const app = document.querySelector('#app').__vue_app__;
    return app && app.config && app.config.globalProperties && app.config.globalProperties.$store;
  });
}

// Test utility to add test data
async function addTestMeal(page, mealName = 'Test Meal', ingredients = []) {
  await page.click('text=Add Meal');
  await page.waitForSelector('input[id="recipe-title"]');
  
  await page.fill('input[id="recipe-title"]', mealName);
  await page.fill('input[type="number"]', '1'); // Low frequency for testing
  
  // Add ingredients if provided
  for (let i = 0; i < ingredients.length && i < 4; i++) {
    const ingredient = ingredients[i];
    await page.fill(`[id^="ingredient-${i}-name"]`, ingredient.name);
    if (ingredient.quantity) {
      await page.fill(`[id^="ingredient-${i}-quantity"]`, ingredient.quantity.toString());
    }
    if (ingredient.units) {
      await page.fill(`[id^="ingredient-${i}-units"]`, ingredient.units);
    }
  }
  
  await page.click('button:has-text("Add Meal To Hat")');
  await page.waitForURL('/#/');
}

// Export functions
module.exports = { setupTestAuth, setupAuthenticatedPage, setupCleanDatabase, waitForAppReady, addTestMeal };