import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { checkHatAccess, hatToFallBackTo } from '../../src/store/hatAccess';

const denied = () => Promise.reject(new Error('Permission denied'));

describe('checkHatAccess', () => {
  it('is a member when the own member record reads back', async () => {
    const createHat = vi.fn();
    expect(await checkHatAccess({ readOwnMember: async () => true, createHat })).toBe('member');
    expect(createHat).not.toHaveBeenCalled();
  });

  it('creates a hat nobody has made yet (read refused, write allowed)', async () => {
    const createHat = vi.fn(async () => {});
    expect(await checkHatAccess({ readOwnMember: denied, createHat })).toBe('created');
    expect(createHat).toHaveBeenCalledOnce();
  });

  it('is denied when the hat exists and this account is not in it', async () => {
    const onDenied = vi.fn();
    const access = await checkHatAccess({ readOwnMember: denied, createHat: denied, onDenied });
    expect(access).toBe('denied');
    expect(onDenied).toHaveBeenCalledOnce();
  });
});

describe('hatToFallBackTo', () => {
  it('goes back to your own hat when someone else\'s refused you', () => {
    expect(hatToFallBackTo({ deniedHat: 'someone-else', primaryHat: 'me' })).toBe('me');
  });

  it('never switches to the hat that just refused (it would loop)', () => {
    expect(hatToFallBackTo({ deniedHat: 'me', primaryHat: 'me' })).toBeNull();
    expect(hatToFallBackTo({ deniedHat: 'someone-else', primaryHat: undefined })).toBeNull();
  });
});

// The stop itself lives in initializeDB, which this suite cannot import (it
// pulls in firebase and the router). Read as source: a refused hat must return
// before the first listener is attached, or every listener is refused and the
// app sits empty with nothing to say why (Sentry, 2026-11-01).
describe('initializeDB stops on a refused hat', () => {
  const source = readFileSync(resolve(__dirname, '../../src/store/index.js'), 'utf8');
  const body = source.slice(source.indexOf('async initializeDB'));

  it('returns before attaching any hat listener', () => {
    const stop = body.search(/if \(access === 'denied'\) \{[\s\S]*?return;\s*\}/);
    const firstListener = body.indexOf('listenToHat(');
    const firstOnValue = body.indexOf('onValue(');
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(firstListener);
    expect(stop).toBeLessThan(firstOnValue);
  });

  it('remembers the refused hat so Home can explain', () => {
    expect(body).toMatch(/access === 'denied'[\s\S]*?commit\('setDeniedHat', topKey\)/);
  });
});
