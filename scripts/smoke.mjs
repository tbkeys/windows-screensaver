#!/usr/bin/env node
// Smoke test against the built site: serves dist/ with `vite preview`, drives the app in
// headless Chromium (SwiftShader) through window.__maze and fails on any console error,
// console warning or page error. Screenshots land in scripts/out/smoke-*.png.
// usage: npx vite build && node scripts/smoke.mjs
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { launchChromium } from './lib/chromium.mjs';

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const OUT = 'scripts/out';
const problems = [];
const log = (...args) => console.log(...args);

if (!existsSync('dist/index.html')) {
  console.error('dist/index.html not found – run `npx vite build` first');
  process.exit(2);
}

const windows = process.platform === 'win32';
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', detached: !windows, shell: windows,
});
const killPreview = () => {
  try { if (windows) preview.kill(); else process.kill(-preview.pid, 'SIGTERM'); } catch { /* already gone */ }
};
process.on('exit', killPreview);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { killPreview(); process.exit(130); });

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(URL)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite preview did not listen on ${PORT}`);
}

let browser = null;
let page = null;
const watchPage = () => {
  page.on('console', (m) => {
    const line = `[console.${m.type()}] ${m.text()}`;
    log(line);
    if (m.type() === 'error' || m.type() === 'warning') problems.push(line);
  });
  page.on('pageerror', (e) => { log('[pageerror]', e.message); problems.push(`pageerror: ${e.message}`); });
};

const step = async (name, fn) => {
  log(`▸ ${name}`);
  try { await fn(); } catch (e) { problems.push(`${name}: ${e.message}`); log(`  FAILED: ${e.message.split('\n')[0]}`); }
};
const shot = (name) => page.screenshot({ path: `${OUT}/smoke-${name}.png` });
const snapshot = () => page.evaluate(() => {
  const m = window.__maze;
  return { seed: m.config.maze.seed, cell: { ...m.walker.cell }, heading: m.walker.heading, state: m.walker.state,
    steps: m.walker.stats.steps, finishes: m.walker.stats.finishes, transition: !!m.transition, fps: +m.loop.fps.toFixed(1) };
});
const waitIdle = () => page.waitForFunction(() => window.__maze.walker.state === 'idle', null, { timeout: 10000 });
const pressAll = async (keys) => { for (const k of keys) await page.keyboard.press(k); };

try {
  await mkdir(OUT, { recursive: true });
  await waitForServer();
  browser = await launchChromium();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  watchPage();

  await step('load + walker makes 3 steps', async () => {
    await page.goto(URL);
    await page.waitForFunction(() => window.__maze?.walker?.stats.steps >= 3, null, { timeout: 30000 });
    log('  ', JSON.stringify(await snapshot()));
    const counts = await page.evaluate(() => ({ polyhedra: window.__maze.decorationLayer.polyhedronCount, smileys: window.__maze.decorationLayer.smileyCount, rats: window.__maze.rats.length, posters: window.__maze.decorations.posters.length }));
    log('   decorations', JSON.stringify(counts));
    if (!(counts.polyhedra > 0 && counts.smileys > 0 && counts.rats > 0 && counts.posters >= 2)) throw new Error('decorations missing');
    await shot('classic');
  });

  for (const id of ['pixelPotato', 'dungeon', 'neonNight']) {
    await step(`preset ${id}`, async () => {
      await page.evaluate((p) => window.__maze.actions.applyPreset(p), id);
      await page.waitForTimeout(1500);
      await shot(id);
    });
  }
  await page.evaluate(() => window.__maze.actions.applyPreset('classic95'));
  await page.waitForTimeout(800);

  await step('manual drive via keyboard (A, then forward into an open side)', async () => {
    await page.evaluate(() => { window.__maze.config.movement.manual = true; window.__maze.walker.clearQueue(); });
    await waitIdle();
    const before = await snapshot();
    await page.keyboard.press('a');
    await page.waitForFunction((h) => window.__maze.walker.heading !== h, before.heading, { timeout: 5000 });
    await waitIdle();
    const keys = await page.evaluate(() => {
      const { walker: w, maze: mz } = window.__maze;
      const turn = (mz.openDirs(w.cell.x, w.cell.y)[0] - w.heading + 4) % 4;
      return [['w'], ['d', 'w'], ['s', 'w'], ['a', 'w']][turn];
    });
    await pressAll(keys);
    await page.waitForFunction((c) => { const k = window.__maze.walker.cell; return k.x !== c.x || k.y !== c.y; }, before.cell, { timeout: 8000 });
    log(`   heading ${before.heading} → moved with keys ${keys.join('+')}:`, JSON.stringify(await snapshot()));
    await page.evaluate(() => { window.__maze.config.movement.manual = false; });
  });

  await step('teleportRandom + flipView (upside-down screenshot)', async () => {
    const before = await snapshot();
    await page.evaluate(() => window.__maze.actions.teleportRandom());
    const after = await snapshot();
    if (after.cell.x === before.cell.x && after.cell.y === before.cell.y) throw new Error('teleport did not move the walker');
    await page.evaluate(() => window.__maze.actions.flipView());
    await page.waitForTimeout(1500);
    const roll = await page.evaluate(() => window.__maze.roll);
    if (Math.abs(roll - Math.PI) > 1e-3) throw new Error(`roll ${roll} is not π`);
    await shot('upside-down');
    await page.evaluate(() => window.__maze.actions.flipView());
    await page.waitForTimeout(1400);
  });

  await step('forced finish → transition → new maze with a new seed', async () => {
    const oldSeed = await page.evaluate(() => {
      const m = window.__maze, mz = m.maze, f = mz.finish;
      const d = mz.openDirs(f.x, f.y)[0];
      m.config.movement.manual = true;
      m.walker.teleport(mz.neighbor(f.x, f.y, d), (d + 2) & 3);
      m.walker.enqueue('forward');
      return m.config.maze.seed;
    });
    await page.waitForFunction(() => window.__maze.transition?.progress >= 0.4, null, { timeout: 15000 });
    await shot('transition');
    await page.waitForFunction((s) => {
      const m = window.__maze;
      return m.config.maze.seed !== s && !m.transition && m.walker.state !== 'finished';
    }, oldSeed, { timeout: 20000 });
    await page.evaluate(() => { window.__maze.config.movement.manual = false; });
    await page.waitForTimeout(1500);
    const now = await snapshot();
    log(`   seed ${oldSeed} → ${now.seed}, finishes ${now.finishes}`);
    await shot('new-maze');
    if (now.finishes < 1 || !(now.fps > 0)) throw new Error(`unexpected state ${JSON.stringify(now)}`);
  });
} catch (e) {
  problems.push(`fatal: ${e.message}`);
} finally {
  await browser?.close();
  killPreview();
}

if (problems.length) {
  log(`\nSMOKE FAILED – ${problems.length} problem(s):`);
  for (const p of problems) log(' -', p);
  process.exit(1);
}
log('\nSMOKE OK – zero console errors/warnings, screenshots in scripts/out/smoke-*.png');
process.exit(0);
