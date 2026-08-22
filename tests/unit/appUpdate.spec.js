import { describe, it, expect, beforeEach } from 'vitest';
import {
  ENTRY_BUNDLE_PATTERN,
  entryBundleFromHtml,
  entryBundleFromScripts,
  isSafeMomentForReload,
  shouldAutoAttempt,
  markBusy,
  clearBusy,
  currentBusyReasons
} from '../../src/utils/appUpdate.js';

// Auto-update reloads the app on its own when a deploy lands. Everything here
// exists to stop it doing that at the wrong moment: this is a PWA used
// one-handed in a grocery store, and a reload lands on unsaved typing, an open
// edit, a session-only staple, or a half-finished draw if nothing checks.

// The unit suite runs in the `node` environment, so there is no DOM. Every
// browser thing arrives as an argument — which is the point of the injectable
// signature.
const classList = (...names) => ({ contains: (name) => names.includes(name) });
const docWith = (...selectors) => ({
  querySelector: (selector) => (selectors.includes(selector) ? {} : null)
});
const emptyDoc = docWith();
const el = (tagName, extra = {}) => ({ tagName, ...extra });

const safeArgs = (overrides = {}) => ({
  activeElement: el('DIV'),
  bodyClassList: classList(),
  doc: emptyDoc,
  busy: new Set(),
  ...overrides
});

describe('entry bundle detection', () => {
  // Verified against a real production build of this repo. Vue CLI emits
  // exactly these two scripts, vendors first.
  const realIndexHtml =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<title>Meal Hat</title>' +
    '<link href="/css/app.b71ec3fd.css" rel="preload" as="style">' +
    '<script defer="defer" src="/js/chunk-vendors.fa63d614.js"></script>' +
    '<script defer="defer" src="/js/app.1acf3f22.js"></script>' +
    '</head><body><div id="app"></div></body></html>';

  it('finds the hashed entry bundle in a real index.html', () => {
    expect(entryBundleFromHtml(realIndexHtml)).toBe('js/app.1acf3f22.js');
  });

  it('ignores the vendor chunk, which comes FIRST in the document', () => {
    // chunk-vendors changes only when a dependency does, so matching it would
    // miss most deploys entirely — and it is the earlier script tag, so a
    // looser pattern would find it first and never look further.
    expect(entryBundleFromHtml(realIndexHtml)).not.toContain('chunk-vendors');
    expect(ENTRY_BUNDLE_PATTERN.test('js/chunk-vendors.fa63d614.js')).toBe(false);
  });

  it('reads the running bundle off the page\'s own script sources', () => {
    expect(entryBundleFromScripts([
      '/js/chunk-vendors.fa63d614.js',
      '/js/app.1acf3f22.js'
    ])).toBe('js/app.1acf3f22.js');
  });

  it('compares equal when the deploy has not changed', () => {
    expect(entryBundleFromHtml(realIndexHtml))
      .toBe(entryBundleFromScripts(['/js/chunk-vendors.fa63d614.js', '/js/app.1acf3f22.js']));
  });

  it('spots a new deploy as a different filename', () => {
    const newHtml = realIndexHtml.replace('app.1acf3f22.js', 'app.9de40b71.js');
    expect(entryBundleFromHtml(newHtml)).not.toBe(entryBundleFromScripts(['/js/app.1acf3f22.js']));
  });

  it('returns null rather than throwing on junk, so a bad read is a no-op', () => {
    expect(entryBundleFromHtml('')).toBe(null);
    expect(entryBundleFromHtml(null)).toBe(null);
    expect(entryBundleFromHtml('<html>an error page, no scripts at all</html>')).toBe(null);
    expect(entryBundleFromScripts([])).toBe(null);
    expect(entryBundleFromScripts()).toBe(null);
    expect(entryBundleFromScripts([null, '/js/chunk-vendors.fa63d614.js'])).toBe(null);
  });
});

