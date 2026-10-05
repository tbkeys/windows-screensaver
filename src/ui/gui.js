/**
 * Settings panel: lil-gui wrapped in a draggable Win95 window ("3D Maze Setup").
 *
 * Folders mirror the config tree and are built by walking DEFAULTS, so every leaf is
 * exposed by construction; `SPECS` only adds ranges / dropdowns / colour pickers and
 * `LABELS` prettier names. Every controller reports `onChange(path, value, finished)`:
 * `finished` is false while a slider / colour / text field is still being edited and
 * true exactly once per committed change (checkboxes and dropdowns only send `true`).
 */
import GUI, { ColorController, NumberController } from 'lil-gui';
import { DEFAULTS, ENUMS, ENUM_FIELDS, RANGES, isPlainObject } from '../config/defaults.js';
import { createWin95Window, makeDraggable } from './hud.js';

const STORAGE_KEY = 'win95maze.guiPos';
const PANEL_WIDTH = 340;
const TEXTURE_SLOTS = ['wall', 'floor', 'ceiling', 'poster'];

const SHORTCUTS = [
  ['H', 'Toggle this settings window'],
  ['Tab', 'Toggle the status window'],
  ['F', 'Fullscreen'],
  ['Space', 'Pause / resume'],
  ['R', 'Regenerate maze'],
  ['N', 'New random seed'],
  ['M', 'Manual drive on/off'],
  ['WASD / arrows', 'Drive (manual mode)'],
  ['T', 'Random teleport'],
  ['U', 'Flip view'],
  ['P', 'Screenshot'],
  ['Esc', 'Exit screensaver mode'],
];

/** Convert ENUMS `[id, label]` pairs (or a plain value list) into lil-gui's `{label: id}` shape. */
export function enumOptions(list) {
  const out = {};
  for (const item of list) {
    if (Array.isArray(item)) out[item[1]] = item[0];
    else out[String(item)] = item;
  }
  return out;
}

/* ---------- control specs ---------- */

const range = (min, max, step) => ({ min, max, step });
const pick = (enumName) => ({ options: enumOptions(ENUMS[enumName]) });
const COLOR = { color: true };

const SLOT_COLORS = Object.fromEntries(TEXTURE_SLOTS.map((slot) => [`textures.${slot}.tint`, COLOR]));
const slotRanges = (slot) => ({
  [`textures.${slot}.repeatU`]: range(0.1, 8, 0.05),
  [`textures.${slot}.repeatV`]: range(0.1, 8, 0.05),
  [`textures.${slot}.offsetU`]: range(-1, 1, 0.01),
  [`textures.${slot}.offsetV`]: range(-1, 1, 0.01),
  [`textures.${slot}.brightness`]: range(0, 3, 0.01),
});

/**
 * Per-path widget hints. Sliders come from `RANGES` and dropdowns from `ENUM_FIELDS` (both in
 * defaults.js, shared with the settings sanitiser); only colour pickers and a few bespoke
 * widgets are listed here. Leaves without an entry fall back to lil-gui's type detection.
 */
const SPECS = {
  ...Object.fromEntries(Object.entries(RANGES).map(([path, [min, max, step]]) => [path, range(min, max, step)])),
  ...Object.fromEntries(Object.entries(ENUM_FIELDS).map(([path, enumName]) => [path, pick(enumName)])),
  ...slotRanges('wall'),
  ...slotRanges('floor'),
  ...slotRanges('ceiling'),
  ...slotRanges('poster'),
  ...SLOT_COLORS,
  'textures.resolution': { options: enumOptions(ENUMS.textureResolutions.map((n) => [n, `${n} × ${n}`])) },
  'textures.textureSeed': { min: 0, step: 1 },
  'lighting.ambientColor': COLOR,
  'lighting.hemisphereSky': COLOR,
  'lighting.hemisphereGround': COLOR,
  'lighting.sunColor': COLOR,
  'lighting.headlampColor': COLOR,
  'lighting.fogColor': COLOR,
  'lighting.backgroundColor': COLOR,
  'objects.polyhedra.color': COLOR,
  'objects.rat.color': COLOR,
};

