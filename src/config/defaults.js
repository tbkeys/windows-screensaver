/**
 * Single source of truth for every tweakable parameter.
 *
 * The app shares ONE mutable config object created by `createConfig()`; lil-gui binds
 * directly to its leaves and `app.js` maps dotted paths (e.g. 'textures.wall.kind') to
 * rebuild actions. Keep this file free of three.js imports so tests can load it in Node.
 */

export const CONFIG_VERSION = 1;

/** Option lists for every dropdown. `[id, label]` pairs keep ids stable for saved settings. */
export const ENUMS = {
  mazeAlgorithms: [
    ['backtracker', 'Recursive backtracker (long twisty corridors)'],
    ['prim', "Prim's (short dead ends)"],
    ['kruskal', "Kruskal's (balanced)"],
    ['wilson', "Wilson's (uniform spanning tree)"],
    ['aldousBroder', 'Aldous–Broder (uniform, random walk)'],
    ['huntAndKill', 'Hunt-and-Kill (fewer junctions)'],
    ['growingTree', 'Growing tree (mix slider)'],
    ['binaryTree', 'Binary tree (diagonal bias)'],
    ['sidewinder', 'Sidewinder (horizontal runs)'],
    ['recursiveDivision', 'Recursive division (rooms & halls)'],
    ['ellers', "Eller's (row by row)"],
  ],
  startPlacements: [
    ['deadEnd', 'Dead end on the edge (classic)'],
    ['edge', 'Random edge cell'],
    ['corner', 'Random corner'],
    ['random', 'Anywhere'],
  ],
  finishPlacements: [
    ['farthest', 'Farthest cell from start'],
    ['deadEnd', 'Farthest dead end'],
    ['opposite', 'Opposite edge'],
    ['random', 'Anywhere'],
  ],
  strategies: [
    ['leftHand', 'Left-hand wall follower (classic)'],
    ['rightHand', 'Right-hand wall follower'],
    ['random', 'Random turns (no reversing)'],
    ['explorer', 'Explorer (prefers unvisited)'],
    ['solver', 'Shortest path (BFS)'],
    ['drunk', 'Drunk walk'],
  ],
  easings: [
    ['linear', 'Linear (original)'],
    ['smooth', 'Smoothstep'],
    ['easeInOut', 'Ease in-out (cubic)'],
    ['easeOut', 'Ease out'],
    ['easeIn', 'Ease in'],
    ['snap', 'Snap (instant)'],
  ],
  aspectModes: [
    ['window', 'Fill window'],
    ['4:3', '4:3 (CRT)'],
    ['5:4', '5:4'],
    ['16:9', '16:9'],
    ['16:10', '16:10'],
  ],
  filtering: [
    ['smooth', 'Bilinear (original OpenGL look)'],
    ['trilinear', 'Trilinear + mipmaps'],
    ['pixelated', 'Nearest (pixelated)'],
  ],
  textureResolutions: [64, 128, 256, 512, 1024],
  surfaceTextures: [
    ['brick', 'Red brick (classic)'],
    ['greyBrick', 'Grey brick'],
    ['wood', 'Wood planks'],
    ['stone', 'Stone (classic floor)'],
    ['cobble', 'Cobblestone'],
    ['tile', 'Ceiling tile (classic)'],
    ['checker', 'Checkerboard'],
    ['marble', 'Marble'],
    ['plaster', 'Plaster'],
    ['concrete', 'Concrete'],
    ['hedge', 'Hedge'],
    ['carpet', 'Carpet'],
    ['metal', 'Metal plate'],
    ['win95Teal', 'Windows 95 teal'],
    ['solid', 'Solid colour (tint)'],
    ['custom', 'Custom image…'],
  ],
  posterTextures: [
    ['webglBadge', 'WebGL badge (OpenGL homage)'],
    ['flag', 'Waving flag'],
    ['smileyPoster', 'Smiley'],
    ['start', 'START sign'],
    ['finish', 'FINISH sign'],
    ['custom', 'Custom image…'],
  ],
  lightingModes: [
    ['classic', 'Classic (unlit, fullbright)'],
    ['lit', 'Lit (Lambert)'],
  ],
  fogTypes: [
    ['linear', 'Linear'],
    ['exp2', 'Exponential²'],
  ],
  polyhedronShapes: [
    ['random', 'Random mix'],
    ['tetrahedron', 'Tetrahedron'],
    ['octahedron', 'Octahedron'],
    ['icosahedron', 'Icosahedron'],
    ['dodecahedron', 'Dodecahedron'],
    ['cube', 'Cube'],
  ],
  placements: [
    ['deadEnds', 'Dead ends'],
    ['corridors', 'Corridors'],
    ['anywhere', 'Anywhere'],
  ],
  finishTransitions: [
    ['spin', 'Spin & fade (classic)'],
    ['fade', 'Fade to black'],
    ['zoom', 'Zoom into wall'],
    ['drop', 'Drop through floor'],
    ['swirl', 'Swirl'],
    ['none', 'Instant'],
  ],
  colorDepths: [
    ['full', 'True colour'],
    ['16bit', '16-bit (65k colours)'],
    ['256', '8-bit (256 colours)'],
    ['16', '4-bit (16 colours)'],
    ['mono', 'Monochrome'],
  ],
  presets: [
    ['classic95', 'Classic Windows 95'],
    ['pixelPotato', 'Potato PC (320×240, 8-bit)'],
    ['hedgeGarden', 'Hedge garden'],
    ['dungeon', 'Dungeon (torch-lit)'],
    ['neonNight', 'Neon night'],
    ['smoothModern', 'Smooth & modern'],
  ],
};

