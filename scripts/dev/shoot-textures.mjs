// Headless screenshot of scripts/dev/textures.html → scripts/out/textures.png
// usage: node scripts/dev/shoot-textures.mjs [port]
import { launchChromium } from '../lib/chromium.mjs';

const port = process.argv[2] || '5181';
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1300, height: 1180 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => {
  const line = `[console.${m.type()}] ${m.text()}`;
  console.log(line);
  if (m.type() === 'error' || m.type() === 'warning') problems.push(line);
});
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); problems.push(e.message); });
await page.goto(`http://localhost:${port}/scripts/dev/textures.html`);
await page.waitForFunction(() => window.__texturesDev?.done, null, { timeout: 60000 });
await page.waitForTimeout(500);
await page.screenshot({ path: 'scripts/out/textures.png' });
await browser.close();
console.log(problems.length ? `PROBLEMS: ${problems.length}` : 'OK: no console errors/warnings');
process.exit(problems.length ? 1 : 0);
