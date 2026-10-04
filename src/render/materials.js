/**
 * Material set for the maze surfaces (walls, floor, ceiling, posters).
 *
 * `lighting.mode === 'classic'` gives fullbright MeshBasicMaterials like the original
 * OpenGL screensaver; `'lit'` gives MeshLambertMaterials that react to the lights in
 * lighting.js. Textures come from the TextureCache (`getForSlot` hands out a per-slot
 * clone with repeat/offset already applied), so this module owns the materials only and
 * never disposes a texture.
 */
import * as THREE from 'three';

/** Slot configs for the two fixed sign posters: plain, untinted, one repeat. */
const FIXED_POSTER_SLOT = Object.freeze({
  repeatU: 1, repeatV: 1, tint: '#ffffff', brightness: 1, offsetU: 0, offsetV: 0, custom: null,
});

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

/** Texture-cache slot name and slot config backing a poster of `kind`. */
function posterSlot(config, kind) {
  if (kind === 'start' || kind === 'finish') return [`poster-${kind}`, { ...FIXED_POSTER_SLOT, kind }];
  return ['poster', config.textures.poster];
}

/**
 * Create the shared material set. Reads `config.lighting.mode`, `config.lighting.floorShade /
 * ceilingShade` and every `config.textures.*` slot; call `refresh()` after any of them change.
 *
 * @param {object} config        the shared app config
 * @param {{ getForSlot(slotName: string, slotConfig: object, globalTexConfig: object): THREE.Texture }} textureCache
 * @returns {{
 *   wall: THREE.Material, floor: THREE.Material, ceiling: THREE.Material,
 *   mode: 'classic'|'lit',
 *   poster(kind: string): THREE.Material,
 *   refresh(): boolean,
 *   dispose(): void }}
 *   `refresh()` returns true when the material *instances* were replaced (lighting mode switch);
 *   meshes built earlier must then re-read `wall/floor/ceiling/poster(kind)`.
 */
export function createMaterialSet(config, textureCache) {
  let mode = null;
  /** @type {Map<string, THREE.Material>} poster kind → material */
  const posters = new Map();

  const wantedMode = () => (config.lighting.mode === 'lit' ? 'lit' : 'classic');
  const textureFor = (slotName, slotConfig) => textureCache.getForSlot(slotName, slotConfig, config.textures);

  function make(params) {
    const material = mode === 'lit' ? new THREE.MeshLambertMaterial(params) : new THREE.MeshBasicMaterial(params);
    material.side = THREE.FrontSide;
    return material;
  }

  function setMap(material, texture) {
    if (material.map === texture) return;
    material.map = texture;
    material.needsUpdate = true;
  }

  function applyShades() {
    set.floor.color.setScalar(clamp01(config.lighting.floorShade));
    set.ceiling.color.setScalar(clamp01(config.lighting.ceilingShade));
  }

  function build() {
    mode = wantedMode();
    set.wall = make({ name: 'wall', map: textureFor('wall', config.textures.wall), vertexColors: true });
    set.floor = make({ name: 'floor', map: textureFor('floor', config.textures.floor) });
    set.ceiling = make({ name: 'ceiling', map: textureFor('ceiling', config.textures.ceiling) });
    applyShades();
  }

  function disposeAll() {
    for (const material of [set.wall, set.floor, set.ceiling, ...posters.values()]) material?.dispose();
    posters.clear();
    set.wall = set.floor = set.ceiling = null;
  }

  /** Material for a poster kind ('start' | 'finish' | anything else = the configurable poster slot). */
  function poster(kind) {
    let material = posters.get(kind);
    if (!material) {
      const [slotName, slotConfig] = posterSlot(config, kind);
      material = make({
        name: `poster:${kind}`,
        map: textureFor(slotName, slotConfig),
        transparent: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      posters.set(kind, material);
    }
    return material;
  }

  /** Re-read the config: swaps maps / shades in place, or rebuilds everything on a mode switch. */
  function refresh() {
    if (wantedMode() !== mode) {
      disposeAll();
      build();
      return true;
    }
    setMap(set.wall, textureFor('wall', config.textures.wall));
    setMap(set.floor, textureFor('floor', config.textures.floor));
    setMap(set.ceiling, textureFor('ceiling', config.textures.ceiling));
    for (const [kind, material] of posters) {
      const [slotName, slotConfig] = posterSlot(config, kind);
      setMap(material, textureFor(slotName, slotConfig));
    }
    applyShades();
    return false;
  }

  const set = {
    wall: null,
    floor: null,
    ceiling: null,
    get mode() { return mode; },
    poster,
    refresh,
    dispose: disposeAll,
  };
  build();
  return set;
}