export const DEFAULTS = {
  maze: {
    width: 20,
    height: 20,
    algorithm: 'backtracker',
    seed: 'windows95',
    braid: 0, // 0..1 fraction of dead ends opened into loops
    growingTreeMix: 0.5, // 0 = newest (backtracker-like) … 1 = random (Prim-like)
    roomChance: 0.0, // recursive division: chance to leave a chamber un-divided
    startPlacement: 'deadEnd',
    finishPlacement: 'farthest',
    cellSize: 1.0,
    wallHeight: 1.0,
    ceiling: true, // false = open sky (the background colour shows through)
    autoRegenerate: true, // rebuild immediately when a maze setting changes
  },

  movement: {
    strategy: 'leftHand',
    stepDuration: 0.55, // seconds per cell
    turnDuration: 0.45, // seconds per 90°
    stepEasing: 'linear',
    turnEasing: 'linear',
    pauseBeforeTurn: 0.0,
    pauseAfterTurn: 0.0,
    pauseAtDeadEnd: 0.15,
    pauseAtStart: 1.0, // seconds spent facing the START sign before the first turn
    quantize: 0, // 0 = off, N = snap eased progress to N sub-steps (chunky original feel)
    headBob: 0.0,
    headBobSpeed: 2.0,
    manual: false, // drive with WASD/arrows
    paused: false,
  },

  camera: {
    fov: 70, // degrees, applied to the longer screen axis (vertical in landscape)
    height: 0.5, // eye height as a fraction of wallHeight (0.5 = the classic look)
    pitch: 0, // degrees
    near: 0.05,
    far: 100,
    aspectMode: 'window',
    renderScale: 1.0, // internal resolution multiplier (0.1..2)
  },

  timing: {
    fpsCap: 30, // render frames per second, 0 = uncapped
    tickRate: 30, // simulation ticks per second
    interpolate: true, // interpolate camera between ticks when fps > tick rate
    timeScale: 1.0,
    fixedTimestep: false, // advance exactly 1/tickRate per frame regardless of real time
    showFps: true,
  },

  textures: {
    wall: { kind: 'brick', repeatU: 1, repeatV: 1, tint: '#ffffff', brightness: 1.0, offsetU: 0, offsetV: 0, custom: null },
    floor: { kind: 'stone', repeatU: 1, repeatV: 1, tint: '#ffffff', brightness: 1.0, offsetU: 0, offsetV: 0, custom: null },
    ceiling: { kind: 'tile', repeatU: 1, repeatV: 1, tint: '#ffffff', brightness: 1.0, offsetU: 0, offsetV: 0, custom: null },
    poster: { kind: 'webglBadge', repeatU: 1, repeatV: 1, tint: '#ffffff', brightness: 1.0, offsetU: 0, offsetV: 0, custom: null },
    filtering: 'smooth',
    anisotropy: 1,
    resolution: 256,
    textureSeed: 0, // perturbs procedural noise (0 = derived from maze seed)
  },

  lighting: {
    mode: 'classic',
    ambientColor: '#ffffff',
    ambientIntensity: 1.0,
    hemisphereEnabled: false,
    hemisphereSky: '#bfd4ff',
    hemisphereGround: '#3a2a1a',
    hemisphereIntensity: 0.6,
    sunEnabled: false,
    sunColor: '#ffffff',
    sunIntensity: 0.8,
    sunElevation: 60, // degrees
    sunAzimuth: 30, // degrees
    headlampEnabled: false,
    headlampColor: '#ffe9c4',
    headlampIntensity: 2.0,
    headlampDistance: 7,
    headlampDecay: 1.5,
    faceShading: 0.0, // 0..1 fake light from the north: N faces full, S faces −½, E/W faces −1 × this
    floorShade: 1.0,
    ceilingShade: 1.0,
    fogEnabled: false,
    fogType: 'linear',
    fogColor: '#000000',
    fogNear: 3,
    fogFar: 14,
    fogDensity: 0.07,
    backgroundColor: '#000000',
  },

  objects: {
    polyhedra: {
      enabled: true,
      count: 6,
      shape: 'random',
      size: 0.32,
      color: '#9c9c9c',
      spinSpeed: 1.0,
      bob: 0.04,
      flatShading: true,
      wireframe: false,
      placement: 'anywhere',
      teleportOnTouch: true, // classic: touching one drops you somewhere random
      flashOnTeleport: true,
    },
    smiley: {
      enabled: true,
      count: 2,
      size: 0.42,
      spinSpeed: 0.8,
      bob: 0.03,
      flipOnTouch: true, // classic: passing through flips the view upside-down
      flipDuration: 1.2,
      placement: 'corridors',
    },
    rat: {
      enabled: true,
      count: 1,
      speed: 3.0, // cells per second
      color: '#8a8a8a',
      size: 1.0,
      strategy: 'random',
    },
    posters: {
      startFinish: true,
      randomCount: 4,
      size: 0.6, // fraction of wall width
      elevation: 0.5, // centre height as fraction of wall height
    },
    finish: {
      transition: 'spin',
      duration: 2.2,
      newSeedOnFinish: true,
      pauseBefore: 0.4,
    },
  },

  effects: {
    colorDepth: 'full',
    dither: false,
    ditherStrength: 1.0,
    scanlines: 0.0, // 0..1
    scanlineDensity: 1.0, // lines per output pixel (1 = every other line)
    vignette: 0.0,
    curvature: 0.0, // CRT barrel distortion 0..1
    pixelate: 1, // output pixel block size (1 = off)
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    gamma: 1.0,
    noise: 0.0,
  },

  screensaver: {
    showGui: true,
    showHud: true,
    showTaskbar: true,
    hideCursorAfter: 3, // seconds of mouse inactivity (0 = never)
    screensaverMode: false, // hide all UI; any input exits the mode
    idleStart: 0, // seconds of inactivity before entering screensaver mode (0 = off)
    exitFullscreenOnInput: false,
    persistSettings: true,
  },
};