/** Label overrides (full path); everything else is `humanize(key)`. */
const LABELS = {
  'movement.stepDuration': 'Step duration (s)',
  'movement.turnDuration': 'Turn duration (s)',
  'movement.pauseBeforeTurn': 'Pause before turn (s)',
  'movement.pauseAfterTurn': 'Pause after turn (s)',
  'movement.pauseAtDeadEnd': 'Pause at dead end (s)',
  'movement.pauseAtStart': 'Pause at start (s)',
  'maze.ceiling': 'Draw ceiling',
  'textures.anisotropy': 'Anisotropy (mipmapped)',
  'movement.quantize': 'Quantize (0 = off)',
  'movement.manual': 'Manual drive (WASD)',
  'camera.fov': 'FOV (°)',
  'camera.height': 'Eye height (of wall)',
  'camera.pitch': 'Pitch (°)',
  'camera.near': 'Near plane',
  'camera.far': 'Far plane',
  'timing.fpsCap': 'FPS cap (0 = vsync)',
  'timing.tickRate': 'Tick rate (Hz)',
  'timing.showFps': 'Show FPS',
  'textures.textureSeed': 'Texture seed (0 = maze)',
  'lighting.hemisphereSky': 'Sky colour',
  'lighting.hemisphereGround': 'Ground colour',
  'lighting.sunElevation': 'Elevation (°)',
  'lighting.sunAzimuth': 'Azimuth (°)',
  'objects.polyhedra.teleportOnTouch': 'Teleport on touch',
  'objects.smiley.flipDuration': 'Flip duration (s)',
  'objects.rat.speed': 'Speed (cells/s)',
  'objects.posters.startFinish': 'START / FINISH signs',
  'objects.posters.randomCount': 'Random posters',
  'objects.posters.size': 'Size (of wall)',
  'objects.posters.elevation': 'Elevation (of wall)',
  'objects.finish.duration': 'Duration (s)',
  'objects.finish.pauseBefore': 'Pause before (s)',
  'effects.colorDepth': 'Colour depth',
  'effects.pixelate': 'Pixelate (px)',
  'screensaver.showGui': 'Show settings',
  'screensaver.showHud': 'Show status window',
  'screensaver.hideCursorAfter': 'Hide cursor after (s)',
  'screensaver.idleStart': 'Idle start (s)',
};

/** Flat sections whose prefixed keys become sub-folders (in this order). */
const GROUPS = {
  lighting: [
    ['headlamp', 'Headlamp'],
    ['sun', 'Sun'],
    ['hemisphere', 'Hemisphere'],
  ],
};

/** A labelled divider is inserted before these leaves. */
const DIVIDERS = {
  'lighting.fogEnabled': 'Fog',
  'textures.filtering': 'All surfaces',
};

/** 'fogColor' → 'Fog colour' (British spelling to match the ENUMS labels). */
const humanize = (key) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/\bcolor\b/, 'colour');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const groupFor = (section, key) =>
  (GROUPS[section] ?? []).find(([prefix]) => key.startsWith(prefix) && /[A-Z]/.test(key.charAt(prefix.length)));

const labelFor = (path, key, group) =>
  LABELS[path] ?? humanize(group ? key.slice(group[0].length) : key);

/** Non-controller rows appended to a folder's children list. */
const appendRow = (folder, className, text) => {
  const row = document.createElement('div');
  row.className = className;
  if (text !== undefined) row.textContent = text;
  folder.$children.appendChild(row);
  return row;
};

const addStatusLine = (folder, label) => {
  const row = appendRow(folder, 'lil-controller w95-status-line');
  const name = document.createElement('div');
  name.className = 'lil-name';
  name.textContent = label;
  const widget = document.createElement('div');
  widget.className = 'lil-widget';
  row.append(name, widget);
  return row;
};

const buildHelp = (folder) => {
  const box = appendRow(folder, 'w95-help');
  const intro = document.createElement('p');
  intro.textContent = 'Touch a polyhedron to teleport, walk through a smiley to flip the view. Keyboard:';
  const list = document.createElement('dl');
  for (const [keys, what] of SHORTCUTS) {
    const dt = document.createElement('dt');
    dt.textContent = keys;
    const dd = document.createElement('dd');
    dd.textContent = what;
    list.append(dt, dd);
  }
  box.append(intro, list);
};

/**
 * Create the settings window.
 * @param {object} config  the shared mutable config (from `createConfig()`)
 * @param {{ onChange?: (path: string, value: any, finished: boolean) => void,
 *           actions?: Record<string, Function>, container?: HTMLElement }} opts
 */
