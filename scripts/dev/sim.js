// Dev harness for src/sim: a hand-carved maze rendered with flat-coloured walls, driven
// by Walker + createLoop, exercising the finish transition, teleport flash and roll flip.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Maze, DIRS, turnLeft, turnRight, turnBack, yawForHeading } from '../../src/maze/grid.js';
import { createRng } from '../../src/maze/rng.js';
import { createConfig } from '../../src/config/defaults.js';
import { Walker } from '../../src/sim/walker.js';
import { createLoop } from '../../src/sim/loop.js';
import { createFinishTransition, createTeleportFlash, createRollAnimator } from '../../src/sim/transitions.js';

const params = new URLSearchParams(location.search);
const config = createConfig();
config.movement.stepDuration = 0.4;
config.movement.turnDuration = 0.3;
config.movement.quantize = Number(params.get('quantize') || 0);
config.timing.fpsCap = Number(params.get('fps') || 30);
config.timing.fixedTimestep = params.get('fixed') === '1';
config.timing.timeScale = Number(params.get('speed') || 1);
const transitionDuration = Number(params.get('tdur') || 1.2);
const teleportsEnabled = params.get('teleports') !== '0';

/* ---------- maze: deterministic recursive backtracker on the real Maze class ---------- */
function carveMaze(width, height, seed) {
  const maze = new Maze(width, height);
  const rng = createRng(seed);
  const visited = new Uint8Array(width * height);
  const stack = [{ x: 0, y: 0 }];
  visited[0] = 1;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = [];
    for (let d = 0; d < 4; d++) {
      const n = maze.neighbor(cur.x, cur.y, d);
      if (n && !visited[maze.index(n.x, n.y)]) options.push(d);
    }
    if (!options.length) { stack.pop(); continue; }
    const d = rng.pick(options);
    maze.carve(cur.x, cur.y, d);
    const n = maze.neighbor(cur.x, cur.y, d);
    visited[maze.index(n.x, n.y)] = 1;
    stack.push(n);
  }
  maze.start = { x: 0, y: 0, heading: maze.openDirs(0, 0)[0] };
  const far = maze.farthestCellFrom(maze.start);
  maze.finish = { x: far.x, y: far.y };
  return maze;
}

/* ---------- classic left-hand navigator (inline so this page depends on src/sim only) ----------
 * Commits to a direction when it first sees a cell, like src/maze/navigator.js, so a turn is
 * not re-evaluated against the new heading (a naive follower would spin in place). */
const leftHand = (maze) => {
  let committedCell = -1, committedDir = -1;
  const open = (cell, d) => !maze.hasWall(cell.x, cell.y, d) && maze.neighbor(cell.x, cell.y, d) !== null;
  return {
    next(cell, heading) {
      const idx = maze.index(cell.x, cell.y);
      if (idx !== committedCell) {
        committedCell = idx;
        committedDir = [turnLeft(heading), heading, turnRight(heading), turnBack(heading)].find((d) => open(cell, d));
      }
      if (committedDir === heading) return 'forward';
      if (committedDir === turnLeft(heading)) return 'left';
      if (committedDir === turnRight(heading)) return 'right';
      return 'back';
    },
    reset() { committedCell = -1; },
  };
};

/* ---------- scene ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(config.camera.fov, innerWidth / innerHeight, 0.05, 100);
const rig = new THREE.Object3D();
const tilt = new THREE.Object3D();
rig.add(tilt); tilt.add(camera); scene.add(rig);

let mazeGroup = null;
function buildMazeGroup(maze) {
  const group = new THREE.Group();
  const faces = [];
  const h = 1;
  const addWall = (x, y, d) => {
    const g = new THREE.PlaneGeometry(1, h);
    const cx = x + 0.5, cz = y + 0.5;
    if (d === 0) { g.rotateY(0); g.translate(cx, h / 2, cz - 0.5); }
    if (d === 1) { g.rotateY(-Math.PI / 2); g.translate(cx + 0.5, h / 2, cz); }
    if (d === 2) { g.rotateY(Math.PI); g.translate(cx, h / 2, cz + 0.5); }
    if (d === 3) { g.rotateY(Math.PI / 2); g.translate(cx - 0.5, h / 2, cz); }
    const shade = d === 1 || d === 3 ? 0.75 : 1;
    const col = new Float32Array(g.attributes.position.count * 3).fill(shade);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    faces.push(g);
  };
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) for (let d = 0; d < 4; d++) if (maze.hasWall(x, y, d)) addWall(x, y, d);
  const walls = new THREE.Mesh(mergeGeometries(faces), new THREE.MeshBasicMaterial({ color: 0xb03a2e, vertexColors: true, side: THREE.DoubleSide }));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(maze.width, maze.height).rotateX(-Math.PI / 2).translate(maze.width / 2, 0, maze.height / 2), new THREE.MeshBasicMaterial({ color: 0x5a5a5a }));
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(maze.width, maze.height).rotateX(Math.PI / 2).translate(maze.width / 2, h, maze.height / 2), new THREE.MeshBasicMaterial({ color: 0xd8d8c8 }));
  // finish marker: a green post in the finish cell
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, h, 0.2), new THREE.MeshBasicMaterial({ color: 0x20c020 }));
  post.position.set(maze.finish.x + 0.5, h / 2, maze.finish.y + 0.5);
  group.add(walls, floor, ceil, post);
  return { group, dispose() { for (const m of [walls, floor, ceil, post]) { m.geometry.dispose(); m.material.dispose(); } for (const g of faces) g.dispose(); } };
}

/* ---------- simulation ---------- */
let seedCounter = Number(params.get('seed') || 1);
let maze = carveMaze(7, 7, `dev-${seedCounter}`);
const walker = new Walker({ maze, navigator: leftHand(maze), movement: config.movement, cellSize: 1 });
mazeGroup = buildMazeGroup(maze);
scene.add(mazeGroup.group);

