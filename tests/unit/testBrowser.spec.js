import { describe, it, expect } from 'vitest';
import { isTestBrowser } from '../../src/utils/testBrowser.js';

// Sentry is never started in a test browser (src/sentry.js).
describe('isTestBrowser', () => {
  const page = (hostname, webdriver) => ({ location: { hostname }, navigator: { webdriver } });

  it('is a test when the browser is automated, even on the live site', () => {
    expect(isTestBrowser(page('mealhat.com', true))).toBe(true);
  });

  it('is a test when the build is served from this machine', () => {
    expect(isTestBrowser(page('localhost', false))).toBe(true);
    expect(isTestBrowser(page('127.0.0.1', undefined))).toBe(true);
  });

  it('is a user on the live site in an ordinary browser', () => {
    expect(isTestBrowser(page('mealhat.com', false))).toBe(false);
    expect(isTestBrowser(page('www.mealhat.com', undefined))).toBe(false);
  });

  it('is not a test when there is no window at all', () => {
    expect(isTestBrowser(undefined)).toBe(false);
  });
});
