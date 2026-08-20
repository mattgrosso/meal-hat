import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

// Responsive variants of the Bootstrap UTILITIES are not generated — see the
// `responsive: false` block in vue.config.js. That saved ~4KB gzipped, on the
// evidence that the templates used exactly one breakpoint class and it was a
// grid column rather than a utility.
//
// The reason this test exists: that trade has a SILENT failure mode. Add
// `d-md-none` to a template later and nothing errors, nothing warns — the class
// simply does not exist and the element stays visible. This turns that into a
// failing test with an explanation.
//
// Grid classes are unaffected and stay allowed. `col-md-2`, offsets and
// `row-cols-*` come from _grid.scss, which is imported in full and has nothing
// to do with the utilities API.
const COMPONENT_DIR = resolve(__dirname, '../../src/components');
const SRC_DIR = resolve(__dirname, '../../src');

const BREAKPOINT = /\b([a-z][a-z-]*)-(sm|md|lg|xl|xxl)-([a-z0-9-]+)/g;

// Prefixes still generated at every breakpoint, because they come from the grid
// rather than from $utilities.
const GRID_PREFIXES = ['col', 'offset', 'row-cols'];

function templateFiles () {
  const files = readdirSync(COMPONENT_DIR).filter((f) => f.endsWith('.vue')).map((f) => join(COMPONENT_DIR, f));
  files.push(join(SRC_DIR, 'App.vue'));
  return files;
}

describe('responsive utility classes are not used', () => {
  it('finds only grid breakpoint classes in the templates', () => {
    const offenders = [];

    for (const file of templateFiles()) {
      const source = readFileSync(file, 'utf8');
      // Only the template half — a breakpoint inside a media query in <style>
      // is ordinary CSS and perfectly fine. Split on <script>, not on the first
      // </template>: nested <template v-if>/<template v-for> blocks are normal
      // and would cut the real template short.
      const template = source.split(/<script[\s>]/)[0];

      for (const match of template.matchAll(BREAKPOINT)) {
        const [full, prefix] = match;
        if (GRID_PREFIXES.includes(prefix)) continue;
        offenders.push(`${file.split('/').pop()}: ${full}`);
      }
    }

    expect(
      offenders,
      'Responsive utility variants are not generated (vue.config.js sets responsive: false ' +
      'on $utilities to save ~4KB gzipped). These classes will silently do NOTHING. ' +
      'Either use a plain utility plus a media query in the component\'s own <style>, ' +
      'or re-enable responsive utilities and drop this test.'
    ).toEqual([]);
  });

  it('still permits grid breakpoints, which are unaffected', () => {
    // Header.vue uses col-6 col-md-2. If this ever fails, the allow-list above
    // has drifted from what the grid actually generates.
    const header = readFileSync(join(COMPONENT_DIR, 'Header.vue'), 'utf8');

    expect(header).toContain('col-md-2');
  });
});
