import { describe, it, expect } from 'vitest';
import { saveDraft, readDraft, clearDraft, DRAFT_MAX_AGE_MS } from '../../../src/utils/fridge/talkDraft';

const fakeStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    size: () => data.size
  };
};

// Storage that throws on everything, which is what Safari does in private
// mode. Losing a draft is a nuisance; taking the typing down with it would
// end the feature.
const hostileStorage = () => ({
  getItem: () => { throw new Error('nope'); },
  setItem: () => { throw new Error('nope'); },
  removeItem: () => { throw new Error('nope'); }
});

describe('talkDraft', () => {
  it('saves and gives back what was typed', () => {
    const storage = fakeStorage();
    saveDraft('there is milk', { storage });
    expect(readDraft({ storage }).text).toBe('there is milk');
  });

  it('has nothing to restore before anything is typed', () => {
    expect(readDraft({ storage: fakeStorage() })).toBeNull();
  });

  it('clears itself when the box is emptied', () => {
    const storage = fakeStorage();
    saveDraft('milk', { storage });
    saveDraft('   ', { storage });
    expect(readDraft({ storage })).toBeNull();
  });

  it('will not offer back a draft from another day', () => {
    // Restoring last week's inventory would be worse than restoring nothing.
    const storage = fakeStorage();
    saveDraft('old walk around the kitchen', { storage, now: () => 0 });
    expect(readDraft({ storage, now: () => DRAFT_MAX_AGE_MS + 1 })).toBeNull();
    expect(readDraft({ storage, now: () => DRAFT_MAX_AGE_MS - 1 })).not.toBeNull();
  });

  it('forgets on demand', () => {
    const storage = fakeStorage();
    saveDraft('milk', { storage });
    clearDraft({ storage });
    expect(readDraft({ storage })).toBeNull();
  });

  it('never throws, whatever the storage does', () => {
    const storage = hostileStorage();
    expect(() => saveDraft('milk', { storage })).not.toThrow();
    expect(() => clearDraft({ storage })).not.toThrow();
    expect(readDraft({ storage })).toBeNull();
  });

  it('survives a corrupt entry instead of breaking the screen', () => {
    const storage = fakeStorage();
    storage.setItem('mealhat.fridge.talkDraft', 'not json');
    expect(readDraft({ storage })).toBeNull();
  });
});
