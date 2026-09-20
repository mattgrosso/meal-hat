import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

// Two source-scanning guards for two bugs Matt found within a minute of each
// other on 2026-09-20. Neither can be caught by a unit test of behaviour —
// both live entirely in CSS — and both have a silent failure mode, which is
// exactly the kind of thing this repo already turns into a failing test (see
// no-responsive-utilities.spec.js).

const SRC = resolve(__dirname, '../../../src');
const FRIDGE_SHELL = join(SRC, 'components/Fridge.vue');
const FRIDGE_DIR = join(SRC, 'components/fridge');
const HEADER = join(SRC, 'components/Header.vue');

const fridgeFiles = [
  FRIDGE_SHELL,
  ...readdirSync(FRIDGE_DIR).filter((f) => f.endsWith('.vue')).map((f) => join(FRIDGE_DIR, f))
];

const styleBlock = (file) => {
  const text = readFileSync(file, 'utf8');
  const at = text.indexOf('<style');
  return at === -1 ? '' : text.slice(at);
};

// Strip comments so a class name MENTIONED in prose isn't read as a selector.
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the fridge does not restyle the house header', () => {
  // THE BUG. `Fridge.vue`'s styles are deliberately UNSCOPED and nested under
  // `.fridge-app`. When the house Header moved inside the fridge, its rule for
  // `.build-stamp` started capturing the HEADER's stamp — and the two
  // together set all four offsets on a fixed element (`top` and `right` from
  // the header, `bottom` and `left` from the fridge). A fixed box with all
  // four offsets STRETCHES, so the header's stamp became an invisible
  // full-viewport overlay that swallowed every tap on the page.
  //
  // What Matt saw: "tapping the logo in the top right... here it seems to
  // just reload the page." His tap was landing on a screen-sized build stamp,
  // and tapping a build stamp reloads the app.
  const headerClasses = [...withoutComments(readFileSync(HEADER, 'utf8'))
    .matchAll(/class="([^"{]+)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean);

  it('shares no class name with Header.vue in its unscoped block', () => {
    const css = withoutComments(styleBlock(FRIDGE_SHELL));
    // Only the shell is unscoped; the sheets are `scoped` and cannot reach out.
    expect(readFileSync(FRIDGE_SHELL, 'utf8')).toContain('<style lang="scss">');

    const collisions = [...new Set(headerClasses)].filter((cls) =>
      new RegExp(`\\.${cls.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`).test(css)
    );

    expect(collisions, `Fridge.vue's unscoped styles would capture the header's ${collisions.join(', ')}`)
      .toEqual([]);
  });

  it('every OTHER fridge stylesheet is scoped', () => {
    fridgeFiles
      .filter((f) => f !== FRIDGE_SHELL)
      .forEach((f) => {
        expect(readFileSync(f, 'utf8'), `${f} must use <style scoped>`).toMatch(/<style[^>]*\bscoped\b/);
      });
  });
});

describe('full-height rules carry a dvh fallback', () => {
  // THE OTHER BUG. On iOS, `100vh` is the LARGE viewport — the height the page
  // would have if the browser toolbars were hidden. A bottom-aligned sheet
  // measured against it hangs below what you can actually see, and the last
  // rows are unreachable even by scrolling.
  //
  // Matt: "the bottom edge is getting cut off... we need to figure out how to
  // make sure that doesn't happen across all these screens." `dvh` tracks the
  // visible area; the `vh` line stays as the fallback.
  fridgeFiles.forEach((file) => {
    const name = file.split('/').pop();
    it(`${name} pairs every 100vh with 100dvh`, () => {
      const css = withoutComments(styleBlock(file));
      const lines = css.split('\n');

      lines.forEach((line, i) => {
        const match = line.match(/^\s*(min-height|height):\s*100vh;/);
        if (!match) return;
        const next = lines[i + 1] || '';
        expect(next, `${name}:${i + 1} — "${line.trim()}" needs "${match[1]}: 100dvh;" on the next line`)
          .toMatch(new RegExp(`^\\s*${match[1]}:\\s*100dvh;`));
      });
    });
  });
});
