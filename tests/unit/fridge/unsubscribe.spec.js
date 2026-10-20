import {
  describe, it, expect, vi, beforeEach
} from 'vitest';

// Sentry, 2026-10-20: signing out left the fridge's three listeners open, so
// the server revoked them with permission errors, and `subscribedTo` stayed
// set, so signing back in without a reload never reattached them.

const detached = [];
const attached = [];
vi.mock('firebase/database', () => ({
  ref: (_db, path) => ({ path }),
  query: (node) => node,
  limitToLast: () => ({}),
  get: async () => ({ exists: () => true }),
  onValue: (node) => {
    attached.push(node.path);
    return () => detached.push(node.path);
  },
  push: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  off: vi.fn(),
  serverTimestamp: () => ({})
}));
vi.mock('@/firebase', () => ({ db: {}, ensureSession: async () => {} }));

const { default: fridge } = await import('../../../src/store/fridge/index.js');

const KEY = 'k'.repeat(32);

function makeContext () {
  const state = fridge.state();
  const commit = (type, payload) => fridge.mutations[type](state, payload);
  return { state, commit };
}

describe('fridge/unsubscribe', () => {
  beforeEach(() => {
    // The detach list is module-level: drop whatever the last test left open.
    fridge.actions.unsubscribe(makeContext());
    attached.length = 0;
    detached.length = 0;
  });

  it('detaches every listener subscribe attached and forgets the fridge', async () => {
    const context = makeContext();
    await fridge.actions.subscribe(context, KEY);
    expect(attached).toHaveLength(3);

    fridge.actions.unsubscribe(context);
    expect(detached.sort()).toEqual([...attached].sort());
    expect(context.state.subscribedTo).toBe(null);
    expect(context.state.fridgeKey).toBe(null);
    expect(context.state.timers).toEqual({});
  });

  it('lets the next sign-in subscribe again', async () => {
    const context = makeContext();
    await fridge.actions.subscribe(context, KEY);
    fridge.actions.unsubscribe(context);
    attached.length = 0;

    await fridge.actions.subscribe(context, KEY);
    expect(attached).toHaveLength(3);
    expect(context.state.subscribedTo).toBe(KEY);
  });

  it('detaches nothing twice', async () => {
    const context = makeContext();
    await fridge.actions.subscribe(context, KEY);
    fridge.actions.unsubscribe(context);
    fridge.actions.unsubscribe(context);
    expect(detached).toHaveLength(3);
  });
});
