/**
 * Dev page for src/render/{materials,mazeMesh,lighting,post}.js.
 *
 * Carves a 12×12 maze, places START / FINISH / poster signs where the camera can see
 * them, and renders the same view in three modes: classic unlit, lit with headlamp and
 * fog, and classic with heavy post effects. `window.__renderDev.render(mode)` switches
 * modes so a Playwright script can screenshot each one.
 */
import * as THREE from 'three';
import { createConfig, deepMerge } from '../../src/config/defaults.js';
import { generateMaze } from '../../src/maze/generator.js';
import { DIRS, turnLeft, turnRight, yawForHeading } from '../../src/maze/grid.js';
import { TextureCache } from '../../src/render/textures.js';
import { createMaterialSet } from '../../src/render/materials.js';
import { buildMazeGroup, wallGeometryStats } from '../../src/render/mazeMesh.js';
import { createLighting } from '../../src/render/lighting.js';
import { PostPipeline } from '../../src/render/post.js';

const WIDTH = 960;
const HEIGHT = 720;
const SEED = 'windows95';

/** Config overrides per mode (merged over fresh defaults each time). */
const MODES = {
  classic: {},
  lit: {
    lighting: {
      mode: 'lit', ambientColor: '#ffffff', ambientIntensity: 0.3,
      headlampEnabled: true, headlampColor: '#ffe9c4', headlampIntensity: 2.5, headlampDistance: 7, headlampDecay: 1.5,
      fogEnabled: true, fogType: 'exp2', fogColor: '#050302', fogDensity: 0.12, backgroundColor: '#050302',
      faceShading: 0.3, floorShade: 0.85,
    },
  },
  post: {
    camera: { renderScale: 0.35 },
    effects: { colorDepth: '256', dither: true, scanlines: 0.3, curvature: 0.1 },
  },
  // Extra coverage: sun + hemisphere + linear fog (exercises the exp2 → linear fog swap).
  litSun: {
    textures: { wall: { kind: 'hedge' }, floor: { kind: 'cobble' }, ceiling: { kind: 'solid', tint: '#8ec5ff' } },
    lighting: {
      mode: 'lit', ambientIntensity: 0.55, sunEnabled: true, sunIntensity: 1.1, sunElevation: 50, sunAzimuth: 40,
      hemisphereEnabled: true, fogEnabled: true, fogType: 'linear', fogNear: 2, fogFar: 9,
      fogColor: '#9fc9ff', backgroundColor: '#9fc9ff', faceShading: 0.5,
    },
  },
  // Extra coverage: 16-colour palette, pixelate blocks, vignette, noise, gamma, 1.5× supersampling.
  post16: {
    camera: { renderScale: 1.5 },
    effects: { colorDepth: '16', dither: true, ditherStrength: 0.8, pixelate: 3, vignette: 0.5, noise: 0.08, gamma: 1.2, saturation: 1.3 },
  },
  // Extra coverage: 1-bit monochrome with dense scanlines and strong curvature.
  mono: {
    effects: { colorDepth: 'mono', dither: true, scanlines: 0.5, scanlineDensity: 0.5, curvature: 0.5, contrast: 1.2 },
  },
  // Extra coverage: 16-bit depth without dither at native scale.
  post16bit: {
    effects: { colorDepth: '16bit', brightness: 1.1 },
  },
};

const status = document.getElementById('status');
const canvas = document.getElementById('gl');

/** Longest straight run of open cells, as { x, y, heading, length } (length ≥ 1). */
function longestCorridor(maze) {
  let best = { x: 0, y: 0, heading: 0, length: 0 };
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      for (let h = 0; h < 4; h++) {
        let cx = x, cy = y, length = 0;
        while (!maze.hasWall(cx, cy, h)) { cx += DIRS[h].dx; cy += DIRS[h].dy; length++; }
        if (length > best.length) best = { x, y, heading: h, length };
      }
    }
  }
  return best;
}

