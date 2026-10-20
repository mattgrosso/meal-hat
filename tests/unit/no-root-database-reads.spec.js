import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The store used to hold an onValue subscription on the DATABASE ROOT, purely
// to derive a list of hat names from Object.keys(). Every signed-in client
// therefore downloaded every other account's meals, shopping list and grocery
// catalog in full, on every session — and the security rules had to leave the
// root readable for it to work, which meant an unauthenticated GET of
// `/.json?shallow=true` returned all thirteen account keys (email addresses).
//
// The rules now deny root reads. If a root-scoped read comes back into the
// source, it will fail at runtime as a permission error rather than anything
// legible, so this fences it here instead.
//
// Read as source text on purpose: importing the store pulls in firebase and the
// router, which needs a browser environment this suite doesn't have.
const storeSource = readFileSync(
  resolve(__dirname, '../../src/store/index.js'),
  'utf8'
);

// Strip comments FIRST. The explanation above this very check lives in that
// file and names the thing being forbidden, so matching against raw source
// would find the prose and pass — or fail — for the wrong reason.
function withoutComments (source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the store never reads the database root', () => {
  const code = withoutComments(storeSource);

  it('has no ref(db) call without a path', () => {
    // ref(db) — one argument — is the root. ref(db, 'somewhere') is not.
    const rootRefs = code.match(/\bref\(\s*db\s*\)/g) || [];

    expect(rootRefs).toEqual([]);
  });

  it('subscribes and reads only under a named path', () => {
    const reads = code.match(/\b(?:onValue|get)\(\s*ref\(\s*db\s*[,)]/g) || [];

    // Every read must have passed a path, i.e. `ref(db,` not `ref(db)`.
    expect(reads.every((read) => read.trim().endsWith(','))).toBe(true);
    // And the file should still be doing reads — if this hits zero the regex
    // has drifted and the check above is passing against nothing.
    expect(reads.length).toBeGreaterThan(0);
  });

  it('answers "does this hat exist?" with a targeted lookup', () => {
    expect(code).toContain('async hatExists');
    expect(code).not.toContain('allHatsList');
  });
});

// One level down, the same mistake costs speed instead of privacy. initializeDB
// checked that the hat existed by reading the WHOLE hat — every meal ever
// drawn, the catalog, the usage log — and nothing else loaded until it
// finished. On 2026-10-20 the schedule took ten seconds to appear on a phone.
// Every read must name something inside the hat.
describe('the store never reads a whole hat', () => {
  const code = withoutComments(storeSource);
  const reads = [...code.matchAll(/\b(?:onValue|get)\(\s*(?:query\(\s*)?ref\(\s*db\s*,\s*([^)]*)\)/g)]
    .map((match) => match[1].trim());

  it('finds the reads it is checking', () => {
    expect(reads.length).toBeGreaterThan(5);
  });

  it('gives every read a path below the hat', () => {
    const wholeHat = reads.filter((path) => !path.includes('/'));
    expect(wholeHat).toEqual([]);
  });

  it('checks a hat exists by reading only the member record', () => {
    expect(code).toMatch(/get\(ref\(db, `\$\{topKey\}\/members\/\$\{authUser\.uid\}`\)\)/);
  });
});
