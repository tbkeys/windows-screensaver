// Headless run of scripts/dev/sim.html → scripts/out/sim*.png, printing console output and a summary.
// usage: node scripts/dev/shoot-sim.mjs [port] [query]   e.g. node scripts/dev/shoot-sim.mjs 5182 "quantize=4&fps=0"
import { chromium } from 'playwright';

const port = process.argv[2] || '5182';
const query = process.argv[3] || '';
const name = query ? `sim-${query.replace(/[^a-z0-9]+/gi, '_')}` : 'sim';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => {
  const line = `[console.${m.type()}] ${m.text()}`;
  console.log(line);
  if (m.type() === 'error' || m.type() === 'warning') problems.push(line);
});
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); problems.push(e.message); });
await page.goto(`http://localhost:${port}/scripts/dev/sim.html${query ? '?' + query : ''}`);
await page.waitForFunction(() => window.__simDev?.status.frames > 5, null, { timeout: 60000 });
const waitFinish = /waitFinish=1/.test(query);
if (waitFinish) {
  await page.waitForFunction(() => window.__simDev.status.finishes >= 1, null, { timeout: 90000 });
  await page.waitForFunction(() => { const t = window.__simDev.transition; return !t || t.progress >= 0.45; }, null, { timeout: 30000 });
  const mid = await page.evaluate(() => { const t = window.__simDev.transition; return t ? { kind: t.kind, progress: +t.progress.toFixed(2), overlay: +t.overlayAlpha.toFixed(2), yaw: +t.cameraOffset.yaw.toFixed(2) } : null; });
  console.log('mid-transition', JSON.stringify(mid));
} else {
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: `scripts/out/${name}.png` });
if (/quantize=/.test(query)) {
  const q = Number(query.match(/quantize=(\d+)/)[1]);
  const bad = await page.evaluate(async (q) => {
    const d = window.__simDev, out = [];
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const { x, z } = d.walker.pose;
      if (Math.abs(x * q - Math.round(x * q)) > 1e-9 || Math.abs(z * q - Math.round(z * q)) > 1e-9) out.push([x, z]);
    }
    return out;
  }, q);
  console.log(bad.length ? `QUANTIZE VIOLATIONS ${JSON.stringify(bad.slice(0, 3))}` : `quantize=${q}: every sampled pose sits on a 1/${q} cell grid`);
  if (bad.length) problems.push('quantize');
}
const summary = await page.evaluate(() => {
  const d = window.__simDev;
  return {
    fps: +d.loop.fps.toFixed(1), frameTime: +d.loop.frameTime.toFixed(2), running: d.loop.running,
    ticks: d.status.ticks, frames: d.status.frames, errors: d.status.errors,
    steps: d.walker.stats.steps, turns: d.walker.stats.turns, state: d.walker.state, cell: { ...d.walker.cell },
    pose: { ...d.walker.pose },
  };
});
console.log('summary', JSON.stringify(summary));
// Let it run long enough to see a teleport flash + flip, then capture again.
await page.waitForTimeout(4500);
await page.screenshot({ path: `scripts/out/${name}-later.png` });
const later = await page.evaluate(() => ({ ...window.__simDev.status, steps: window.__simDev.walker.stats.steps, finishes: window.__simDev.walker.stats.finishes, state: window.__simDev.walker.state, fps: +window.__simDev.loop.fps.toFixed(1), transition: !!window.__simDev.transition, fixed: window.__simDev.config.timing.fixedTimestep }));
console.log('later', JSON.stringify(later));
if (later.fixed && later.ticks !== later.frames) { console.log(`FIXED TIMESTEP MISMATCH ticks ${later.ticks} frames ${later.frames}`); problems.push('fixed'); }
if (waitFinish && (later.state === 'finished' || later.transition)) { console.log('FINISH DID NOT REGENERATE'); problems.push('finish'); }
await browser.close();
const bad = problems.length || summary.errors.length || summary.steps === 0 || !(summary.fps > 0);
console.log(bad ? `PROBLEMS: ${problems.length} console, ${summary.errors.length} page, steps ${summary.steps}` : 'OK: no console errors/warnings, walker moving');
process.exit(bad ? 1 : 0);
