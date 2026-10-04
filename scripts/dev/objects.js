/**
 * Dev page for src/render/objects.js.
 *
 * A small generated maze with the real wall/floor/ceiling materials, a DecorationLayer
 * and two Rats. `window.__objectsDev.shoot(name)` sets up a deterministic shot (camera
 * looking down the longest corridor at a polyhedron, a smiley and a rat; a rat close-up;
 * lit mode with smooth shading; wireframe) so a Playwright script can screenshot each one.
 * The real `placeDecorations()` output is validated against the maze and listed in the
 * status box; the staged shots use hand-placed decorations in the corridor.
 */
import * as THREE from 'three';
import { createConfig } from '../../src/config/defaults.js';
import { generateMaze } from '../../src/maze/generator.js';
import { createRng } from '../../src/maze/rng.js';
import { DIRS, turnRight, yawForHeading } from '../../src/maze/grid.js';
import { TextureCache } from '../../src/render/textures.js';
import { createMaterialSet } from '../../src/render/materials.js';
import { buildMazeGroup } from '../../src/render/mazeMesh.js';
import { createLighting } from '../../src/render/lighting.js';
import { placeDecorations, DecorationLayer, Rat, teleportTarget } from '../../src/render/objects.js';

const WIDTH = 960;
const HEIGHT = 720;
const DT = 1 / 30;

const status = document.getElementById('status');
const canvas = document.getElementById('gl');

/** Longest straight run of open cells, as { x, y, heading, length }. */
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

/** First seed whose maze has a corridor of at least `minLength` cells (deterministic). */
function pickMaze(minLength) {
  for (let k = 0; k < 50; k++) {
    const maze = generateMaze({ width: 10, height: 8, algorithm: 'backtracker', seed: `objects-${k}`, braid: 0.1 });
    const corridor = longestCorridor(maze);
    if (corridor.length >= minLength) return { maze, corridor, seed: `objects-${k}` };
  }
  throw new Error('no maze with a long enough corridor');
}

const corridorCell = (corridor, i) => ({ x: corridor.x + DIRS[corridor.heading].dx * i, y: corridor.y + DIRS[corridor.heading].dy * i });

/** Sanity-check a placeDecorations() result; returns a list of problems (empty = fine). */
function validate(maze, config, deco) {
  const problems = [];
  const key = (c) => maze.index(c.x, c.y);
  const faces = new Set();
  const cells = new Set([key(maze.start), key(maze.finish)]);
  for (const p of deco.posters) {
    if (!maze.hasWall(p.x, p.y, p.dir)) problems.push(`poster on open side ${JSON.stringify(p)}`);
    const face = key(p) * 4 + p.dir;
    if (faces.has(face)) problems.push(`duplicate poster face ${face}`);
    faces.add(face);
    if (p.kind === 'poster' && cells.has(key(p))) problems.push('random poster in start/finish cell');
  }
  for (const list of [deco.polyhedra, deco.smileys]) {
    for (const c of list) {
      if (cells.has(key(c))) problems.push(`object cell reused ${JSON.stringify(c)}`);
      cells.add(key(c));
    }
  }
  if (deco.polyhedra.length !== config.objects.polyhedra.count) problems.push(`polyhedra count ${deco.polyhedra.length}`);
  if (deco.smileys.length !== config.objects.smiley.count) problems.push(`smiley count ${deco.smileys.length}`);
  return problems;
}

/* ---------------------------------------------------------------- scene */

const config = createConfig();
config.camera.fov = 75;
config.objects.rat.count = 2;
const { maze, corridor, seed } = pickMaze(5);
const rng = createRng(seed);

const realDecorations = placeDecorations(maze, config, rng.fork('decorations'));
const problems = validate(maze, config, realDecorations);
for (const p of problems) console.error('placeDecorations:', p);

// Staged decorations for the screenshots, lined up in the camera's corridor. Everything sits
// on the corridor axis at eye height, so the icosahedron at +2 hides the smiley at +3; the
// 'smiley' shot hides the polyhedra (setVisibleTypes) to reveal it.
const POLY_CELL = corridorCell(corridor, 2);
const SMILEY_CELL = corridorCell(corridor, 3);
const stagedDecorations = {
  posters: realDecorations.posters,
  polyhedra: [
    { ...POLY_CELL, shape: 'icosahedron' },
    { ...corridorCell(corridor, 5), shape: 'dodecahedron' },
    ...realDecorations.polyhedra.slice(0, 3),
  ],
  smileys: [SMILEY_CELL, ...realDecorations.smileys.slice(0, 1)],
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(config.camera.fov, WIDTH / HEIGHT, config.camera.near, config.camera.far);
camera.rotation.order = 'YXZ';
scene.add(camera);
const closeup = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.02, 50);

