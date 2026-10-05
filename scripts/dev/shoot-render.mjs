// Headless screenshots of scripts/dev/render.html → scripts/out/render-{classic,lit,post}.png
// usage: node scripts/dev/shoot-render.mjs [port]
import { launchChromium } from '../lib/chromium.mjs';

const port = process.argv[2] || '5187';
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 980, height: 1060 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => {
  const line = `[console.${m.type()}] ${m.text()}`;
  console.log(line);
  if (m.type() === 'error' || m.type() === 'warning') problems.push(line);
});
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); problems.push(e.message); });
await page.goto(`http://localhost:${port}/scripts/dev/render.html`);
await page.waitForFunction(() => window.__renderDev?.done, null, { timeout: 60000 });
const modes = await page.evaluate(() => window.__renderDev.modes);
for (const mode of modes) {
  const info = await page.evaluate((m) => window.__renderDev.render(m), mode);
  console.log(`--- ${mode}\n${info.split('\n').slice(0, 3).join('\n')}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `scripts/out/render-${mode}.png` });
}
const memory = await page.evaluate(() => window.__renderDev.teardown());
console.log('--- after teardown:', JSON.stringify(memory));
await page.waitForTimeout(200);
await browser.close();
console.log(problems.length ? `PROBLEMS: ${problems.length}` : 'OK: no console errors/warnings');
process.exit(problems.length ? 1 : 0);
