// The unit tests, run first by `yarn deploy`, so nothing red reaches the
// phones — and before the version bump, so a failed run does not use up a
// version number. Same gate as Movie Hat's scripts/preflight.mjs.
//
// The Playwright suite (`yarn test`) and the emulator rules tests
// (`yarn test:emulated`) stay manual: they need Java and the Firebase
// emulators.
//
//   SKIP_CHECKS=1 yarn deploy   — for a hotfix when the suite itself is broken
//                                 (the build check still runs)

import { spawnSync } from 'child_process';

if (process.env.SKIP_CHECKS) {
  console.log('SKIP_CHECKS set — shipping without the unit tests.');
  process.exit(0);
}

console.log('\nChecking before shipping (yarn test:unit; SKIP_CHECKS=1 to bypass)...');
const result = spawnSync('yarn', ['test:unit'], { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('\n✗ yarn test:unit failed — nothing was built or shipped.');
  process.exit(result.status ?? 1);
}