/** Posters placed so the dev camera can judge orientation: START dead ahead, others on side walls. */
function devPosters(maze, corridor) {
  const { heading } = corridor;
  const endX = corridor.x + DIRS[heading].dx * corridor.length;
  const endY = corridor.y + DIRS[heading].dy * corridor.length;
  const posters = [
    { x: endX, y: endY, dir: heading, kind: 'start' },
    { x: maze.start.x, y: maze.start.y, dir: maze.start.heading, kind: 'start' },
  ];
  const finishWall = [0, 1, 2, 3].find((d) => maze.hasWall(maze.finish.x, maze.finish.y, d));
  if (finishWall !== undefined) posters.push({ x: maze.finish.x, y: maze.finish.y, dir: finishWall, kind: 'finish' });
  // Side walls along the corridor: first closed right wall gets FINISH, first closed left wall a poster.
  let placedRight = false, placedLeft = false;
  for (let i = 1; i <= corridor.length && !(placedRight && placedLeft); i++) {
    const x = corridor.x + DIRS[heading].dx * i, y = corridor.y + DIRS[heading].dy * i;
    if (!placedRight && maze.hasWall(x, y, turnRight(heading))) { posters.push({ x, y, dir: turnRight(heading), kind: 'finish' }); placedRight = true; }
    else if (!placedLeft && maze.hasWall(x, y, turnLeft(heading))) { posters.push({ x, y, dir: turnLeft(heading), kind: 'poster' }); placedLeft = true; }
  }
  return posters;
}

const config = createConfig();
const maze = generateMaze({ width: 12, height: 12, algorithm: config.maze.algorithm, seed: SEED, braid: 0.1 });
const corridor = longestCorridor(maze);
const decorations = { posters: devPosters(maze, corridor) };

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(config.camera.fov, WIDTH / HEIGHT, config.camera.near, config.camera.far);
camera.rotation.order = 'YXZ';
camera.position.set((corridor.x + 0.5) * config.maze.cellSize, config.camera.height, (corridor.y + 0.5) * config.maze.cellSize);
camera.rotation.y = yawForHeading(corridor.heading);
scene.add(camera); // the headlamp is a child of the camera

const textureCache = new TextureCache({ seed: SEED });
const materials = createMaterialSet(config, textureCache);
const mazeGroup = buildMazeGroup(maze, config, materials, decorations);
scene.add(mazeGroup.group);
const lighting = createLighting(scene, camera);
const post = new PostPipeline(renderer);

function render(mode) {
  const overrides = MODES[mode];
  if (!overrides) throw new Error(`unknown mode "${mode}"`);
  deepMerge(config, createConfig(overrides));
  if (materials.refresh()) mazeGroup.refreshMaterials();
  mazeGroup.setFaceShading(config.lighting.faceShading);
  lighting.apply(config);
  camera.fov = config.camera.fov;
  camera.updateProjectionMatrix();
  post.setSize(WIDTH, HEIGHT, config.camera.renderScale);
  post.setTime(performance.now() / 1000);
  post.render(scene, camera, config.effects);
  const info = renderer.info.render;
  const stats = wallGeometryStats(maze);
  const line = `mode=${mode}  materials=${materials.mode}  corridor=(${corridor.x},${corridor.y}) h${corridor.heading} len${corridor.length}`
    + `\nwalls=${stats.walls} faces=${stats.faces} verts=${stats.vertices} tris=${stats.triangles} ${stats.indexType}`
    + `\ndraw calls=${info.calls} triangles=${info.triangles}  posters=${decorations.posters.length}`
    + `\n${maze.toString()}`;
  status.textContent = line;
  return line;
}

for (const button of document.querySelectorAll('button[data-mode]')) {
  button.addEventListener('click', () => render(button.dataset.mode));
}

/** Dispose everything and report what the renderer still holds (should be only the stub canvas). */
function teardown() {
  mazeGroup.dispose();
  materials.dispose();
  lighting.dispose();
  post.dispose();
  textureCache.dispose();
  renderer.render(scene, camera); // flushes disposed resources so info.memory is current
  return { ...renderer.info.memory, programs: renderer.info.programs.length, children: scene.children.length };
}

window.__renderDev = { modes: Object.keys(MODES), render, teardown, maze, config, done: false };
render('classic');
window.__renderDev.done = true;