/**
 * Numeric limits `[min, max, step]` per path. The GUI builds its sliders from this table and
 * `sanitizeConfig` clamps values that arrive from storage, share URLs or imports to it, so
 * a hand-edited link cannot produce a NaN projection, a 0-sized cell or a million rats.
 */
export const RANGES = {
  'maze.width': [2, 80, 1],
  'maze.height': [2, 80, 1],
  'maze.braid': [0, 1, 0.01],
  'maze.growingTreeMix': [0, 1, 0.01],
  'maze.roomChance': [0, 1, 0.01],
  'maze.cellSize': [0.25, 4, 0.05],
  'maze.wallHeight': [0.25, 4, 0.05],

  'movement.stepDuration': [0.05, 3, 0.01],
  'movement.turnDuration': [0.05, 3, 0.01],
  'movement.pauseBeforeTurn': [0, 3, 0.05],
  'movement.pauseAfterTurn': [0, 3, 0.05],
  'movement.pauseAtDeadEnd': [0, 3, 0.05],
  'movement.pauseAtStart': [0, 5, 0.05],
  'movement.quantize': [0, 32, 1],
  'movement.headBob': [0, 0.2, 0.005],
  'movement.headBobSpeed': [0, 10, 0.1],

  'camera.fov': [30, 140, 1],
  'camera.height': [0.05, 0.95, 0.01],
  'camera.pitch': [-45, 45, 1],
  'camera.near': [0.01, 1, 0.01],
  'camera.far': [10, 500, 1],
  'camera.renderScale': [0.1, 2, 0.05],

  'timing.fpsCap': [0, 240, 1],
  'timing.tickRate': [5, 240, 1],
  'timing.timeScale': [0, 4, 0.05],

  'textures.anisotropy': [1, 16, 1],
  'textures.textureSeed': [0, 1e9, 1],

  'lighting.ambientIntensity': [0, 3, 0.01],
  'lighting.hemisphereIntensity': [0, 3, 0.01],
  'lighting.sunIntensity': [0, 3, 0.01],
  'lighting.sunElevation': [0, 90, 1],
  'lighting.sunAzimuth': [0, 360, 1],
  'lighting.headlampIntensity': [0, 10, 0.1],
  'lighting.headlampDistance': [0, 30, 0.1],
  'lighting.headlampDecay': [0, 4, 0.05],
  'lighting.faceShading': [0, 1, 0.01],
  'lighting.floorShade': [0, 1, 0.01],
  'lighting.ceilingShade': [0, 1, 0.01],
  'lighting.fogNear': [0, 50, 0.1],
  'lighting.fogFar': [0.5, 100, 0.5],
  'lighting.fogDensity': [0, 0.5, 0.005],

  'objects.polyhedra.count': [0, 40, 1],
  'objects.polyhedra.size': [0.05, 0.9, 0.01],
  'objects.polyhedra.spinSpeed': [0, 5, 0.05],
  'objects.polyhedra.bob': [0, 0.3, 0.005],
  'objects.smiley.count': [0, 40, 1],
  'objects.smiley.size': [0.05, 0.9, 0.01],
  'objects.smiley.spinSpeed': [0, 5, 0.05],
  'objects.smiley.bob': [0, 0.3, 0.005],
  'objects.smiley.flipDuration': [0.1, 5, 0.05],
  'objects.rat.count': [0, 40, 1],
  'objects.rat.speed': [0.1, 10, 0.1],
  'objects.rat.size': [0.1, 3, 0.05],
  'objects.posters.randomCount': [0, 40, 1],
  'objects.posters.size': [0.05, 0.9, 0.01],
  'objects.posters.elevation': [0.05, 0.95, 0.01],
  'objects.finish.duration': [0, 6, 0.05],
  'objects.finish.pauseBefore': [0, 3, 0.05],

  'effects.ditherStrength': [0, 2, 0.01],
  'effects.scanlines': [0, 1, 0.01],
  'effects.scanlineDensity': [0.25, 4, 0.05],
  'effects.vignette': [0, 1, 0.01],
  'effects.curvature': [0, 1, 0.01],
  'effects.pixelate': [1, 16, 1],
  'effects.brightness': [0, 2, 0.01],
  'effects.contrast': [0, 2, 0.01],
  'effects.saturation': [0, 2, 0.01],
  'effects.gamma': [0.5, 2.5, 0.01],
  'effects.noise': [0, 1, 0.01],

  'screensaver.hideCursorAfter': [0, 60, 0.5],
  'screensaver.idleStart': [0, 600, 5],
};

