import {
  describe, it, expect, vi, beforeEach
} from 'vitest';

// The network layer, stubbed. `set` is the only thing that can fail, and
// whether it fails is the whole point of these tests.
const set = vi.fn();
vi.mock('firebase/database', () => ({
  getDatabase: () => ({}),
  ref: (_db, path) => ({ path }),
  push: (node) => ({ ...node, key: 'generated-key' }),
  set: (...args) => set(...args),
  serverTimestamp: () => ({ '.sv': 'timestamp' })
}));

const { submitBugReport, flushStashedBugReports } = await import('../../src/utils/bugReports.js');

const STASH_KEY = 'mealhat-pending-bug-reports';

// vitest runs this suite in `node`, so the browser globals the module touches
// have to exist. Kept deliberately small — anything more elaborate would be
// testing the stub rather than the code.
function installBrowserGlobals () {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  // defineProperty, not assignment: `navigator` is a read-only accessor on
  // Node 22's global object, so `global.navigator = …` throws.
  Object.defineProperty(global, 'navigator', {
    value: { onLine: true, userAgent: 'test-agent' },
    configurable: true,
    writable: true
  });
  Object.defineProperty(global, 'window', {
    value: { innerWidth: 390, innerHeight: 844, devicePixelRatio: 3, location: { href: 'https://mealhat.com/#/' } },
    configurable: true,
    writable: true
  });
}

const storeStub = {
  state: {
    userEmail: 'matt@example.com',
    databaseTopKey: 'matt-example-com',
    meals: [{ id: 'm1' }, { id: 'm2' }],
    drawnMeals: [{ id: 'd1' }],
    drawnMealsWithHistory: [{ id: 'd1' }, { id: 'd0' }],
    shoppingList: {
      a: { id: 'a', source: 'meal', purchased: false },
      b: { id: 'b', source: 'manual', purchased: true },
      c: { id: 'c', source: 'meal', purchased: false }
    },
    groceryCatalog: { g1: {}, g2: {} },
    mealHatsList: ['matt-example-com', 'family']
  },
  getters: { primaryDatabaseTopKey: 'matt-example-com' }
};

const route = { fullPath: '/shopping-list' };
const stash = () => JSON.parse(global.localStorage.getItem(STASH_KEY) || '[]');

beforeEach(() => {
  installBrowserGlobals();
  set.mockReset();
  set.mockResolvedValue(undefined);
});

describe('submitBugReport', () => {
  it('refuses an empty report rather than filing a blank one', async () => {
    await expect(submitBugReport(storeStub, '   ', route)).rejects.toThrow(/describe what happened/i);
    expect(set).not.toHaveBeenCalled();
  });

  it('sends the transcript and does not queue', async () => {
    const result = await submitBugReport(storeStub, 'the list went blank', route);

    expect(result).toEqual({ queued: false });
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][1].transcript).toBe('the list went blank');
    expect(stash()).toHaveLength(0);
  });

  it('stringifies the app state', async () => {
    // Not stylistic: RTDB silently drops keys whose value is an empty object,
    // so a nested object here can lose fields with no warning at all.
    await submitBugReport(storeStub, 'x', route);
    const written = set.mock.calls[0][1];

    expect(typeof written.appState).toBe('string');
    expect(JSON.parse(written.appState)).toMatchObject({
      route: '/shopping-list',
      hat: 'matt-example-com',
      isPrimaryHat: true,
      mealCount: 2,
      drawnUpcoming: 1,
      drawnLoaded: 2,
      shoppingTotal: 3,
      shoppingFromMeals: 2,
      shoppingManual: 1,
      shoppingPurchased: 1
    });
  });

  it('stashes instead of losing the text when offline', async () => {
    global.navigator.onLine = false;
    set.mockRejectedValue(new Error('network down'));

    const result = await submitBugReport(storeStub, 'happened in the shop', route);

    expect(result).toEqual({ queued: true });
    expect(stash()).toHaveLength(1);
    expect(stash()[0].transcript).toBe('happened in the shop');
    expect(stash()[0].queuedOffline).toBe(true);
    // Re-stamped server-side on the real write; the offline device's clock is
    // recorded separately rather than trusted.
    expect(stash()[0].createdAt).toBeNull();
    expect(typeof stash()[0].clientCreatedAt).toBe('number');
  });

  it('still stashes when a write fails while ONLINE, but reports the failure', async () => {
    set.mockRejectedValue(new Error('permission denied'));

    // The user must see that it did not send — but the text is kept anyway.
    await expect(submitBugReport(storeStub, 'online failure', route)).rejects.toThrow('permission denied');
    expect(stash()).toHaveLength(1);
  });

  it('caps the stash so a long offline spell cannot fill storage', async () => {
    global.navigator.onLine = false;
    set.mockRejectedValue(new Error('down'));

    for (let i = 0; i < 14; i++) {
      await submitBugReport(storeStub, `report ${i}`, route);
    }

    expect(stash()).toHaveLength(10);
    // The OLDEST are dropped, not the newest.
    expect(stash()[0].transcript).toBe('report 4');
    expect(stash()[9].transcript).toBe('report 13');
  });
});

describe('flushStashedBugReports', () => {
  async function stashTwo () {
    global.navigator.onLine = false;
    set.mockRejectedValue(new Error('down'));
    await submitBugReport(storeStub, 'first', route);
    await submitBugReport(storeStub, 'second', route);
    global.navigator.onLine = true;
    set.mockReset();
    set.mockResolvedValue(undefined);
  }

  it('sends everything stashed and clears it', async () => {
    await stashTwo();

    expect(await flushStashedBugReports()).toBe(2);
    expect(set).toHaveBeenCalledTimes(2);
    expect(stash()).toHaveLength(0);
  });

  it('does nothing while still offline', async () => {
    await stashTwo();
    global.navigator.onLine = false;

    expect(await flushStashedBugReports()).toBe(0);
    expect(set).not.toHaveBeenCalled();
    expect(stash()).toHaveLength(2);
  });

  it('keeps the remainder when the connection dies mid-flush', async () => {
    await stashTwo();
    set.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('dropped'));

    expect(await flushStashedBugReports()).toBe(1);
    // The one that did not send is still there — and it is the RIGHT one.
    expect(stash()).toHaveLength(1);
    expect(stash()[0].transcript).toBe('second');
  });

  it('is a no-op with nothing stashed', async () => {
    expect(await flushStashedBugReports()).toBe(0);
    expect(set).not.toHaveBeenCalled();
  });

  it('survives corrupt stash contents', async () => {
    global.localStorage.setItem(STASH_KEY, 'not json at all');

    expect(await flushStashedBugReports()).toBe(0);
  });
});
