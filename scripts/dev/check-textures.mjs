// Objective checks for src/render/textures.js, run against the dev page in headless Chromium:
//  * seam ratio per surface kind = mean |Δ| across the wrap edge ÷ mean |Δ| between interior
//    neighbours (≈1 ⇒ seamless, ≫1 ⇒ visible seam)
//  * generation time of every kind at 1024²
// usage: node scripts/dev/check-textures.mjs [port]
import { launchChromium } from '../lib/chromium.mjs';

const port = process.argv[2] || '5181';
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1300, height: 1180 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}/scripts/dev/textures.html`);
await page.waitForFunction(() => window.__texturesDev?.done, null, { timeout: 60000 });

const results = await page.evaluate(async () => {
  const mod = await import('/src/render/textures.js');
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const diff = (d, i, j) => Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
  const seams = {};
  for (const kind of mod.SURFACE_KIND_IDS) {
    const tex = mod.createTexture(kind, { resolution: 256, seed: 'windows95' });
    const n = tex.image.width;
    const d = tex.image.getContext('2d').getImageData(0, 0, n, n).data;
    const idx = (x, y) => (y * n + x) * 4;
    const edgeX = [], innerX = [], edgeY = [], innerY = [];
    for (let y = 0; y < n; y++) {
      edgeX.push(diff(d, idx(0, y), idx(n - 1, y)));
      for (let x = 1; x < n; x++) innerX.push(diff(d, idx(x, y), idx(x - 1, y)));
    }
    for (let x = 0; x < n; x++) {
      edgeY.push(diff(d, idx(x, 0), idx(x, n - 1)));
      for (let y = 1; y < n; y++) innerY.push(diff(d, idx(x, y), idx(x, y - 1)));
    }
    const mx = mean(innerX) || 1, my = mean(innerY) || 1;
    seams[kind] = { seamX: +(mean(edgeX) / mx).toFixed(2), seamY: +(mean(edgeY) / my).toFixed(2), flat: mean(innerX) < 0.01 && mean(innerY) < 0.01 };
    tex.dispose();
  }
  const timings = {};
  for (const { id } of mod.TEXTURE_KINDS) {
    const t0 = performance.now();
    const tex = mod.createTexture(id, { resolution: 1024, seed: 'windows95' });
    timings[id] = +(performance.now() - t0).toFixed(0);
    tex.dispose();
  }
  return { seams, timings };
});
await browser.close();

// Hard-edged patterns legitimately change colour exactly at the wrap edge: an even checker
// flips colour across the edge, and metal plates meet light-bevel to dark-bevel.
const DESIGNED_EDGE = new Set(['checker', 'custom', 'metal']);
console.log('seam ratios (≈1 is seamless, flat textures reported as flat):');
let bad = 0;
for (const [kind, r] of Object.entries(results.seams)) {
  const suspicious = r.seamX > 1.6 || r.seamY > 1.6;
  const flag = r.flat ? 'flat' : DESIGNED_EDGE.has(kind) ? 'designed edge' : suspicious ? 'SEAM?' : 'ok';
  if (flag === 'SEAM?') bad++;
  console.log(`  ${kind.padEnd(10)} x ${String(r.seamX).padStart(5)}  y ${String(r.seamY).padStart(5)}  ${flag}`);
}
console.log('generation time at 1024² (ms):', results.timings);
console.log(bad ? `SEAMS SUSPECTED: ${bad}` : 'OK: no seams suspected');
process.exit(bad ? 1 : 0);
