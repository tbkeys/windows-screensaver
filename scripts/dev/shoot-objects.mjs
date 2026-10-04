// Headless screenshots of scripts/dev/objects.html → scripts/out/objects.png, objects-smiley.png, rat.png, objects-lit.png, objects-wire.png
// usage: node scripts/dev/shoot-objects.mjs [port]
import { chromium } from 'playwright';

const port = process.argv[2] || '5191';
const FILES = { corridor: 'objects.png', smiley: 'objects-smiley.png', rat: 'rat.png', lit: 'objects-lit.png', wire: 'objects-wire.png' };
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 980, height: 1000 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => {
  const line = `[console.${m.type()}] ${m.text()}`;
  console.log(line);
  if (m.type() === 'error' || m.type() === 'warning') problems.push(line);
});
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); problems.push(e.message); });
await page.goto(`http://localhost:${port}/scripts/dev/objects.html`);
await page.waitForFunction(() => window.__objectsDev?.done, null, { timeout: 60000 });
const shots = await page.evaluate(() => window.__objectsDev.shots);
for (const shot of shots) {
  const line = await page.evaluate((s) => window.__objectsDev.shoot(s), shot);
  console.log(`--- ${shot}\n${line.split('\n').slice(0, 3).join('\n')}`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `scripts/out/${FILES[shot]}`, clip: { x: 0, y: 0, width: 960, height: 720 } });
}
console.log('---', await page.evaluate(() => window.__objectsDev.probe()));
console.log('---', await page.evaluate(() => window.__objectsDev.soak(240)));
const memory = await page.evaluate(() => window.__objectsDev.teardown());
console.log('--- after teardown:', JSON.stringify(memory));
await page.waitForTimeout(200);
await browser.close();
console.log(problems.length ? `PROBLEMS: ${problems.length}` : 'OK: no console errors/warnings');
process.exit(problems.length ? 1 : 0);
