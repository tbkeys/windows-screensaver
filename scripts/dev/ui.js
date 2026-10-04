/**
 * Dev page for src/ui/{gui,hud}.js + win95.css.
 *
 * Mounts the settings window with a fresh config, console-logging onChange and mostly
 * no-op actions (a few mutate the config so refresh() can be seen working), plus the HUD
 * with fake, slowly changing stats. Verifies that every DEFAULTS leaf (minus the four
 * `custom` status lines) has exactly one controller and exposes the result on
 * `window.__uiDev` for the Playwright shoot script.
 */
import { createConfig, deepMerge, DEFAULTS, forEachLeaf } from '../../src/config/defaults.js';
import { PRESETS } from '../../src/config/presets.js';
import { randomSeedString } from '../../src/maze/rng.js';
import { createGui, enumOptions } from '../../src/ui/gui.js';
import { createHud } from '../../src/ui/hud.js';

const log = (...args) => console.log('[ui]', ...args);
const config = createConfig();

const ACTION_NAMES = [
  'regenerate', 'randomizeSeed', 'uploadTexture', 'clearTexture', 'applyPreset', 'exportSettings',
  'importSettings', 'copyShareUrl', 'resetDefaults', 'fullscreen', 'screenshot', 'togglePause',
  'teleportRandom', 'flipView',
];
const actions = Object.fromEntries(ACTION_NAMES.map((name) => [name, (...args) => log('action', name, ...args)]));
Object.assign(actions, {
  randomizeSeed() { config.maze.seed = randomSeedString(); log('action randomizeSeed →', config.maze.seed); },
  togglePause() { config.movement.paused = !config.movement.paused; log('action togglePause →', config.movement.paused); },
  applyPreset(id) { deepMerge(config, PRESETS[id]); log('action applyPreset', id); },
  uploadTexture(slot) { config.textures[slot].custom = 'data:image/png;base64,fake'; log('action uploadTexture', slot); },
  clearTexture(slot) { config.textures[slot].custom = null; log('action clearTexture', slot); },
  teleportRandom() { hud.flash('#ffffff', 400); hud.showToast('Teleported!', 1500); },
  flipView() { hud.flash('#000080', 600); },
});

const hud = createHud(document.body, {
  onStart: () => { gui.toggle(); log('start clicked'); },
  onVisibilityChange: (visible) => log('hud visibility (user)', visible),
});
const gui = createGui(config, {
  onChange: (path, value, finished) => log('change', path, JSON.stringify(value), finished ? 'FINISHED' : 'live'),
  actions,
  container: document.body,
});

/* --- fake stats --- */
let steps = 0;
const stats = () => ({
  fps: 29.4 + Math.random() * 1.2,
  seed: config.maze.seed,
  algorithm: config.maze.algorithm,
  size: `${config.maze.width} × ${config.maze.height}`,
  steps,
  state: config.movement.paused ? 'paused' : 'stepping',
  strategy: config.movement.strategy,
});
hud.setStats(stats());
setInterval(() => { steps++; hud.setStats(stats()); }, 500);

/* --- coverage check: one controller per DEFAULTS leaf (custom → status line) --- */
const prefixes = new Map(); // config sub-object → dotted prefix
(function index(obj, prefix) {
  prefixes.set(obj, prefix);
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) index(v, prefix ? `${prefix}.${k}` : k);
  }
})(config, '');

const leafPaths = [];
forEachLeaf(DEFAULTS, (path) => leafPaths.push(path));
const customPaths = leafPaths.filter((p) => p.endsWith('.custom'));
const controllerPaths = gui.gui.controllersRecursive()
  .filter((c) => prefixes.has(c.object))
  .map((c) => `${prefixes.get(c.object)}.${c.property}`);
const missing = leafPaths.filter((p) => !customPaths.includes(p) && !controllerPaths.includes(p));
const duplicates = controllerPaths.filter((p, i) => controllerPaths.indexOf(p) !== i);
const statusLines = document.querySelectorAll('.w95-status-line').length;
const totalControllers = gui.gui.controllersRecursive().length;

const report = {
  leaves: leafPaths.length,
  customLeaves: customPaths.length,
  leafControllers: controllerPaths.length,
  statusLines,
  totalControllers,
  missing,
  duplicates,
  enumOptionsSample: enumOptions([['a', 'Label A'], 7]),
  ok: missing.length === 0 && duplicates.length === 0
    && controllerPaths.length === leafPaths.length - customPaths.length && statusLines === customPaths.length,
};
log(`DEFAULTS leaves=${report.leaves} custom=${report.customLeaves} leafControllers=${report.leafControllers} `
  + `statusLines=${report.statusLines} totalControllers=${report.totalControllers} ok=${report.ok}`);
if (missing.length) log('MISSING', missing);
if (duplicates.length) log('DUPLICATE', duplicates);

hud.showToast(`UI dev page ready — ${report.leafControllers} config controllers`, 4000);
window.__uiDev = { config, gui, hud, report };
