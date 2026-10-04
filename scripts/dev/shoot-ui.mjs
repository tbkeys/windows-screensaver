// Headless screenshots + interaction checks for scripts/dev/ui.html → scripts/out/ui*.png
// usage: node scripts/dev/shoot-ui.mjs [port]
import { chromium } from 'playwright';

const port = process.argv[2] || '5191';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  ignoreDefaultArgs: ['--hide-scrollbars'], // we want to see the Win95 scrollbar skin
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const problems = [];
const changes = [];
page.on('console', (m) => {
  const line = `[console.${m.type()}] ${m.text()}`;
  if (/\[ui\] change /.test(line)) changes.push(line);
  console.log(line);
  if (m.type() === 'error' || m.type() === 'warning') problems.push(line);
});
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); problems.push(e.message); });

await page.goto(`http://localhost:${port}/scripts/dev/ui.html`);
await page.waitForFunction(() => window.__uiDev?.report, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const report = await page.evaluate(() => window.__uiDev.report);
console.log('coverage report:', JSON.stringify(report));
if (!report.ok) problems.push('coverage check failed');
await page.screenshot({ path: 'scripts/out/ui.png' });
await page.locator('.w95-gui').screenshot({ path: 'scripts/out/ui-panel.png', scale: 'css' });

const check = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); if (!cond) problems.push(label); };

// 1. Randomize seed button → config + displayed value update through refresh().
const seedBefore = await page.evaluate(() => window.__uiDev.config.maze.seed);
await page.getByRole('button', { name: 'Randomize seed' }).click();
const seedState = await page.evaluate(() => {
  const c = window.__uiDev.gui.gui.controllersRecursive().find((x) => x.property === 'seed');
  return { seed: window.__uiDev.config.maze.seed, shown: c.$input.value };
});
check('randomize seed changes config and display', seedState.seed !== seedBefore && seedState.shown === seedState.seed);

// 2. Checkbox → exactly one onChange call, with finished=true.
changes.length = 0;
const box = page.locator('.lil-gui .lil-controller.lil-boolean', { hasText: 'Auto regenerate' }).locator('input');
await box.click();
await page.waitForTimeout(100);
check('checkbox emits one FINISHED change', changes.length === 1 && /maze.autoRegenerate false FINISHED/.test(changes[0]));

