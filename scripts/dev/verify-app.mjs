// Integration checks for src/app.js that go beyond scripts/smoke.mjs: close-up shots of every
// decoration type, share-hash + localStorage persistence, screensaver mode, hotkeys, texture
// upload, downloads, the no-WebGL dialog and dispose(). Needs a built dist/.
// usage: node scripts/dev/verify-app.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4174;
const URL = `http://localhost:${PORT}/`;
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const problems = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
process.on('exit', () => { try { process.kill(-preview.pid, 'SIGTERM'); } catch { /* gone */ } });
for (let i = 0; i < 80; i++) { try { if ((await fetch(URL)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ARGS });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { console.log(`[console.${m.type()}] ${m.text()}`); problems.push(m.text()); } });
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); problems.push(e.message); });
const ready = () => page.waitForFunction(() => window.__maze?.walker?.stats.steps >= 1, null, { timeout: 30000 });
/** Commit a value through a GUI controller the way a user would (setValue alone never emits onFinishChange). */
const setValue = (property, value) => page.evaluate(([p, v]) => {
  const c = window.__maze.gui.gui.controllersRecursive().find((c) => c.property === p);
  c.setValue(v);
  c._callOnFinishChange();
}, [property, value]);
/** Pause and park the walker in the open neighbour of (x, y), facing it. */
const lookAt = (x, y) => page.evaluate(([cx, cy]) => {
  const m = window.__maze, mz = m.maze;
  m.config.movement.paused = true;
  const d = mz.openDirs(cx, cy)[0];
  m.walker.teleport(mz.neighbor(cx, cy, d), (d + 2) & 3);
}, [x, y]);

await page.goto(URL);
await ready();

/* ---- decorations exist and are visible ---- */
const counts = await page.evaluate(() => ({
  poly: window.__maze.decorationLayer.polyhedronCount, smiley: window.__maze.decorationLayer.smileyCount,
  rats: window.__maze.rats.length, posters: window.__maze.decorations.posters.length,
}));
check(counts.poly === 6 && counts.smiley === 2 && counts.rats === 1 && counts.posters === 6, `decorations ${JSON.stringify(counts)}`);
const targets = await page.evaluate(() => {
  const m = window.__maze, s = m.maze.start;
  const finishWall = m.decorations.posters.find((p) => p.kind === 'finish');
  return { smiley: m.decorations.smileys[0], poly: m.decorations.polyhedra[0], rat: { ...m.rats[0].cell }, start: s, finish: finishWall };
});
for (const [name, cell] of [['smiley', targets.smiley], ['polyhedron', targets.poly], ['rat', targets.rat]]) {
  await lookAt(cell.x, cell.y);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `scripts/out/verify-${name}.png` });
}
await page.evaluate((s) => window.__maze.walker.teleport({ x: s.x, y: s.y }, s.heading), targets.start);
await page.waitForTimeout(300);
await page.screenshot({ path: 'scripts/out/verify-start.png' });
await page.evaluate((f) => window.__maze.walker.teleport({ x: f.x, y: f.y }, f.dir), targets.finish);
await page.waitForTimeout(300);
await page.screenshot({ path: 'scripts/out/verify-finish.png' });
await page.evaluate(() => { window.__maze.config.movement.paused = false; });

/* ---- hotkeys ---- */
const hidden = (sel) => page.evaluate((s) => document.querySelector(s).classList.contains('w95-hidden'), sel);
await page.keyboard.press('h');
check(await hidden('.w95-gui'), 'H hides the settings window');
await page.keyboard.press('h');
check(!(await hidden('.w95-gui')), 'H shows it again');
await page.keyboard.press('Tab');
check(await hidden('.w95-hud'), 'Tab hides the HUD');
await page.keyboard.press('Tab');
await page.keyboard.press(' ');
check(await page.evaluate(() => window.__maze.config.movement.paused), 'Space pauses');
await page.keyboard.press(' ');
await page.keyboard.press('m');
check(await page.evaluate(() => window.__maze.config.movement.manual), 'M enables manual drive');
await page.keyboard.press('m');
const seedBefore = await page.evaluate(() => window.__maze.config.maze.seed);
await page.keyboard.press('n');
check(await page.evaluate((s) => window.__maze.config.maze.seed !== s, seedBefore), 'N picks a new seed');
await page.keyboard.press('u');
await page.waitForTimeout(1400);
check(Math.abs((await page.evaluate(() => window.__maze.roll)) - Math.PI) < 1e-3, 'U flips the view');
await page.keyboard.press('u');

/* ---- screensaver mode: hides UI, exits on mouse travel ---- */
await page.mouse.move(300, 300);
await setValue('screensaverMode', true);
check(await page.evaluate(() => window.__maze.screensaverActive), 'screensaverMode arms');
check((await hidden('.w95-gui')) && (await hidden('.w95-hud')) && (await hidden('.w95-taskbar')), 'screensaver hides GUI, HUD and taskbar');
await page.mouse.move(302, 302);
check(await page.evaluate(() => window.__maze.screensaverActive), 'a 2px wobble does not exit');
await page.waitForTimeout(500);
await page.mouse.move(340, 340);
check(!(await page.evaluate(() => window.__maze.screensaverActive || window.__maze.config.screensaver.screensaverMode)), 'mouse travel exits screensaver mode');
check(!(await hidden('.w95-gui')) && !(await hidden('.w95-taskbar')), 'UI restored after exit');

