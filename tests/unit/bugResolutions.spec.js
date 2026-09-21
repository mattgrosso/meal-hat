import { describe, it, expect, vi } from 'vitest';

// src/firebase initialises the SDK on import; the pure helpers under test
// never touch it.
vi.mock('../../src/firebase', () => ({ db: {}, auth: {}, authReady: Promise.resolve(null) }));

const { unseenResolutions, emailToMemberKey } = await import('../../src/utils/bugResolutions.js');

// The reply half of the bug button (2026-09-21).
describe('unseenResolutions', () => {
  const entries = {
    a: { app: 'meal-hat', understood: 'x', fixed: 'y', resolvedAt: 300, seen: false },
    b: { app: 'meal-hat', understood: 'x', fixed: 'y', resolvedAt: 100, seen: true },
    c: { app: 'another-app', understood: 'x', fixed: 'y', resolvedAt: 200, seen: false },
    d: { understood: 'legacy', fixed: 'no app named', resolvedAt: 50, seen: false },
    e: null
  };

  it("keeps this app's unseen notices, oldest first, and carries the id", () => {
    expect(unseenResolutions(entries).map((n) => n.id)).toEqual(['d', 'a']);
  });

  it('is empty for nothing', () => {
    expect(unseenResolutions(null)).toEqual([]);
  });
});

describe('emailToMemberKey', () => {
  it('matches the rules: lowercased, every unsafe character a dash', () => {
    expect(emailToMemberKey('Someone@Example.com')).toBe('someone@example-com');
    expect(emailToMemberKey(null)).toBeNull();
  });
});
