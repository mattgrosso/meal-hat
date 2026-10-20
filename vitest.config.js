import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests only. Playwright e2e specs live under tests/e2e and are run
// separately via `yarn test`.
export default defineConfig({
  // The same `@` as vite.config.mjs, so a store module can be imported whole.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/unit/**/*.spec.js'],
    environment: 'node',
  },
});
