import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

// The guided tours attach each step to an element by `[data-step="N"]`. Nothing
// checks that the element exists: Shepherd just floats an unanchored step in
// the middle of the screen, pointing at nothing, with no error. So a tour goes
// stale the moment somebody renames, renumbers or deletes an anchor while
// editing a template — which is exactly what happens during ordinary work.
//
// This pairs the two halves up and fails if they disagree in either direction:
//
//   a step pointing at a missing anchor  -> the step floats, silently
//   an anchor no step points at          -> a step was probably dropped
//
// It cannot check that the WORDS are still true — only a human can — but it
// does catch the structural half automatically.
const COMPONENT_DIR = resolve(__dirname, '../../src/components');

// Everything before <script> is the template. NOT split('</template>')[0] —
// components legitimately contain nested <template v-if>/<template v-for>
// blocks, and splitting on the first close cuts the real template short. That
// mistake made this check silently miss anchors in MealHats.vue.
const templateOf = (source) => source.split(/<script[\s>]/)[0];

const numbersIn = (source, pattern) => {
  const found = new Set();
  for (const match of source.matchAll(pattern)) found.add(match[1]);
  return [...found].sort();
};

function tourComponents () {
  return readdirSync(COMPONENT_DIR)
    .filter((file) => file.endsWith('.vue'))
    .map((file) => ({ file, source: readFileSync(join(COMPONENT_DIR, file), 'utf8') }))
    .filter(({ source }) => source.includes('startTour'));
}

describe('guided tour anchors', () => {
  const components = tourComponents();

  it('finds the components that have tours', () => {
    // If this drops to zero the matching below is passing against nothing.
    expect(components.length).toBeGreaterThan(0);
  });

  components.forEach(({ file, source }) => {
    it(`${file}: every step points at an anchor that exists, and vice versa`, () => {
      const template = templateOf(source);

      // Anchors in the markup. Covers both the static form and the bound form
      // used where an anchor moves between two conditional elements.
      const anchors = numbersIn(template, /data-step="(\d+)"/g)
        .concat(numbersIn(template, /:data-step="[^"]*?'(\d+)'/g));

      // Steps in the tour code.
      const referenced = numbersIn(source, /\[data-step="(\d+)"\]/g);

      const unique = (list) => [...new Set(list)].sort();

      expect(unique(referenced), `${file}: tour steps point at anchors that are not in the template`)
        .toEqual(unique(referenced).filter((n) => unique(anchors).includes(n)));

      expect(unique(anchors), `${file}: template has data-step anchors no tour step uses`)
        .toEqual(unique(anchors).filter((n) => unique(referenced).includes(n)));
    });
  });
});