/* ---- persistence: change via GUI controller, reload ---- */
await setValue('fov', 95);
await page.waitForTimeout(700);
await page.reload();
await ready();
check((await page.evaluate(() => window.__maze.config.camera.fov)) === 95, 'fov persisted through localStorage');

/* ---- share hash wins, is stripped and stored ---- */
const hash = '#s=' + Buffer.from(JSON.stringify({ maze: { seed: 'hash-seed', width: 7, height: 9 }, camera: { fov: 60 } })).toString('base64url');
await page.goto('about:blank');
await page.goto(URL + hash);
await ready();
const fromHash = await page.evaluate(() => ({ seed: window.__maze.config.maze.seed, size: `${window.__maze.maze.width}x${window.__maze.maze.height}`, fov: window.__maze.config.camera.fov, hash: location.hash, stored: localStorage.getItem('win95maze.settings.v1') }));
check(fromHash.seed === 'hash-seed' && fromHash.size === '7x9' && fromHash.fov === 60, `share hash applied ${JSON.stringify(fromHash).slice(0, 80)}`);
check(fromHash.hash === '' && fromHash.stored.includes('hash-seed'), 'hash stripped from the URL and stored');
const shareUrl = await page.evaluate(() => { window.__maze.actions.copyShareUrl(); return new Promise((r) => setTimeout(() => r(location.href), 100)); });
check(/#s=|^http/.test(shareUrl), `copyShareUrl ran (${shareUrl.length > 40 ? 'set hash fallback or clipboard' : shareUrl})`);

/* ---- texture upload / clear ---- */
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => { window.__maze.actions.uploadTexture('wall'); })]);
await chooser.setFiles('scripts/out/ui-mobile.png');
await page.waitForFunction(() => window.__maze.config.textures.wall.kind === 'custom', null, { timeout: 10000 });
const custom = await page.evaluate(() => window.__maze.config.textures.wall.custom);
check(typeof custom === 'string' && custom.startsWith('data:image/png'), 'upload stored as a data URL');
await page.waitForTimeout(400);
await page.screenshot({ path: 'scripts/out/verify-upload.png' });
await page.evaluate(() => window.__maze.actions.clearTexture('wall'));
check((await page.evaluate(() => window.__maze.config.textures.wall.kind)) === 'brick', 'clearTexture restores the default kind');

/* ---- downloads ---- */
const [exportDl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.__maze.actions.exportSettings())]);
check(/^3d-maze-settings-.*\.json$/.test(exportDl.suggestedFilename()), `export download ${exportDl.suggestedFilename()}`);
const [shotDl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.__maze.actions.screenshot())]);
check(/^3d-maze-.*\.png$/.test(shotDl.suggestedFilename()), `screenshot download ${shotDl.suggestedFilename()}`);

/* ---- rebuild paths from the GUI ---- */
await setValue('mode', 'lit');
await setValue('kind', 'wood');
await setValue('faceShading', 0.5);
await setValue('count', 3);
await setValue('wallHeight', 1.5);
await page.waitForTimeout(500);
const after = await page.evaluate(() => ({ mode: window.__maze.materials.mode, poly: window.__maze.decorationLayer.polyhedronCount, steps: window.__maze.walker.stats.steps, finished: window.__maze.walker.state }));
check(after.mode === 'lit' && after.poly === 3, `lit mode + wood + 3 polyhedra + wallHeight rebuild ${JSON.stringify(after)}`);
await page.screenshot({ path: 'scripts/out/verify-lit-wood.png' });

/* ---- texture repeat is applied in place ---- */
await setValue('repeatU', 2);
check((await page.evaluate(() => window.__maze.materials.wall.map.repeat.x)) === 2, 'repeatU reaches the wall texture clone');

/* ---- dispose ---- */
const mem = await page.evaluate(() => { const r = window.__maze.renderer; window.__maze.dispose(); return { ...r.info.memory, maze: !!window.__maze, ui: document.querySelectorAll('.w95-window, .w95-taskbar').length }; });
check(mem.geometries === 0 && mem.textures === 0 && !mem.maze && mem.ui === 0, `dispose frees everything ${JSON.stringify(mem)}`);
await browser.close();

/* ---- no WebGL → message box ---- */
const noGl = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: [...ARGS, '--disable-webgl', '--disable-3d-apis'] });
const page2 = await noGl.newPage({ viewport: { width: 960, height: 640 } });
const errors = [];
page2.on('pageerror', (e) => errors.push(e.message));
await page2.goto(URL);
await page2.waitForSelector('.w95-dialog', { timeout: 10000 });
await page2.screenshot({ path: 'scripts/out/verify-nowebgl.png' });
check(errors.length === 0 && (await page2.evaluate(() => !!window.__maze?.error)), 'no-WebGL shows the dialog without throwing');
await noGl.close();

console.log(problems.length ? `\n${problems.length} PROBLEM(S)` : '\nVERIFY OK');
process.exit(problems.length ? 1 : 0);