/** Paths whose value must be an id from the named ENUMS list (dropdowns + validation). */
export const ENUM_FIELDS = {
  'maze.algorithm': 'mazeAlgorithms',
  'maze.startPlacement': 'startPlacements',
  'maze.finishPlacement': 'finishPlacements',
  'movement.strategy': 'strategies',
  'movement.stepEasing': 'easings',
  'movement.turnEasing': 'easings',
  'camera.aspectMode': 'aspectModes',
  'textures.wall.kind': 'surfaceTextures',
  'textures.floor.kind': 'surfaceTextures',
  'textures.ceiling.kind': 'surfaceTextures',
  'textures.poster.kind': 'posterTextures',
  'textures.filtering': 'filtering',
  'textures.resolution': 'textureResolutions',
  'lighting.mode': 'lightingModes',
  'lighting.fogType': 'fogTypes',
  'objects.polyhedra.shape': 'polyhedronShapes',
  'objects.polyhedra.placement': 'placements',
  'objects.smiley.placement': 'placements',
  'objects.rat.strategy': 'strategies',
  'objects.finish.transition': 'finishTransitions',
  'effects.colorDepth': 'colorDepths',
};

/** Ids of an ENUMS list (entries are `[id, label]` pairs or plain values). */
export const enumIds = (enumName) => ENUMS[enumName].map((e) => (Array.isArray(e) ? e[0] : e));

