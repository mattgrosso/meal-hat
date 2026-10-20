import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// The launch splash (2026-10-20): opening the home-screen app used to show a
// blank page for seconds. index.html now paints the app's white from the first
// byte, shows the icon and name inside #app until Vue's mount replaces them,
// and hands iOS a launch image for every current iPhone screen.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8'));

// PNG width/height live at fixed offsets in the IHDR chunk.
const pngSize = (file) => {
  const buf = readFileSync(file);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

describe('launch splash', () => {
  it('paints the page before any bundled CSS loads', () => {
    const inlineStyle = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    expect(inlineStyle).toMatch(/html, body \{ background-color: #ffffff; \}/);
    expect(inlineStyle).toContain('.launch-splash');
  });

  it('puts the splash inside #app, so mounting the app is what removes it', () => {
    const app = html.match(/<div id="app">([\s\S]*?)<\/div>\s*<\/body>/)[1];
    expect(app).toContain('class="launch-splash"');
    expect(app).toContain('src="/img/splash-icon.png"');
    expect(app).toContain('Meal Hat');
    expect(existsSync(resolve(root, 'public/img/splash-icon.png'))).toBe(true);
  });

  it('keeps the installed app\'s background the same white as the splash', () => {
    expect(manifest.background_color).toBe('#ffffff');
  });

  it('has a launch image for each listed iPhone screen, at that screen\'s real pixel size', () => {
    const links = [...html.matchAll(/<link rel="apple-touch-startup-image" href="([^"]+)" media="\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\)/g)];
    expect(links.length).toBeGreaterThanOrEqual(10);
    for (const [, href, w, h, dpr] of links) {
      const file = resolve(root, 'public' + href);
      expect(existsSync(file), href).toBe(true);
      expect(pngSize(file), href).toEqual([w * dpr, h * dpr]);
    }
    expect(links.some(([, , w, h, dpr]) => w === '402' && h === '874' && dpr === '3')).toBe(true);
  });
});
