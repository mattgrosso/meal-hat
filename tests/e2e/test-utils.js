const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * Test utilities for the Meal Hat E2E suite.
 *
 * AUTH IS REAL HERE, AGAINST THE EMULATOR. This file used to fake a session
 * with two localStorage keys, which worked only while the app trusted
 * localStorage. Since the membership lockdown, initializeDB checks
 * auth.currentUser and signs out anyone Firebase doesn't recognise - so every
 * test landed on the Login screen (2026-08-27, the whole suite red).
 *
 * Now: the suite runs against the Firebase Auth + Database EMULATORS
 * (playwright.config.js starts them and starts the dev server with
 * VUE_APP_FIREBASE_EMULATORS=1). Each run signs a tester into the auth
 * emulator over REST and seeds the browser's IndexedDB with the resulting
 * session - the same record the SDK itself writes - so the app boots already
 * signed in. No Google popup, no production database, no credentials on disk.
 */

const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = 'test-password';
const TEST_HAT_KEY = 'test-example-com';
const AUTH_EMULATOR = 'http://localhost:9099';

// The app's real web API key - the IndexedDB record is keyed by it, so it has
// to match what the app initializes with. Read from .env the way vue-cli does.
const API_KEY = (() => {
  const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('VUE_APP_GOOGLE_API_KEY='));
  if (!line) throw new Error('VUE_APP_GOOGLE_API_KEY missing from .env');
  return line.slice('VUE_APP_GOOGLE_API_KEY='.length).trim();
})();

/**
 * A real session from the auth emulator: sign the tester up (or in, on every
 * run after the first) and hand back the SDK-shaped tokens.
 */
async function emulatorSignIn () {
  const call = async (endpoint) => {
    const res = await fetch(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true })
    });
    return res.json();
  };

  let session = await call('signUp');
  if (session.error?.message === 'EMAIL_EXISTS') session = await call('signInWithPassword');
  if (!session.idToken) {
    throw new Error(`Auth emulator sign-in failed: ${JSON.stringify(session).slice(0, 200)} - is the emulator running?`);
  }
  return session;
}

/**
 * Seeds the browser with the signed-in session BEFORE the app loads.
 *
 * The Firebase SDK persists its session in IndexedDB
 * (firebaseLocalStorageDb/firebaseLocalStorage) keyed by
 * `firebase:authUser:<apiKey>:[DEFAULT]`; writing the same record the SDK
 * would have written makes the app restore the tester exactly as it would a
 * person. Fragile against major SDK upgrades by nature - if a Firebase bump
 * ever turns the whole suite red at the login screen again, look here first.
 */
async function seedFirebaseSession (page, session) {
  const record = {
    uid: session.localId,
    email: TEST_EMAIL,
    emailVerified: true,
    isAnonymous: false,
    providerData: [{
      providerId: 'password',
      uid: TEST_EMAIL,
      displayName: null,
      email: TEST_EMAIL,
      phoneNumber: null,
      photoURL: null
    }],
    stsTokenManager: {
      refreshToken: session.refreshToken,
      accessToken: session.idToken,
      expirationTime: Date.now() + 55 * 60 * 1000
    },
    createdAt: String(Date.now()),
    lastLoginAt: String(Date.now()),
    apiKey: API_KEY,
    appName: '[DEFAULT]'
  };

  await page.addInitScript(({ apiKey, user }) => {
    // Authentication state the ROUTER reads (its guard runs before Firebase
    // has restored anything).
    window.localStorage.setItem('mealHatUserEmail', user.email);
    window.localStorage.setItem('mealHatDatabaseTopKey', 'test-example-com');
    // Tutorial off, as before.
    window.localStorage.setItem('mealHat-tutorial-completed', 'true');

    // The session the FIREBASE SDK reads.
    const open = indexedDB.open('firebaseLocalStorageDb', 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
    };
    open.onsuccess = () => {
      const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
      tx.objectStore('firebaseLocalStorage').put({
        fbase_key: `firebase:authUser:${apiKey}:[DEFAULT]`,
        value: user
      });
    };
  }, { apiKey: API_KEY, user: record });
}

// Set up authentication and disable tutorial completely
async function setupAuthAndDisableTutorial (page) {
  const session = await emulatorSignIn();
  await seedFirebaseSession(page, session);

  // Navigate to app
  await page.goto('/');
  await page.waitForSelector('text=Meal Hat', { timeout: 15000 });

  // Force close any tutorial that might still appear
  await dismissTutorialIfPresent(page);

  // Verify we're authenticated and at home
  await expect(page).toHaveURL('/#/');
}

// Dismiss tutorial modal if it appears
async function dismissTutorialIfPresent (page) {
  try {
    // Wait a moment for tutorial to potentially appear
    await page.waitForTimeout(300);

    // Look for tutorial elements and dismiss them
    const doneButton = page.locator('button:has-text("Done")');
    const nextButton = page.locator('button:has-text("Next")');
    const cancelIcon = page.locator('.shepherd-cancel-icon');

    // Try clicking Done button first
    if (await doneButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await doneButton.click();
      await page.waitForTimeout(500);
    // If not Done, try clicking through with Next buttons
    } else if (await nextButton.isVisible({ timeout: 2000 }).catch(() => false)) {
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
    // Try cancel icon as last resort
    } else if (await cancelIcon.isVisible({ timeout: 1000 }).catch(() => false)) {
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
async function navigateDirectly (page, path) {
  const session = await emulatorSignIn();
  await seedFirebaseSession(page, session);

  await page.goto(`/#${path}`);

  // Wait for Vue app to initialize by checking for the app div to have content
  await page.waitForFunction(() => {
    const appDiv = document.querySelector('#app');
    return appDiv && appDiv.children.length > 0;
  }, { timeout: 10000 });

  await page.waitForTimeout(1000); // Additional wait for component mounting

  // Dismiss any tutorial that might appear on this page
  await dismissTutorialIfPresent(page);

  await expect(page).toHaveURL(`/#${path}`);
}

// Add a meal using direct navigation (most reliable)
async function addTestMeal (page, mealName, ingredientName = 'Test Ingredient', quantity = '1', units = 'unit') {
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
async function addTestGrocery (page, itemName, quantity = '1', units = 'unit', aisle = '1') {
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
async function safeClick (page, selector) {
  // Remove any modal overlays first
  await page.evaluate(() => {
    document.querySelectorAll('.shepherd-modal-overlay-container').forEach(el => el.remove());
  });

  // Wait a moment then click
  await page.waitForTimeout(300);
  await page.click(selector);
}

module.exports = {
  emulatorSignIn,
  seedFirebaseSession,
  setupAuthAndDisableTutorial,
  dismissTutorialIfPresent,
  navigateDirectly,
  addTestMeal,
  addTestGrocery,
  safeClick
};