const textureCache = new TextureCache({ seed });
const materials = createMaterialSet(config, textureCache);
const mazeGroup = buildMazeGroup(maze, config, materials, stagedDecorations);
scene.add(mazeGroup.group);
const lighting = createLighting(scene, camera);
lighting.apply(config);

const layer = new DecorationLayer(maze, config, stagedDecorations);
scene.add(layer.group);
const rats = [0, 1].map((i) => {
  const rat = new Rat(maze, config, rng.fork(`rat${i}`));
  scene.add(rat.group);
  return rat;
});

let time = 0;
function step(dt) {
  time += dt;
  layer.update(dt, time);
  for (const rat of rats) rat.update(dt);
}

function placeCorridorCamera() {
  camera.position.set((corridor.x + 0.5) * config.maze.cellSize, config.camera.height, (corridor.y + 0.5) * config.maze.cellSize);
  camera.rotation.set(0, yawForHeading(corridor.heading), 0);
  camera.fov = config.camera.fov;
  camera.updateProjectionMatrix();
}

/** Step the animation until the staged smiley's facing (|cos yaw|) is within [lo, hi]. */
function settleSmiley(lo, hi) {
  const mesh = layer.objectAt(SMILEY_CELL.x, SMILEY_CELL.y).mesh;
  for (let i = 0; i < 400; i++) {
    const facing = Math.abs(Math.cos(mesh.rotation.y));
    if (facing >= lo && facing <= hi) return i;
    step(DT);
  }
  throw new Error('smiley never reached the wanted angle');
}

/** Park rat 0 one cell ahead of the camera, side-on, so the shot always shows it. */
function parkRatInCorridor() {
  const cell = corridorCell(corridor, 1);
  rats[0].walker.teleport(cell, turnRight(corridor.heading));
  rats[0].update(DT * 0.25);
}

function applyMode(mode) {
  config.lighting.mode = mode === 'lit' ? 'lit' : 'classic';
  config.lighting.headlampEnabled = mode === 'lit';
  config.lighting.ambientIntensity = mode === 'lit' ? 0.45 : 1;
  config.lighting.fogEnabled = mode === 'lit';
  config.lighting.fogType = 'exp2';
  config.lighting.fogDensity = 0.08;
  config.objects.polyhedra.flatShading = mode !== 'lit';
  config.objects.polyhedra.wireframe = mode === 'wire';
  config.objects.smiley.size = mode === 'wire' ? 0.6 : 0.42;
  config.objects.polyhedra.color = mode === 'wire' ? '#ff00aa' : '#9c9c9c';
  config.objects.rat.color = mode === 'wire' ? '#c8c8c8' : '#8a8a8a';
  config.objects.rat.size = mode === 'wire' ? 1.5 : 1;
  layer.setVisibleTypes({ polyhedra: true, smiley: true });
  if (materials.refresh()) mazeGroup.refreshMaterials();
  lighting.apply(config);
}

const SHOTS = {
  corridor() {
    applyMode('classic');
    for (let i = 0; i < 40; i++) step(DT);
    parkRatInCorridor();
    placeCorridorCamera();
    return camera;
  },
  smiley() {
    applyMode('classic');
    for (let i = 0; i < 10; i++) step(DT);
    settleSmiley(0.95, 1); // full face
    layer.setVisibleTypes({ polyhedra: false });
    parkRatInCorridor();
    placeCorridorCamera();
    return camera;
  },
  rat() {
    applyMode('classic');
    for (let i = 0; i < 12; i++) step(DT);
    parkRatInCorridor();
    // Mid-stride pose, front-right three-quarter view.
    rats[0].walker.enqueue('forward');
    for (let i = 0; i < 4; i++) rats[0].update(DT);
    const g = rats[0].group;
    const offset = new THREE.Vector3(0.42, 0.26, -0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y);
    closeup.position.copy(g.position).add(offset);
    closeup.lookAt(g.position.x, 0.07, g.position.z);
    return closeup;
  },
  lit() {
    applyMode('lit');
    for (let i = 0; i < 10; i++) step(DT);
    parkRatInCorridor();
    placeCorridorCamera();
    return camera;
  },
  wire() {
    applyMode('wire');
    for (let i = 0; i < 10; i++) step(DT);
    layer.setVisibleTypes({ smiley: false });
    parkRatInCorridor();
    placeCorridorCamera();
    return camera;
  },
};