// 3. Slider drag → live changes followed by one FINISHED.
changes.length = 0;
const slider = page.locator('.lil-gui .lil-controller.lil-number', { hasText: 'Width' }).locator('.lil-slider');
const sb = await slider.boundingBox();
await page.mouse.move(sb.x + sb.width * 0.3, sb.y + sb.height / 2);
await page.mouse.down();
await page.mouse.move(sb.x + sb.width * 0.6, sb.y + sb.height / 2, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(100);
const live = changes.filter((l) => / live$/.test(l)).length;
const finished = changes.filter((l) => /FINISHED$/.test(l)).length;
check(`slider drag emits live (${live}) then one FINISHED (${finished})`, live >= 1 && finished === 1 && /FINISHED$/.test(changes.at(-1)));

// 4. Dropdown change through the hidden <select>.
changes.length = 0;
await page.locator('.lil-gui .lil-controller.lil-option', { hasText: 'Algorithm' }).locator('select').selectOption({ index: 2 });
await page.waitForTimeout(100);
check('dropdown emits one FINISHED change with the enum id', changes.length === 1 && /maze.algorithm "kruskal" FINISHED/.test(changes[0]));

// 5. Drag the settings window by its title bar; position persists in localStorage.
const title = page.locator('.w95-gui .w95-titlebar');
const tb = await title.boundingBox();
await page.mouse.move(tb.x + 60, tb.y + 8);
await page.mouse.down();
await page.mouse.move(tb.x - 240, tb.y + 120, { steps: 8 });
await page.mouse.up();
const pos = await page.evaluate(() => ({ left: document.querySelector('.w95-gui').style.left, saved: localStorage.getItem('win95maze.guiPos') }));
check(`window dragged (left=${pos.left}) and saved (${pos.saved})`, pos.left !== '' && /"x":\d+/.test(pos.saved));

// 6. Close button hides and syncs screensaver.showGui; Start re-opens via gui.toggle().
await page.locator('.w95-gui .w95-titlebtn-close').click();
const closed = await page.evaluate(() => ({ hidden: document.querySelector('.w95-gui').classList.contains('w95-hidden'), showGui: window.__uiDev.config.screensaver.showGui }));
check('close button hides window and sets showGui=false', closed.hidden && closed.showGui === false);
await page.locator('.w95-start').click();
check('Start button re-opens the window', await page.evaluate(() => !document.querySelector('.w95-gui').classList.contains('w95-hidden')));

// 7. Upload/clear status line, flash + toast, taskbar/HUD visibility.
await page.evaluate(() => window.__uiDev.gui.gui.foldersRecursive().forEach((f) => f.open(f._title === 'Textures' || f._title === 'Wall' || f._title === 'Lighting' || f._title === 'Headlamp')));
await page.evaluate(() => window.__uiDev.gui.gui.foldersRecursive().forEach((f) => { if (['Presets & Tools', 'Maze', 'Movement'].includes(f._title)) f.close(); }));
await page.getByRole('button', { name: 'Upload image…' }).first().click();
const loaded = await page.evaluate(() => document.querySelector('.w95-status-line').textContent);
check(`status line shows loaded ("${loaded}")`, /loaded/.test(loaded));
await page.evaluate(() => { window.__uiDev.hud.flash('#ffffff', 2000); window.__uiDev.hud.showToast('Hello from the toast', 5000); });
await page.waitForTimeout(250);
await page.screenshot({ path: 'scripts/out/ui-folders.png' });
// Lighting (grouped sub-folders + fog divider) and Help, scrolled to the bottom of the panel.
await page.evaluate(() => {
  const open = ['Lighting', 'Headlamp', 'Sun', 'Help'];
  window.__uiDev.gui.gui.foldersRecursive().forEach((f) => f.open(open.includes(f._title)));
  const scroller = document.querySelector('.w95-gui .lil-root > .lil-children');
  scroller.scrollTop = scroller.scrollHeight;
});
await page.waitForTimeout(200);
await page.screenshot({ path: 'scripts/out/ui-lighting.png' });
await page.evaluate(() => { window.__uiDev.hud.setTaskbarVisible(false); window.__uiDev.hud.setVisible(false); });
const hiddenUi = await page.evaluate(() => ({ tb: getComputedStyle(document.querySelector('.w95-taskbar')).display, hud: getComputedStyle(document.querySelector('.w95-hud')).display }));
check('setTaskbarVisible(false)/setVisible(false) hide elements', hiddenUi.tb === 'none' && hiddenUi.hud === 'none');
await page.evaluate(() => { window.__uiDev.hud.setTaskbarVisible(true); window.__uiDev.hud.setVisible(true); });

// 8. Narrow viewport (phone) layout.
await page.setViewportSize({ width: 400, height: 720 });
await page.waitForTimeout(300);
await page.screenshot({ path: 'scripts/out/ui-mobile.png' });

// 9. destroy() leaves no UI DOM behind.
const leftovers = await page.evaluate(() => {
  window.__uiDev.gui.destroy(); window.__uiDev.hud.destroy();
  return document.querySelectorAll('.w95-window, .w95-taskbar, .w95-toast, #fade-overlay, .lil-gui').length;
});
check(`destroy() removes all UI nodes (${leftovers} left)`, leftovers === 0);

await browser.close();
console.log(problems.length ? `PROBLEMS: ${problems.length}\n${problems.join('\n')}` : 'OK: no console errors/warnings, all checks passed');
process.exit(problems.length ? 1 : 0);