/* ---------- helpers ---------- */

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function deepClone(obj) {
  if (Array.isArray(obj)) return obj.map(deepClone);
  if (isPlainObject(obj)) {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = deepClone(obj[k]);
    return out;
  }
  return obj;
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
/** Keys that must never be merged from untrusted JSON (prototype pollution). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively copy `partial` onto `target` (mutating). Keys that `target` does not own are
 * ignored, a sub-tree is never replaced by a scalar (or vice versa), and prototype keys are
 * skipped, so JSON from storage, a share URL or an import cannot corrupt the config shape.
 */
export function deepMerge(target, partial) {
  if (!isPlainObject(partial)) return target;
  for (const k of Object.keys(partial)) {
    if (UNSAFE_KEYS.has(k) || !hasOwn(target, k)) continue;
    const t = target[k];
    const p = partial[k];
    if (isPlainObject(t)) {
      if (isPlainObject(p)) deepMerge(t, p);
    } else if (p !== undefined && !isPlainObject(p)) {
      target[k] = Array.isArray(p) ? p.slice() : p;
    }
  }
  return target;
}

/** Produce an object containing only the leaves of `config` that differ from `DEFAULTS`. */
export function diffFromDefaults(config, defaults = DEFAULTS) {
  const out = {};
  for (const k of Object.keys(defaults)) {
    const d = defaults[k];
    const c = config[k];
    if (isPlainObject(d)) {
      const sub = diffFromDefaults(c ?? {}, d);
      if (Object.keys(sub).length) out[k] = sub;
    } else if (JSON.stringify(c) !== JSON.stringify(d)) {
      out[k] = c;
    }
  }
  return out;
}

export function createConfig(overrides) {
  const cfg = deepClone(DEFAULTS);
  if (overrides) deepMerge(cfg, overrides);
  return cfg;
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

/** Walk every leaf: fn(path, value, parentObject, key). */
export function forEachLeaf(obj, fn, prefix = '') {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v)) forEachLeaf(v, fn, path);
    else fn(path, v, obj, k);
  }
}
