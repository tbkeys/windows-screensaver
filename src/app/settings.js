/**
 * Settings plumbing for app.js: the localStorage diff, the `#s=<base64url JSON>` share
 * hash, JSON export/import, validation of settings that arrive from outside the GUI, and
 * the hidden file picker / download helpers. DOM only – no three.js – and tolerant of
 * blocked storage (private mode, quota) so the app never fails to boot over it.
 */
import { CONFIG_VERSION, DEFAULTS, ENUMS, deepClone, diffFromDefaults, forEachLeaf, getPath, setPath } from '../config/defaults.js';

export const STORAGE_KEY = 'win95maze.settings.v1';
export const HASH_PREFIX = '#s=';
/** Uploaded images above this size are kept in memory only (never written to storage or URLs). */
export const MAX_PERSISTED_IMAGE_BYTES = 700 * 1024;
/** Value of `textures.<slot>.custom` for an upload that is too large to persist. */
export const IN_MEMORY_MARKER = 'memory';
export const TEXTURE_SLOTS = Object.freeze(['wall', 'floor', 'ceiling', 'poster']);

const MAX_MAZE_SIDE = 200;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* ------------------------------------------------------------- base64url */

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded) {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** `#s=…` fragment carrying a settings diff. */
export function encodeShareHash(diff) {
  return HASH_PREFIX + toBase64Url(JSON.stringify(diff));
}

/** Parse a `#s=…` fragment; null when absent or malformed. */
export function decodeShareHash(hash) {
  if (!hash || !hash.startsWith(HASH_PREFIX)) return null;
  try {
    const value = JSON.parse(fromBase64Url(hash.slice(HASH_PREFIX.length)));
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** Diff for a share URL: uploaded images are dropped (data URLs do not belong in a URL). */
export function shareableDiff(config) {
  const diff = diffFromDefaults(config);
  for (const slot of TEXTURE_SLOTS) {
    const section = diff.textures?.[slot];
    if (!section || !('custom' in section)) continue;
    delete section.custom;
    if (!Object.keys(section).length) delete diff.textures[slot];
  }
  if (diff.textures && !Object.keys(diff.textures).length) delete diff.textures;
  return diff;
}

/* --------------------------------------------------------------- storage */

export function loadStoredSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persist the diff from defaults (removes the entry when nothing differs). Returns success. */
export function storeSettings(config) {
  try {
    const diff = diffFromDefaults(config);
    if (Object.keys(diff).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(diff));
    else localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Rewrite the address bar without navigating; silently ignored where the document may not. */
export function replaceUrl(url) {
  try {
    history.replaceState(null, '', url);
  } catch {
    /* sandboxed or opaque-origin document */
  }
}

export function clearStoredSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable – nothing to clear */
  }
}

/* ------------------------------------------------------------ validation */

/** Config paths whose value must be an id from the named ENUMS list. */
const ENUM_PATHS = {
  'maze.algorithm': 'mazeAlgorithms',
  'maze.startPlacement': 'startPlacements',
  'maze.finishPlacement': 'finishPlacements',
  'movement.strategy': 'strategies',
  'movement.stepEasing': 'easings',
  'movement.turnEasing': 'easings',
  'camera.aspectMode': 'aspectModes',
  'textures.filtering': 'filtering',
  'textures.wall.kind': 'surfaceTextures',
  'textures.floor.kind': 'surfaceTextures',
  'textures.ceiling.kind': 'surfaceTextures',
  'textures.poster.kind': 'posterTextures',
  'lighting.mode': 'lightingModes',
  'lighting.fogType': 'fogTypes',
  'objects.polyhedra.shape': 'polyhedronShapes',
  'objects.polyhedra.placement': 'placements',
  'objects.smiley.placement': 'placements',
  'objects.rat.strategy': 'strategies',
  'objects.finish.transition': 'finishTransitions',
  'effects.colorDepth': 'colorDepths',
};

const isDataImageUrl = (v) => typeof v === 'string' && v.startsWith('data:image/');

/**
 * Repair a config that came from storage, a URL or an import, so the generator, navigator
 * and renderer never see a value they would throw on: unknown enum ids, non-numeric
 * numbers, absurd maze sizes and custom-texture references that cannot be restored all
 * fall back to their defaults. Returns the number of leaves repaired.
 */
export function sanitizeConfig(config) {
  let repaired = 0;
  const reset = (path) => {
    setPath(config, path, deepClone(getPath(DEFAULTS, path)));
    repaired++;
  };

  for (const [path, enumName] of Object.entries(ENUM_PATHS)) {
    const value = getPath(config, path);
    if (!ENUMS[enumName].some(([id]) => id === value)) reset(path);
  }
  if (!ENUMS.textureResolutions.includes(config.textures.resolution)) reset('textures.resolution');

  forEachLeaf(DEFAULTS, (path, def) => {
    const value = getPath(config, path);
    if (typeof def === 'number' && !Number.isFinite(value)) reset(path);
    else if (typeof def === 'boolean' && typeof value !== 'boolean') reset(path);
    else if (path === 'maze.seed' && (typeof value !== 'string' || value === '')) reset(path);
  });

  for (const side of ['width', 'height']) {
    const value = Math.round(config.maze[side]);
    if (value >= 1 && value <= MAX_MAZE_SIDE) config.maze[side] = value;
    else reset(`maze.${side}`);
  }

  for (const slot of TEXTURE_SLOTS) {
    const texture = config.textures[slot];
    if (isDataImageUrl(texture.custom)) continue;
    if (texture.custom != null) {
      texture.custom = null;
      repaired++;
    }
    if (texture.kind === 'custom') reset(`textures.${slot}.kind`);
  }
  return repaired;
}

/* --------------------------------------------------------- export/import */

export function exportSettingsJson(config) {
  return JSON.stringify({ app: 'win95-3d-maze', version: CONFIG_VERSION, settings: diffFromDefaults(config) }, null, 2);
}

/** Accepts the export format or a bare diff object. Throws on anything else. */
export function parseSettingsJson(text) {
  const value = JSON.parse(text);
  if (!isPlainObject(value)) throw new Error('not a settings object');
  return isPlainObject(value.settings) ? value.settings : value;
}

/* ----------------------------------------------------------------- files */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text, filename, type = 'application/json') {
  downloadBlob(new Blob([text], { type }), filename);
}

/** Open the native file picker; resolves with the chosen File, or null when cancelled. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;
    const finish = (file) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error('could not read file'));
    reader.readAsDataURL(file);
  });
}