describe('isSafeMomentForReload', () => {
  it('is safe on an ordinary screen with nothing going on', () => {
    expect(isSafeMomentForReload(safeArgs())).toBe(true);
    expect(isSafeMomentForReload(safeArgs({ activeElement: null }))).toBe(true);
  });

  it('never while a form control is focused (the user is typing)', () => {
    // Aisle numbers, quantities, meal names, the quick-add box.
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isSafeMomentForReload(safeArgs({ activeElement: el(tag) }))).toBe(false);
    }
  });

  it('never while a contenteditable is focused', () => {
    expect(isSafeMomentForReload(safeArgs({
      activeElement: el('DIV', { isContentEditable: true })
    }))).toBe(false);
  });

  it('never while the app\'s own modal is open', () => {
    // Modal.vue toggles `show d-block` onto `.modal`.
    expect(isSafeMomentForReload(safeArgs({ doc: docWith('.modal.show') }))).toBe(false);
  });

  it('never while a Bootstrap modal is open', () => {
    // ShoppingList's quick-add uses Bootstrap's Modal, which sets both.
    expect(isSafeMomentForReload(safeArgs({ bodyClassList: classList('modal-open') }))).toBe(false);
    expect(isSafeMomentForReload(safeArgs({
      bodyClassList: classList('modal-open'),
      doc: docWith('.modal.show')
    }))).toBe(false);
  });

  it('never mid-tour (Shepherd would be left pointing at nothing)', () => {
    expect(isSafeMomentForReload(safeArgs({ doc: docWith('.shepherd-element') }))).toBe(false);
  });

  it('never while a screen has registered an in-memory flow as busy', () => {
    expect(isSafeMomentForReload(safeArgs({ busy: new Set(['shopping-list']) }))).toBe(false);
    expect(isSafeMomentForReload(safeArgs({ busy: new Set(['draw-meals']) }))).toBe(false);
  });

  it('survives a caller that hands it nothing useful', () => {
    // Every guard is optional-chained on purpose: a missing document or a
    // stubbed classList must not throw, because throwing here would take the
    // reload path down with it.
    expect(isSafeMomentForReload({
      activeElement: null, bodyClassList: null, doc: null, busy: null
    })).toBe(true);
  });
});

describe('busy reasons', () => {
  beforeEach(() => {
    currentBusyReasons().forEach(clearBusy);
  });

  it('blocks while marked and unblocks when cleared', () => {
    markBusy('shopping-list');
    expect(isSafeMomentForReload({ activeElement: null, bodyClassList: null, doc: null })).toBe(false);

    clearBusy('shopping-list');
    expect(isSafeMomentForReload({ activeElement: null, bodyClassList: null, doc: null })).toBe(true);
  });

  it('is a set, so marking twice still clears once', () => {
    markBusy('draw-meals');
    markBusy('draw-meals');
    clearBusy('draw-meals');
    expect(currentBusyReasons()).toEqual([]);
  });

  it('keeps blocking while any OTHER screen is still busy', () => {
    markBusy('shopping-list');
    markBusy('draw-meals');
    clearBusy('draw-meals');
    expect(currentBusyReasons()).toEqual(['shopping-list']);
    expect(isSafeMomentForReload({ activeElement: null, bodyClassList: null, doc: null })).toBe(false);
  });

  it('ignores a clear for something that was never marked', () => {
    expect(() => clearBusy('never-marked')).not.toThrow();
    expect(currentBusyReasons()).toEqual([]);
  });
});

describe('shouldAutoAttempt', () => {
  const memoryStorage = () => {
    const map = new Map();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => map.set(key, String(value))
    };
  };

  it('attempts once per target bundle, and never twice', () => {
    // This repo has already lived through a reload loop at ~3 page loads a
    // second (2026-08-19). One attempt per bundle is what makes a loop
    // impossible rather than merely slow.
    const storage = memoryStorage();
    expect(shouldAutoAttempt('js/app.1acf3f22.js', storage)).toBe(true);
    expect(shouldAutoAttempt('js/app.1acf3f22.js', storage)).toBe(false);
    expect(shouldAutoAttempt('js/app.1acf3f22.js', storage)).toBe(false);
  });

  it('lets a NEWER deploy have its own attempt', () => {
    // The failure mode of the old "once per tab, ever" guard: it stopped the
    // loop and also stopped every legitimate update after the first.
    const storage = memoryStorage();
    expect(shouldAutoAttempt('js/app.1acf3f22.js', storage)).toBe(true);
    expect(shouldAutoAttempt('js/app.9de40b71.js', storage)).toBe(true);
  });

  it('still attempts when storage is unavailable', () => {
    // Private browsing, blocked storage. Better to try once than never.
    const broken = {
      getItem () { throw new Error('denied'); },
      setItem () { throw new Error('denied'); }
    };
    expect(shouldAutoAttempt('js/app.1acf3f22.js', broken)).toBe(true);
  });
});