const roll = createRollAnimator();
let transition = null;
let flash = null;
let flipTimer = 2.5;
let teleportTimer = 4.0;
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const status = { ticks: 0, frames: 0, finishes: 0, teleports: 0, flips: 0, errors: [] };
window.addEventListener('error', (e) => status.errors.push(String(e.message)));

walker.on('finish', () => {
  status.finishes++;
  transition = createFinishTransition(params.get('transition') || 'spin', transitionDuration);
});

function regenerate() {
  scene.remove(mazeGroup.group);
  mazeGroup.dispose();
  seedCounter++;
  maze = carveMaze(7, 7, `dev-${seedCounter}`);
  mazeGroup = buildMazeGroup(maze);
  scene.add(mazeGroup.group);
  walker.setNavigator(leftHand(maze)).setMaze(maze);
}

function tick(dt) {
  status.ticks++;
  walker.update(dt);
  if (transition) {
    if (transition.update(dt)) { transition = null; regenerate(); }
  } else {
    teleportTimer -= dt;
    if (teleportsEnabled && teleportTimer <= 0 && walker.state !== 'finished') {
      teleportTimer = 4.0;
      const rng = createRng(`tp-${status.teleports++}`);
      walker.teleport({ x: rng.int(maze.width), y: rng.int(maze.height) }, rng.int(4));
      flash = createTeleportFlash(0.5);
    }
  }
  flipTimer -= dt;
  if (flipTimer <= 0) { flipTimer = 3.0; roll.toggle(config.objects.smiley.flipDuration); status.flips++; }
  roll.update(dt);
  if (flash && flash.update(dt)) flash = null;
}

function render(alpha, dt) {
  status.frames++;
  const pose = walker.interpolatedPose(config.timing.interpolate ? alpha : 1);
  const off = transition ? transition.cameraOffset : null;
  rig.position.set(pose.x, config.camera.height + pose.bob - (off ? off.drop : 0), pose.z);
  rig.rotation.y = pose.yaw + (off ? off.yaw : 0);
  tilt.rotation.x = THREE.MathUtils.degToRad(config.camera.pitch) + (off ? off.pitch : 0);
  camera.rotation.z = roll.roll + (off ? off.roll : 0);
  camera.position.z = off ? -off.dolly : 0;
  camera.fov = config.camera.fov * (off ? off.fovScale : 1);
  camera.updateProjectionMatrix();
  const ov = transition ? transition : flash;
  overlay.style.background = ov ? ov.color : '#000';
  overlay.style.opacity = ov ? ov.overlayAlpha.toFixed(3) : '0';
  renderer.render(scene, camera);
  hud.textContent = [
    `fps ${loop.fps.toFixed(1)}  frame ${loop.frameTime.toFixed(2)} ms  alpha ${alpha.toFixed(2)}  dt ${dt.toFixed(3)}`,
    `cell (${walker.cell.x},${walker.cell.y}) heading ${walker.heading} state ${walker.state} progress ${walker.phaseProgress.toFixed(2)}`,
    `steps ${walker.stats.steps} turns ${walker.stats.turns} visited ${walker.stats.cellsVisited} finishes ${walker.stats.finishes}`,
    `yaw ${pose.yaw.toFixed(3)} (canonical ${yawForHeading(walker.heading).toFixed(3)}) roll ${roll.roll.toFixed(2)}`,
    `ticks ${status.ticks} frames ${status.frames} transition ${transition ? transition.kind + ' ' + transition.progress.toFixed(2) : '-'} flash ${flash ? flash.overlayAlpha.toFixed(2) : '-'}`,
  ].join('\n');
}

const loop = createLoop({
  tick,
  render,
  getTickRate: () => config.timing.tickRate,
  getFpsCap: () => config.timing.fpsCap,
  getTimeScale: () => config.timing.timeScale,
  getFixedTimestep: () => config.timing.fixedTimestep,
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
loop.start();

window.__simDev = { loop, walker, status, config, DIRS, get transition() { return transition; }, get maze() { return maze; } };
