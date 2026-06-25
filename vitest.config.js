import { defineConfig } from 'vitest/config';

// Unit tests only. Playwright e2e specs live under tests/e2e and are run
// separately via `yarn test`.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.spec.js'],
    environment: 'node',
  },
});
