// A page Sentry should stay out of entirely: a production build served from
// this machine (`yarn preview`, a screenshot run), or any automated browser —
// Playwright, Puppeteer and Selenium all set `navigator.webdriver`. Those are
// tests, not users, and their errors reach Sentry as if from the live site.
// 2026-10-24: a Playwright run against mealhat.com blocked the service
// worker, so register-service-worker crashed reading `.waiting` off nothing
// (Cinema Roll had the identical crash on 2026-10-14). Same check as Cinema
// Roll's isTestBrowser.
export function isTestBrowser (win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return false;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(win.location?.hostname || '')) return true;
  return win.navigator?.webdriver === true;
}