let live = null;
function stopLive() {
  if (live) cancelAnimationFrame(live);
  live = null;
}

function info(name, cam) {
  const r = renderer.info.render;
  const ratLine = rats.map((rat, i) => `rat${i}=(${rat.cell.x},${rat.cell.y}) h${rat.heading} ${rat.state}`).join('  ');
  return `shot=${name}  lighting=${config.lighting.mode}  corridor=(${corridor.x},${corridor.y}) h${corridor.heading} len${corridor.length}`
    + `\nreal decorations: posters=${realDecorations.posters.length} polyhedra=${realDecorations.polyhedra.length} smileys=${realDecorations.smileys.length}`
    + `  problems=${problems.length}  objectAt(smiley cell)=${layer.objectAt(SMILEY_CELL.x, SMILEY_CELL.y)?.type}`
    + ` objectAt(poly cell)=${layer.objectAt(POLY_CELL.x, POLY_CELL.y)?.type}`
    + `\ndraw calls=${r.calls} triangles=${r.triangles}  ${ratLine}  cam=${cam === closeup ? 'closeup' : 'walker'}`
    + `\n${maze.toString()}`;
}

function shoot(name) {
  stopLive();
  const setup = SHOTS[name];
  if (!setup) throw new Error(`unknown shot "${name}"`);
  const cam = setup();
  renderer.render(scene, cam);
  const line = info(name, cam);
  status.textContent = line;
  return line;
}

function startLive() {
  stopLive();
  applyMode('classic');
  placeCorridorCamera();
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    step(dt);
    renderer.render(scene, camera);
    status.textContent = info('live', camera);
    live = requestAnimationFrame(frame);
  };
  live = requestAnimationFrame(frame);
}

/** Exercise setVisibleTypes/objectAt and a polyhedron teleport pick; returns a report line. */
function probe() {
  const cell = POLY_CELL;
  const before = layer.objectAt(cell.x, cell.y)?.type;
  layer.setVisibleTypes({ polyhedra: false });
  const hidden = layer.objectAt(cell.x, cell.y);
  layer.setVisibleTypes({ polyhedra: true });
  const after = layer.objectAt(cell.x, cell.y)?.type;
  const nowhere = layer.objectAt(-1, -1);
  const target = teleportTarget(maze, rng.fork('probe'), [maze.start, maze.finish]);
  return `probe: before=${before} hidden=${hidden} after=${after} nowhere=${nowhere} teleport=${JSON.stringify(target)}`;
}

/** Run the rats for a long time (hits finish teleports) and report they are still on open cells. */
function soak(seconds) {
  const finishes = rats.map(() => 0);
  const listeners = rats.map((rat, i) => { const fn = () => finishes[i]++; rat.walker.on('finish', fn); return fn; });
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) step(DT);
  rats.forEach((rat, i) => rat.walker.off('finish', listeners[i]));
  const fine = rats.every((rat) => maze.inBounds(rat.cell.x, rat.cell.y) && rat.state !== 'finished');
  return `soak ${seconds}s: ${fine ? 'rats fine' : 'RAT STUCK'}  finishes=${finishes.join('/')}  `
    + rats.map((r) => `(${r.cell.x},${r.cell.y}) ${r.state}`).join(' ');
}

/** Dispose everything and report what the renderer still holds. */
function teardown() {
  stopLive();
  for (const rat of rats) rat.dispose();
  layer.dispose();
  mazeGroup.dispose();
  materials.dispose();
  lighting.dispose();
  textureCache.dispose();
  renderer.render(scene, camera);
  return { ...renderer.info.memory, programs: renderer.info.programs.length, children: scene.children.length };
}

for (const button of document.querySelectorAll('button[data-shot]')) {
  button.addEventListener('click', () => (button.dataset.shot === 'live' ? startLive() : shoot(button.dataset.shot)));
}

window.__objectsDev = { shots: Object.keys(SHOTS), shoot, probe, soak, teardown, maze, config, layer, rats, problems, done: false };
shoot('corridor');
window.__objectsDev.done = true;
