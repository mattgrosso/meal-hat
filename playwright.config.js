// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests/e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Global timeout for each test */
  timeout: 45000,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 2,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:8085',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Everything the suite needs, started together:
   *
   *  - the Firebase Auth + Database EMULATORS. The tests sign a real tester
   *    into the auth emulator (see test-utils.js) — the localStorage fake
   *    stopped working when the app started requiring a real Firebase user,
   *    and the old arrangement had the tests writing into the PRODUCTION
   *    database besides.
   *  - the dev server, with VUE_APP_FIREBASE_EMULATORS=1 so the app points
   *    itself at those emulators (compile-time flag; see store/index.js).
   *
   * Port 8085, not vue-cli's default 8080: Matt keeps another app's dev
   * server running continuously, usually on 8080. With reuseExistingServer,
   * an occupied 8080 would silently run this suite against WHATEVER APP is
   * there — and without it, vue-cli would auto-increment to 8081 and the
   * baseURL would point at nothing. A pinned port sidesteps both.
   */
  webServer: [
    {
      /* The database emulator runs on Java. The machine's /usr/bin/java is
       * only Apple's "install a runtime" stub; the real one is brew's
       * keg-only openjdk, which never goes on PATH by itself. */
      /* The pre-kill matters: Playwright tears down what it STARTED, but the
       * database emulator is a java child the firebase CLI spawns, and it
       * sometimes outlives its parent. A survivor on 9000 makes the next
       * emulators:start fail, which Playwright reports only as "webServer was
       * not able to start". Killing our own stragglers first makes every run
       * start clean. */
      command: 'for port in 9000 9099; do pid=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t | head -1); if [ -n "$pid" ] && ps -p $pid -o command= | grep -qi "firebase\\|emulator"; then kill $pid; fi; done; sleep 1; PATH="/usr/local/opt/openjdk/bin:$PATH" exec firebase emulators:start --only auth,database --project meal-hat',
      url: 'http://localhost:9099',
      reuseExistingServer: true,
      timeout: 120 * 1000,
    },
    {
      command: 'VUE_APP_FIREBASE_EMULATORS=1 yarn serve --port 8085',
      url: 'http://localhost:8085',
      reuseExistingServer: true,
      timeout: 180 * 1000,
    },
  ],
});