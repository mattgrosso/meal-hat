import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkBuild } from '../../scripts/check-build.mjs';

// `yarn deploy` runs this between the build and the upload. Every failure it
// guards is silent in production — deploys just stop reaching open apps — so
// each guard gets a case that would have shipped without it.

const GOOD_WORKER = 'define(["./workbox-b2046692"],(function(e){"use strict";self.skipWaiting(),e.clientsClaim(),e.precacheAndRoute([{url:"/index.html",revision:"8f0c280d3d75f248abdeeb19d8e704fe"}],{})}));';
const GOOD_HTML = '<script type="module" crossorigin src="/js/app.1a2b3c4d.js"></script>';

let dist;
const write = (name, text) => writeFileSync(join(dist, name), text);

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'meal-hat-dist-'));
  mkdirSync(join(dist, 'js'));
  write('service-worker.js', GOOD_WORKER);
  write('index.html', GOOD_HTML);
  write('js/app.1a2b3c4d.js', '');
});

afterEach(() => rmSync(dist, { recursive: true, force: true }));

describe('checkBuild', () => {
  it('passes a build like the real one', () => {
    expect(checkBuild(dist)).toEqual([]);
  });

  it('fails when the worker is not service-worker.js', () => {
    rmSync(join(dist, 'service-worker.js'));
    write('sw.js', GOOD_WORKER);
    const problems = checkBuild(dist);
    expect(problems.join(' ')).toMatch(/service-worker\.js is missing/);
    expect(problems.join(' ')).toMatch(/sw\.js exists/);
  });

  it('fails an empty precache list', () => {
    write('service-worker.js', GOOD_WORKER.replace(/\[\{url[^\]]*\]/, '[]'));
    expect(checkBuild(dist).join(' ')).toMatch(/precaches: nothing/);
  });

  it('fails a widened precache list', () => {
    write('service-worker.js', GOOD_WORKER.replace('}]', '},{url:"/js/app.1a2b3c4d.js",revision:null}]'));
    expect(checkBuild(dist).join(' ')).toMatch(/exactly \/index\.html/);
  });

  it('fails index.html with no revision', () => {
    write('service-worker.js', GOOD_WORKER.replace('"8f0c280d3d75f248abdeeb19d8e704fe"', 'null'));
    expect(checkBuild(dist).join(' ')).toMatch(/no revision/);
  });

  it('fails a worker with no precache call at all', () => {
    write('service-worker.js', 'self.skipWaiting();');
    expect(checkBuild(dist).join(' ')).toMatch(/no precacheAndRoute/);
  });

  it('fails an entry bundle off the hex alphabet', () => {
    write('index.html', '<script src="/js/app.Ab_9-xQz.js"></script>');
    expect(checkBuild(dist).join(' ')).toMatch(/no js\/app\.<hex>\.js/);
  });

  it('fails an entry bundle Vite named index', () => {
    write('index.html', '<script src="/js/index.1a2b3c4d.js"></script>');
    expect(checkBuild(dist).join(' ')).toMatch(/no js\/app\.<hex>\.js/);
  });

  it('fails when index.html points at a bundle that is not there', () => {
    rmSync(join(dist, 'js/app.1a2b3c4d.js'));
    expect(checkBuild(dist).join(' ')).toMatch(/not in dist/);
  });
});
