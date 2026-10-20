// The hat-existence probe, against the real rules.
//
// initializeDB used to answer "does this hat exist, and am I in it?" by reading
// the whole hat. Since 2026-10-20 it reads only <hat>/members/<uid>, which is
// a few bytes instead of the entire draw history. That is only safe if the
// rules answer the small read exactly as they answered the big one — so this
// pins all three cases the probe's catch block depends on.
//
// Run with: yarn test:emulated
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { ref, get, set } from 'firebase/database';

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-meal-hat-probe',
    database: {
      rules: readFileSync('database.rules.json', 'utf8'),
      host: '127.0.0.1',
      port: 9000,
    },
  });
});

afterAll(async () => { if (testEnv) await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearDatabase();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database(), 'existing-hat'), {
      joinCode: 'abc123',
      members: { owner: { joined: true, code: 'abc123' } },
      meals: { m1: { name: 'Chili' } },
    });
  });
});

describe('meal-hat: the hat probe reads only the member record', () => {
  it('a member can read their own member record', async () => {
    const db = testEnv.authenticatedContext('owner').database();
    const snapshot = await assertSucceeds(get(ref(db, 'existing-hat/members/owner')));
    expect(snapshot.exists()).toBe(true);
  });

  it('a non-member is refused, and cannot create over the hat (invite link needed)', async () => {
    const db = testEnv.authenticatedContext('stranger').database();
    await assertFails(get(ref(db, 'existing-hat/members/stranger')));
    await assertFails(set(ref(db, 'existing-hat'), {
      joinCode: 'x', members: { stranger: { joined: true, code: 'x' } },
    }));
  });

  it('a hat that does not exist is refused, and may then be created', async () => {
    const db = testEnv.authenticatedContext('newcomer').database();
    await assertFails(get(ref(db, 'new-hat/members/newcomer')));
    await assertSucceeds(set(ref(db, 'new-hat'), {
      joinCode: 'y', members: { newcomer: { joined: true, code: 'y' } },
    }));
    const snapshot = await assertSucceeds(get(ref(db, 'new-hat/members/newcomer')));
    expect(snapshot.exists()).toBe(true);
  });
});