export function createGui(config, { onChange = () => {}, actions = {}, container = document.body } = {}) {
  const win = createWin95Window({ title: '3D Maze Setup', className: 'w95-gui', onClose: () => closeFromUser() });
  // On a phone the panel would cover most of the maze: start it rolled up to its title bar.
  if (window.matchMedia?.('(max-width: 600px)').matches) win.setCollapsed(true);
  const host = document.createElement('div');
  host.className = 'w95-gui-body';
  win.body.appendChild(host);

  const gui = new GUI({ container: host, title: '3D Maze Setup', width: PANEL_WIDTH, closeFolders: true, touchStyles: false });
  const statusLines = []; // [{ row, slot }]
  const dynamicLabels = []; // () => void, run on refresh()

  const refresh = () => {
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    for (const { row, slot } of statusLines) {
      const loaded = config.textures[slot].custom != null;
      row.classList.toggle('w95-loaded', loaded);
      row.lastChild.textContent = loaded ? 'loaded' : 'none';
    }
    dynamicLabels.forEach((fn) => fn());
  };

  const run = (name, ...args) => {
    const fn = actions[name];
    if (typeof fn !== 'function') {
      console.warn(`[gui] action "${name}" is not wired`);
      return;
    }
    fn(...args);
    refresh();
  };

  const addButton = (folder, label, action, ...args) =>
    folder.add({ [label]: () => run(action, ...args) }, label);

  const wire = (controller, path) => {
    // Sliders and colour pickers report every drag step; text fields (the seed) only commit.
    const continuous = controller instanceof NumberController || controller instanceof ColorController;
    if (continuous) controller.onChange((v) => onChange(path, v, false));
    controller.onFinishChange((v) => onChange(path, v, true));
    return controller;
  };

  const addLeaf = (folder, obj, key, path, label) => {
    const spec = SPECS[path] ?? {};
    let controller;
    if (spec.color) controller = folder.addColor(obj, key);
    else if (spec.options) controller = folder.add(obj, key, spec.options);
    else controller = folder.add(obj, key, spec.min, spec.max, spec.step);
    return wire(controller.name(label), path);
  };

  /** Extras appended after a given leaf or at the end of a folder (keyed by path). */
  const afterLeaf = {
    'maze.seed': (folder) => addButton(folder, 'Randomize seed', 'randomizeSeed'),
  };
  const atFolderEnd = {
    maze: (folder) => addButton(folder, 'Regenerate', 'regenerate'),
    ...Object.fromEntries(TEXTURE_SLOTS.map((slot) => [`textures.${slot}`, (folder) => {
      addButton(folder, 'Upload image…', 'uploadTexture', slot);
      addButton(folder, 'Clear image', 'clearTexture', slot);
    }])),
  };

  /** Walk `defaults` (schema) and bind controllers to the matching `obj` (live config). */
  const buildSection = (folder, obj, defaults, prefix, section) => {
    const groupFolders = new Map();
    for (const key of Object.keys(defaults)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (DIVIDERS[path]) appendRow(folder, 'w95-divider', DIVIDERS[path]);

      if (isPlainObject(defaults[key])) {
        const sub = folder.addFolder(humanize(key));
        buildSection(sub, obj[key], defaults[key], path, section);
        continue;
      }
      if (key === 'custom') {
        statusLines.push({ row: addStatusLine(folder, 'custom'), slot: prefix.split('.').pop() });
        continue;
      }

      const group = groupFor(section, key);
      if (group && groupFolders.size === 0) {
        for (const [prefixId, title] of GROUPS[section]) groupFolders.set(prefixId, folder.addFolder(title));
      }
      const target = group ? groupFolders.get(group[0]) : folder;
      addLeaf(target, obj, key, path, labelFor(path, key, group));
      afterLeaf[path]?.(target);
    }
    atFolderEnd[prefix]?.(folder);
  };

  /* --- Presets & Tools --- */
  const toolsFolder = gui.addFolder('Presets & Tools');
  const tools = { preset: ENUMS.presets[0][0] };
  toolsFolder.add(tools, 'preset', enumOptions(ENUMS.presets)).name('Preset').onChange((id) => run('applyPreset', id));
  addButton(toolsFolder, 'Fullscreen', 'fullscreen');
  addButton(toolsFolder, 'Screenshot', 'screenshot');
  const pauseButton = addButton(toolsFolder, 'Pause', 'togglePause');
  dynamicLabels.push(() => pauseButton.name(config.movement.paused ? 'Resume' : 'Pause'));
  addButton(toolsFolder, 'Teleport', 'teleportRandom');
  addButton(toolsFolder, 'Flip view', 'flipView');
  addButton(toolsFolder, 'Export settings', 'exportSettings');
  addButton(toolsFolder, 'Import settings', 'importSettings');
  addButton(toolsFolder, 'Copy share URL', 'copyShareUrl');
  addButton(toolsFolder, 'Reset to defaults', 'resetDefaults');

  /* --- config sections --- */
  const sectionFolders = {};
  for (const section of Object.keys(DEFAULTS)) {
    const folder = gui.addFolder(humanize(section));
    sectionFolders[section] = folder;
    buildSection(folder, config[section], DEFAULTS[section], section, section);
  }

  /* --- Help --- */
  buildHelp(gui.addFolder('Help'));

  toolsFolder.open();
  sectionFolders.maze.open();
  sectionFolders.movement.open();

  /* --- window chrome --- */
  const statusbar = document.createElement('div');
  statusbar.className = 'w95-statusbar';
  const hint = document.createElement('span');
  hint.textContent = 'Drag the title bar to move · H hides this window';
  statusbar.appendChild(hint);
  win.body.appendChild(statusbar);
  container.appendChild(win.root);
  const dragger = makeDraggable(win.root, win.titlebar, { storageKey: STORAGE_KEY });

  const setVisible = (visible) => win.setVisible(visible);
  /** Title-bar close: hide and keep `screensaver.showGui` in sync through onChange. */
  const closeFromUser = () => {
    setVisible(false);
    config.screensaver.showGui = false;
    refresh();
    onChange('screensaver.showGui', false, true);
  };

  refresh();

  return {
    gui,
    refresh,
    show: () => setVisible(true),
    hide: () => setVisible(false),
    toggle: () => setVisible(!win.isVisible()),
    setVisible,
    destroy() {
      dragger.destroy();
      gui.destroy();
      win.destroy();
    },
  };
}
