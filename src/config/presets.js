/**
 * Named presets. Each preset is a *partial* config merged over DEFAULTS by
 * `createConfig(preset)` / `deepMerge(config, preset)`. Ids must match ENUMS.presets.
 */
export const PRESETS = {
  classic95: {},

  pixelPotato: {
    camera: { renderScale: 0.4, aspectMode: '4:3', fov: 75 },
    timing: { fpsCap: 15, tickRate: 15, interpolate: false },
    movement: { quantize: 6, stepEasing: 'linear', turnEasing: 'linear' },
    textures: { filtering: 'pixelated', resolution: 64 },
    effects: { colorDepth: '256', dither: true, pixelate: 1, scanlines: 0.0 },
  },

  hedgeGarden: {
    textures: {
      wall: { kind: 'hedge', repeatU: 1, repeatV: 1 },
      floor: { kind: 'cobble' },
      ceiling: { kind: 'solid', tint: '#8ec5ff' },
    },
    lighting: {
      mode: 'lit', ambientIntensity: 0.55, sunEnabled: true, sunIntensity: 1.1,
      sunElevation: 50, sunAzimuth: 40, hemisphereEnabled: true,
      fogEnabled: true, fogType: 'exp2', fogColor: '#9fc9ff', fogDensity: 0.05, backgroundColor: '#9fc9ff',
    },
    maze: { algorithm: 'kruskal', braid: 0.15 },
  },

  dungeon: {
    textures: {
      wall: { kind: 'stone', repeatU: 1, repeatV: 1 },
      floor: { kind: 'cobble' },
      ceiling: { kind: 'plaster', tint: '#6b6b6b' },
    },
    lighting: {
      mode: 'lit', ambientColor: '#1a1410', ambientIntensity: 0.35,
      headlampEnabled: true, headlampColor: '#ffb35c', headlampIntensity: 3.0, headlampDistance: 6, headlampDecay: 1.8,
      fogEnabled: true, fogType: 'exp2', fogColor: '#050302', fogDensity: 0.16, backgroundColor: '#050302',
      faceShading: 0.25,
    },
    objects: { polyhedra: { color: '#6f6f6f' } },
    maze: { algorithm: 'huntAndKill', width: 24, height: 24 },
  },

  neonNight: {
    textures: {
      wall: { kind: 'metal', tint: '#80e0ff' },
      floor: { kind: 'checker', tint: '#ff66cc' },
      ceiling: { kind: 'solid', tint: '#05020a' },
    },
    lighting: {
      mode: 'lit', ambientColor: '#4020a0', ambientIntensity: 0.6,
      headlampEnabled: true, headlampColor: '#00ffff', headlampIntensity: 2.5, headlampDistance: 9, headlampDecay: 1.2,
      fogEnabled: true, fogType: 'linear', fogColor: '#100020', fogNear: 2, fogFar: 10, backgroundColor: '#100020',
    },
    effects: { scanlines: 0.25, vignette: 0.35, curvature: 0.12 },
    objects: { polyhedra: { color: '#ff00aa', wireframe: true } },
    maze: { algorithm: 'prim', braid: 0.3 },
  },

  smoothModern: {
    timing: { fpsCap: 0, tickRate: 60, interpolate: true },
    movement: { stepDuration: 0.6, turnDuration: 0.5, stepEasing: 'easeInOut', turnEasing: 'smooth', headBob: 0.015 },
    textures: { filtering: 'trilinear', anisotropy: 8, resolution: 512 },
    camera: { fov: 75 },
  },
};
