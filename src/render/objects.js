/**
 * Maze decorations: where they go and how they look.
 *
 * - `placeDecorations()` picks the cells/walls for START/FINISH + random posters, the
 *   spinning polyhedra and the smileys, deterministically from a seeded rng (each stage
 *   draws from its own `rng.fork()` so changing one count never reshuffles the others).
 * - `DecorationLayer` renders and animates the polyhedra and smileys (posters are baked
 *   into the static maze mesh by mazeMesh.js) and answers "what is in cell (x, y)?".
 * - `Rat` is the low-poly grey rat: its own `Walker` + navigator, animated legs/tail.
 * - `teleportTarget()` picks a random cell + heading for polyhedron teleports.
 *
 * Coordinates follow docs/ARCHITECTURE.md (cell (x, y) centred at ((x+.5)·cs, _, (y+.5)·cs),
 * floor y = 0). Every size here is in world units. `config.objects.*` is read live inside
 * `update()` so GUI sliders work without a rebuild; only placement needs a rebuild.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { OPPOSITE, DIRS } from '../maze/grid.js';
import { ENUMS } from '../config/defaults.js';
import { Walker } from '../sim/walker.js';
import { createNavigator } from '../maze/navigator.js';

/** Ids of the real polyhedron shapes ('random' excluded), in `ENUMS.polyhedronShapes` order. */
export const POLYHEDRON_SHAPE_IDS = Object.freeze(
  ENUMS.polyhedronShapes.map(([id]) => id).filter((id) => id !== 'random'),
);

const TWO_PI = Math.PI * 2;
const GOLDEN = 0.6180339887;
const GOLDEN_ANGLE = 2.3999632297;
/** Angular speed (rad/s) per unit of `spinSpeed`. */
const POLY_SPIN = 1.5;
const SMILEY_SPIN = 2.0;
/** Bob oscillation (rad/s) shared by every floating object. */
const BOB_RATE = 2.2;
/** Flat-shading model for unlit polyhedra: ambient + key light + weak fill, in object space. */
const FACET_AMBIENT = 0.45;
const FACET_KEY = new THREE.Vector3(0.45, 0.8, 0.4).normalize();
const FACET_KEY_STRENGTH = 0.55;
const FACET_FILL = new THREE.Vector3(-0.5, -0.2, -0.8).normalize();
const FACET_FILL_STRENGTH = 0.18;
/** Cube with a circumscribed radius of 1, like the other unit polyhedra. */
const CUBE_SIDE = 2 / Math.sqrt(3);

const SHAPE_FACTORIES = Object.freeze({
  tetrahedron: () => new THREE.TetrahedronGeometry(1),
  octahedron: () => new THREE.OctahedronGeometry(1),
  icosahedron: () => new THREE.IcosahedronGeometry(1),
  dodecahedron: () => new THREE.DodecahedronGeometry(1),
  cube: () => new THREE.BoxGeometry(CUBE_SIDE, CUBE_SIDE, CUBE_SIDE),
});

/* =============================================================== placement */

const toCount = (n) => Math.max(0, Math.floor(Number(n) || 0));
const cellOf = (maze, i) => ({ x: i % maze.width, y: (i / maze.width) | 0 });
const lightingMode = (config) => (config.lighting.mode === 'lit' ? 'lit' : 'classic');

/** Closed sides of cell (x, y) (boundary walls count: the grid never carves them). */
function closedWalls(maze, x, y) {
  const out = [];
  for (let d = 0; d < 4; d++) if (maze.hasWall(x, y, d)) out.push(d);
  return out;
}

/** A random closed wall of (x, y), or -1 when the cell is open on every side. */
function anyClosedWall(maze, x, y, rng) {
  const walls = closedWalls(maze, x, y);
  return walls.length ? rng.pick(walls) : -1;
}

/**
 * Length of the straight open run that leads up to the wall on side `dir` of (x, y):
 * how many cells a walker can approach it from head-on. Long runs make good poster walls.
 */
function approachLength(maze, x, y, dir) {
  const back = OPPOSITE[dir];
  let n = 0;
  while (!maze.hasWall(x, y, back)) {
    x += DIRS[back].dx;
    y += DIRS[back].dy;
    n++;
  }
  return n;
}

/** START / FINISH signs plus `randomCount` plain posters. */
function placePosters(maze, postersConfig, rng) {
  const posters = [];
  const s = maze.start;
  const f = maze.finish;
  if (postersConfig.startFinish) {
    const startDir = maze.hasWall(s.x, s.y, s.heading) ? s.heading : anyClosedWall(maze, s.x, s.y, rng);
    if (startDir >= 0) posters.push({ x: s.x, y: s.y, dir: startDir, kind: 'start' });
    const open = maze.openDirs(f.x, f.y);
    const finishDir = open.length === 1 ? OPPOSITE[open[0]] : anyClosedWall(maze, f.x, f.y, rng);
    if (finishDir >= 0) posters.push({ x: f.x, y: f.y, dir: finishDir, kind: 'finish' });
  }

  const wanted = toCount(postersConfig.randomCount);
  if (wanted === 0) return posters;
  // Weighted sampling without replacement (Efraimidis–Spirakis): key = u^(1/w), take the top k.
  // Every (cell, side) face is visited once and the start/finish cells are skipped, so no
  // two posters can land on the same face.
  const candidates = [];
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      if ((x === s.x && y === s.y) || (x === f.x && y === f.y)) continue;
      for (let dir = 0; dir < 4; dir++) {
        if (!maze.hasWall(x, y, dir)) continue;
        const weight = (1 + approachLength(maze, x, y, dir)) ** 2;
        candidates.push({ x, y, dir, kind: 'poster', key: Math.pow(rng(), 1 / weight) });
      }
    }
  }
  candidates.sort((a, b) => b.key - a.key);
  for (let i = 0; i < Math.min(wanted, candidates.length); i++) {
    const { x, y, dir, kind } = candidates[i];
    posters.push({ x, y, dir, kind });
  }
  return posters;
}

/** Does a cell with `openings` exits match the placement preference? */
function prefers(placement, openings) {
  if (placement === 'deadEnds') return openings === 1;
  if (placement === 'corridors') return openings === 2;
  return true;
}

/**
 * Pick `count` distinct cells not in `used` (a Set of cell indices), preferring cells that
 * match `placement` and falling back to the rest. Marks the picks as used.
 */
function chooseCells(maze, rng, count, placement, used) {
  const out = [];
  if (count <= 0) return out;
  const preferred = [];
  const fallback = [];
  for (let i = 0; i < maze.cells.length; i++) {
    if (used.has(i)) continue;
    const { x, y } = cellOf(maze, i);
    (prefers(placement, maze.openDirs(x, y).length) ? preferred : fallback).push(i);
  }
  rng.shuffle(preferred);
  const picks = preferred.slice(0, count);
  if (picks.length < count) picks.push(...rng.shuffle(fallback).slice(0, count - picks.length));
  for (const i of picks) {
    used.add(i);
    out.push(cellOf(maze, i));
  }
  return out;
}

function resolveShape(shape, rng) {
  return SHAPE_FACTORIES[shape] ? shape : rng.pick(POLYHEDRON_SHAPE_IDS);
}

/**
 * Decide where every decoration goes. Deterministic for a given maze, config and rng.
 *
 * Posters: START on the start cell's wall in `maze.start.heading` (or any closed wall),
 * FINISH on the wall opposite the finish cell's single opening (or any closed wall), then
 * `objects.posters.randomCount` plain posters on closed walls of other cells, weighted
 * toward walls at the end of straight runs (the walls the camera walks toward). Polyhedra
 * and smileys get distinct cells (never start/finish), honouring their `placement`.
 *
 * @param {import('../maze/grid.js').Maze} maze
 * @param {object} config the shared app config (reads `config.objects`)
 * @param {Function} rng seeded rng from `createRng` (forked per stage)
 * @returns {{
 *   posters: { x: number, y: number, dir: number, kind: 'start'|'finish'|'poster' }[],
 *   polyhedra: { x: number, y: number, shape: string }[],
 *   smileys: { x: number, y: number }[] }}
 */
export function placeDecorations(maze, config, rng) {
  const O = config.objects;
  const used = new Set([maze.index(maze.start.x, maze.start.y), maze.index(maze.finish.x, maze.finish.y)]);

  const posters = placePosters(maze, O.posters, rng.fork('posters'));

  const polyRng = rng.fork('polyhedra');
  const polyCount = O.polyhedra.enabled ? toCount(O.polyhedra.count) : 0;
  const polyhedra = chooseCells(maze, polyRng, polyCount, O.polyhedra.placement, used)
    .map(({ x, y }) => ({ x, y, shape: resolveShape(O.polyhedra.shape, polyRng) }));

  const smileyCount = O.smiley.enabled ? toCount(O.smiley.count) : 0;
  const smileys = chooseCells(maze, rng.fork('smileys'), smileyCount, O.smiley.placement, used);

  return { posters, polyhedra, smileys };
}

/* ------------------------------------------------------------ random cells */

/** Cell `i` as a teleport target: `{ x, y, heading }` facing one of its open sides (0 when boxed in). */
function cellWithHeading(maze, i, rng) {
  const { x, y } = cellOf(maze, i);
  const open = maze.openDirs(x, y);
  return { x, y, heading: open.length ? open[rng.int(open.length)] : 0 };
}

/** Uniform random cell whose index is not in `banned` and passes `accept(index)` (when given). */
function randomCell(maze, rng, banned, accept = null) {
  const candidates = [];
  for (let i = 0; i < maze.cells.length; i++) {
    if (!banned.has(i) && (!accept || accept(i))) candidates.push(i);
  }
  return candidates.length ? cellWithHeading(maze, candidates[rng.int(candidates.length)], rng) : null;
}

/**
 * Random cell not listed in `exclude`, with a heading that faces one of its open sides.
 * Used for the classic "touch a polyhedron, land somewhere else" teleport. Falls back to
 * the start cell when every cell is excluded (tiny mazes).
 *
 * @param {import('../maze/grid.js').Maze} maze
 * @param {Function} rng
 * @param {{ x: number, y: number }[]} [exclude]
 * @returns {{ x: number, y: number, heading: number }}
 */
export function teleportTarget(maze, rng, exclude = []) {
  const banned = new Set();
  for (const c of exclude) if (c && maze.inBounds(c.x, c.y)) banned.add(maze.index(c.x, c.y));
  return randomCell(maze, rng, banned) ?? cellWithHeading(maze, maze.index(maze.start.x, maze.start.y), rng);
}

/* ============================================================ geometry kit */

/** Grey level for a surface normal under the fixed object-space lights (unlit polyhedra). */
function facetShade(normal) {
  const key = Math.max(0, normal.dot(FACET_KEY)) * FACET_KEY_STRENGTH;
  const fill = Math.max(0, normal.dot(FACET_FILL)) * FACET_FILL_STRENGTH;
  return Math.min(1, FACET_AMBIENT + key + fill);
}

/** Per-vertex grey from the geometry's normals (face normals ⇒ one shade per facet). */
function shadeByNormal(geometry) {
  const normal = geometry.attributes.normal;
  const color = new Float32Array(normal.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < normal.count; i++) {
    const shade = facetShade(n.fromBufferAttribute(normal, i));
    color[i * 3] = color[i * 3 + 1] = color[i * 3 + 2] = shade;
  }
  return new THREE.BufferAttribute(color, 3);
}

/**
 * Unit-radius polyhedron with a baked `color` attribute. `flat` keeps one normal/shade per
 * face; otherwise vertices are merged and normals averaged so Lambert and the baked greys
 * both read as smooth.
 */
function buildShapeGeometry(shape, flat) {
  const base = SHAPE_FACTORIES[shape]();
  let geometry = base.index ? base.toNonIndexed() : base;
  if (geometry !== base) base.dispose();
  if (!flat) {
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    const merged = mergeVertices(geometry);
    geometry.dispose();
    geometry = merged;
    geometry.computeVertexNormals();
  }
  geometry.setAttribute('color', shadeByNormal(geometry));
  return geometry;
}

function createPolyhedronMaterial(mode, P) {
  const color = new THREE.Color(P.color);
  if (mode === 'lit') return new THREE.MeshLambertMaterial({ color, flatShading: !!P.flatShading, wireframe: !!P.wireframe });
  return new THREE.MeshBasicMaterial({ color, vertexColors: true, wireframe: !!P.wireframe });
}

/** Yellow smiley on a square canvas; the disc geometry's UVs map onto the inscribed circle. */
function drawSmiley(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  ctx.fillStyle = '#ffd400';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = size * 0.06;
  ctx.beginPath();
  ctx.arc(c, c, c - ctx.lineWidth / 2, 0, TWO_PI);
  ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(c + side * size * 0.17, c - size * 0.12, size * 0.055, size * 0.085, 0, 0, TWO_PI);
    ctx.fill();
  }
  ctx.lineWidth = size * 0.055;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(c, c + size * 0.03, size * 0.3, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  return canvas;
}

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const frac = (v) => v - Math.floor(v);
const wrapAngle = (a) => (a > TWO_PI ? a - TWO_PI : a < -TWO_PI ? a + TWO_PI : a);

/* ========================================================= DecorationLayer */

/**
 * Animated polyhedra and smileys. Build once per maze from `placeDecorations()`; every
 * look/animation parameter (`size`, `spinSpeed`, `bob`, `color`, `wireframe`,
 * `flatShading`, `lighting.mode`) is re-read live in `update()`.
 */
export class DecorationLayer {
  /**
   * @param {import('../maze/grid.js').Maze} maze
   * @param {object} config
   * @param {ReturnType<typeof placeDecorations>} decorations
   */
  constructor(maze, config, decorations) {
    this.maze = maze;
    this.config = config;
    this.group = new THREE.Group();
    this.group.name = 'decorations';
    this._polyGroup = new THREE.Group();
    this._polyGroup.name = 'polyhedra';
    this._smileyGroup = new THREE.Group();
    this._smileyGroup.name = 'smileys';
    this.group.add(this._polyGroup, this._smileyGroup);

    /** @type {Map<string, THREE.BufferGeometry>} `${shape}:${flat}` → shared geometry */
    this._geometries = new Map();
    this._polyMaterial = null;
    this._polyMode = null;
    this._polyFlat = null;
    this._polyColor = '';
    this._circle = null;
    this._smileyTexture = null;
    this._smileyMaterial = null;
    /** Entries double as `objectAt()` results: { type, mesh, index, …animation state }. */
    this._polyhedra = [];
    this._smileys = [];
    /** @type {Map<number, object>} cell index → entry */
    this._byCell = new Map();
    this._clock = 0;

    this._syncPolyhedronStyle();
    this._buildPolyhedra(decorations.polyhedra ?? []);
    this._buildSmileys(decorations.smileys ?? []);
    this.setVisibleTypes({ polyhedra: !!config.objects.polyhedra.enabled, smiley: !!config.objects.smiley.enabled });
  }

  _geometryFor(shape, flat) {
    const key = `${shape}:${flat ? 'flat' : 'smooth'}`;
    let geometry = this._geometries.get(key);
    if (!geometry) {
      geometry = buildShapeGeometry(shape, flat);
      this._geometries.set(key, geometry);
    }
    return geometry;
  }

  _buildPolyhedra(list) {
    const cs = this.config.maze.cellSize;
    const baseY = this.config.maze.wallHeight * 0.5;
    list.forEach(({ x, y, shape }, i) => {
      const mesh = new THREE.Mesh(this._geometryFor(shape, this._polyFlat), this._polyMaterial);
      mesh.name = `polyhedron:${shape}`;
      mesh.position.set((x + 0.5) * cs, baseY, (y + 0.5) * cs);
      // Each solid tumbles about its own tilted axis, at its own rate, in alternating directions.
      const tilt = 0.25 + 0.4 * frac(i * GOLDEN);
      const az = i * GOLDEN_ANGLE;
      const axis = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
      const entry = {
        type: 'polyhedron', mesh, index: i, shape,
        axis, rate: (0.8 + 0.4 * frac(i * 0.7548776662)) * (i % 2 ? -1 : 1), angle: i * 1.3, phase: i * 1.7,
      };
      this._polyhedra.push(entry);
      this._byCell.set(this.maze.index(x, y), entry);
      this._polyGroup.add(mesh);
    });
  }

  _buildSmileys(list) {
    if (!list.length) return;
    const cs = this.config.maze.cellSize;
    this._smileyTexture = canvasTexture(drawSmiley(128));
    this._smileyMaterial = new THREE.MeshBasicMaterial({ map: this._smileyTexture, side: THREE.DoubleSide });
    this._circle = new THREE.CircleGeometry(1, 40);
    list.forEach(({ x, y }, i) => {
      const mesh = new THREE.Mesh(this._circle, this._smileyMaterial);
      mesh.name = 'smiley';
      mesh.position.set((x + 0.5) * cs, this.config.camera.height, (y + 0.5) * cs);
      const entry = { type: 'smiley', mesh, index: i, rate: i % 2 ? -1 : 1, angle: i * 2.1, phase: i * 2.6 };
      this._smileys.push(entry);
      this._byCell.set(this.maze.index(x, y), entry);
      this._smileyGroup.add(mesh);
    });
  }

  /** Re-read lighting mode / colour / wireframe / flat shading; swaps material or geometry only on change. */
  _syncPolyhedronStyle() {
    const P = this.config.objects.polyhedra;
    const mode = lightingMode(this.config);
    const flat = !!P.flatShading;
    if (mode !== this._polyMode) {
      this._polyMaterial?.dispose();
      this._polyMaterial = createPolyhedronMaterial(mode, P);
      this._polyMode = mode;
      this._polyColor = P.color;
      for (const e of this._polyhedra) e.mesh.material = this._polyMaterial;
    }
    const m = this._polyMaterial;
    if (flat !== this._polyFlat) {
      this._polyFlat = flat;
      for (const e of this._polyhedra) e.mesh.geometry = this._geometryFor(e.shape, flat);
      if (mode === 'lit' && m.flatShading !== flat) {
        m.flatShading = flat;
        m.needsUpdate = true;
      }
    }
    if (m.wireframe !== !!P.wireframe) m.wireframe = !!P.wireframe;
    if (P.color !== this._polyColor) {
      this._polyColor = P.color;
      m.color.set(P.color);
    }
  }

  /**
   * Advance animations. `dt` seconds since the last call; `time` is an absolute clock in
   * seconds (defaults to an internal accumulator).
   */
  update(dt, time = this._clock + dt) {
    this._clock = time;
    this._syncPolyhedronStyle();
    const { polyhedra: P, smiley: S } = this.config.objects;

    const polyY = this.config.maze.wallHeight * 0.5;
    const polySize = Math.max(0, P.size);
    const polySpin = P.spinSpeed * POLY_SPIN;
    for (const e of this._polyhedra) {
      e.angle = wrapAngle(e.angle + polySpin * e.rate * dt);
      e.mesh.quaternion.setFromAxisAngle(e.axis, e.angle);
      e.mesh.position.y = polyY + P.bob * Math.sin(time * BOB_RATE + e.phase);
      e.mesh.scale.setScalar(polySize);
    }

    const eyeY = this.config.camera.height;
    const smileySize = Math.max(0, S.size);
    const smileySpin = S.spinSpeed * SMILEY_SPIN;
    for (const e of this._smileys) {
      e.angle = wrapAngle(e.angle + smileySpin * e.rate * dt);
      e.mesh.rotation.y = e.angle;
      e.mesh.position.y = eyeY + S.bob * Math.sin(time * BOB_RATE + e.phase);
      e.mesh.scale.setScalar(smileySize);
    }
  }

  /**
   * The decoration occupying cell (x, y), or null. Hidden types (see `setVisibleTypes`)
   * report null so a switched-off polyhedron never teleports anyone.
   * @returns {{ type: 'polyhedron'|'smiley', mesh: THREE.Mesh, index: number } | null}
   */
  objectAt(x, y) {
    const entry = this._byCell.get(this.maze.index(x, y));
    if (!entry) return null;
    const visible = entry.type === 'polyhedron' ? this._polyGroup.visible : this._smileyGroup.visible;
    return visible ? entry : null;
  }

  /** Show/hide whole object types without rebuilding; omitted keys are left unchanged. */
  setVisibleTypes({ polyhedra, smiley } = {}) {
    if (polyhedra !== undefined) this._polyGroup.visible = !!polyhedra;
    if (smiley !== undefined) this._smileyGroup.visible = !!smiley;
  }

  get polyhedronCount() { return this._polyhedra.length; }
  get smileyCount() { return this._smileys.length; }

  /** Free geometries, materials and the smiley texture, and detach the group. */
  dispose() {
    for (const g of this._geometries.values()) g.dispose();
    this._geometries.clear();
    this._polyMaterial?.dispose();
    this._circle?.dispose();
    this._smileyMaterial?.dispose();
    this._smileyTexture?.dispose();
    this._polyMaterial = this._circle = this._smileyMaterial = this._smileyTexture = null;
    this._polyhedra.length = 0;
    this._smileys.length = 0;
    this._byCell.clear();
    this._polyGroup.clear();
    this._smileyGroup.clear();
    this.group.removeFromParent();
  }
}

/* ==================================================================== Rat */

/** Movement profile for the rat; `stepDuration` is re-derived from `objects.rat.speed` live. */
const RAT_MOVEMENT = Object.freeze({
  stepDuration: 1 / 3, turnDuration: 0.12, stepEasing: 'linear', turnEasing: 'linear',
  pauseBeforeTurn: 0, pauseAfterTurn: 0, pauseAtDeadEnd: 0, quantize: 0, headBob: 0, headBobSpeed: 2,
  manual: false, paused: false,
});
const RAT_MIN_SPEED = 0.05;
/** Two strides per cell ⇒ 4π radians of gait phase per cell. */
const RAT_STRIDE_RATE = 4 * Math.PI;
const RAT_LEG_SWING = 0.7;
const RAT_BODY_BOB = 0.006;
const RAT_TAIL_WIGGLE = 0.35;
const RAT_TAIL_IDLE = 0.08;
const RAT_PINK = new THREE.Color('#e3a3a3');
const RAT_NOSE = new THREE.Color('#d98c8c');

/**
 * Model-space layout (forward = −Z, up = +Y, floor at y = 0), in world units for `size` 1.
 * The body is one lathe: `profile` is [radius, axial] pairs from the rump (−) to the snout (+),
 * so torso, neck and head are a single seamless pear ≈ 0.22 long plus a 0.1 head.
 */
const RAT_PARTS = Object.freeze({
  body: {
    profile: [[0, -0.115], [0.035, -0.105], [0.055, -0.08], [0.063, -0.04], [0.062, 0], [0.056, 0.04],
      [0.045, 0.075], [0.038, 0.1], [0.03, 0.14], [0.018, 0.175], [0.008, 0.2], [0, 0.205]],
    segments: 14, at: [0, 0.085, 0], scale: [1, 0.92, 1],
  },
  nose: { scale: [0.012, 0.012, 0.012], at: [0, 0.08, -0.205] },
  eye: { scale: [0.011, 0.011, 0.011], at: [0.027, 0.105, -0.13] },
  ear: { scale: [0.026, 0.028, 0.008], at: [0.032, 0.125, -0.09], splay: 0.5 },
  leg: { radiusTop: 0.011, radiusBottom: 0.014, length: 0.05, hipY: 0.06, x: 0.045, frontZ: -0.06, backZ: 0.06 },
  tail: { at: [0, 0.08, 0.1], radius: 0.011, tipRadius: 0.004, segments: 16, radial: 6,
    points: [[0, 0, -0.01], [0.015, 0.005, 0.09], [-0.01, -0.015, 0.19], [0.02, -0.05, 0.3]] },
});

/** Sphere-lit-from-the-upper-left matcap, so the rat reads as shaded even with no lights. */
function drawMatcap(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size * 0.36, size * 0.32, size * 0.02, size * 0.5, size * 0.5, size * 0.5);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, '#d9d9d9');
  g.addColorStop(0.75, '#8a8a8a');
  g.addColorStop(1, '#3c3c3c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/** TubeGeometry whose radius shrinks linearly from `radius` to `tipRadius` along the curve. */
function taperedTube(curve, { segments, radial, radius, tipRadius }) {
  const geometry = new THREE.TubeGeometry(curve, segments, radius, radial, false);
  const pos = geometry.attributes.position;
  const centre = new THREE.Vector3();
  const v = new THREE.Vector3();
  const ring = radial + 1;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, centre);
    const f = 1 + (tipRadius / radius - 1) * u;
    for (let j = 0; j < ring; j++) {
      const k = i * ring + j;
      v.fromBufferAttribute(pos, k).sub(centre).multiplyScalar(f).add(centre);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  geometry.computeBoundingSphere();
  return geometry;
}

const approach = (value, target, k) => value + (target - value) * Math.min(1, k);

/**
 * The grey rat that scurries through the maze on its own `Walker` + navigator.
 * `group.rotation.y = pose.yaw` faces it along its heading (the model looks down −Z).
 * Reads `objects.rat.speed / size / color / strategy` and `lighting.mode` live.
 */
export class Rat {
  /**
   * @param {import('../maze/grid.js').Maze} maze
   * @param {object} config
   * @param {Function} rng seeded rng; give each rat its own fork (`rng.fork('rat0')`, …)
   */
  constructor(maze, config, rng) {
    this.maze = maze;
    this.config = config;
    this._rng = rng;
    this._navRng = rng.fork('rat');
    this._strategy = config.objects.rat.strategy;
    this._movement = { ...RAT_MOVEMENT };
    this.walker = new Walker({
      maze,
      navigator: createNavigator(this._strategy, maze, this._navRng),
      movement: this._movement,
      cellSize: config.maze.cellSize,
    });
    this._onFinish = () => this._relocate();
    this.walker.on('finish', this._onFinish);

    this.group = new THREE.Group();
    this.group.name = 'rat';
    this._model = new THREE.Group();
    this._model.name = 'ratModel';
    this.group.add(this._model);

    this._matcap = canvasTexture(drawMatcap(64));
    this._mode = null;
    this._color = '';
    this._bodyMaterial = null;
    this._accentMaterial = null;
    this._eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this._bodyMeshes = [];
    this._accentMeshes = [];
    this._geometries = [];
    this._legs = [];
    this._tail = null;
    this._stride = 0;
    this._gait = 0;
    this._clock = 0;

    this._syncMaterials();
    this._buildModel();
    this._spawnFarFromStart();
    this._applyPose();
  }

  /** Current cell `{x, y}` (for the HUD). */
  get cell() { return this.walker.cell; }
  get heading() { return this.walker.heading; }
  get state() { return this.walker.state; }

  /* ------------------------------------------------------------- model */

  /** Add one mesh to the model; `list` (optional) collects meshes that share a swappable material. */
  _part(geometry, material, { scale, at }, list = null) {
    const mesh = new THREE.Mesh(geometry, material);
    if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.position.set(at[0], at[1], at[2]);
    this._model.add(mesh);
    if (list) list.push(mesh);
    return mesh;
  }

  _buildModel() {
    const R = RAT_PARTS;
    // Lathe revolves about +Y; rotating by −90° about X turns that axis into −Z (snout forward).
    const bodyGeometry = new THREE.LatheGeometry(R.body.profile.map(([r, y]) => new THREE.Vector2(r, y)), R.body.segments)
      .rotateX(-Math.PI / 2);
    const sphere = new THREE.SphereGeometry(1, 12, 8);
    const leg = new THREE.CylinderGeometry(R.leg.radiusTop, R.leg.radiusBottom, R.leg.length, 8)
      .translate(0, -R.leg.length / 2, 0);
    const curve = new THREE.CatmullRomCurve3(R.tail.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const tail = taperedTube(curve, R.tail);
    this._geometries.push(bodyGeometry, sphere, leg, tail);

    const body = this._bodyMaterial;
    const accent = this._accentMaterial;
    this._part(bodyGeometry, body, R.body, this._bodyMeshes);
    this._part(sphere, accent, R.nose, this._accentMeshes);
    for (const side of [-1, 1]) {
      const mirrored = (p) => ({ scale: p.scale, at: [side * p.at[0], p.at[1], p.at[2]] });
      this._part(sphere, this._eyeMaterial, mirrored(R.eye));
      this._part(sphere, accent, mirrored(R.ear), this._accentMeshes).rotation.y = side * R.ear.splay;
      for (const z of [R.leg.frontZ, R.leg.backZ]) {
        const mesh = this._part(leg, body, { at: [side * R.leg.x, R.leg.hipY, z] }, this._bodyMeshes);
        // Diagonal pairs swing together: front-left with back-right, front-right with back-left.
        this._legs.push({ mesh, sign: side * (z < 0 ? 1 : -1) });
      }
    }
    this._tail = this._part(tail, accent, R.tail, this._accentMeshes);
  }

  /** Classic mode: matcap (shaded without lights). Lit mode: Lambert. Rebuilt only on a mode switch. */
  _syncMaterials() {
    const R = this.config.objects.rat;
    const mode = lightingMode(this.config);
    if (mode !== this._mode) {
      this._bodyMaterial?.dispose();
      this._accentMaterial?.dispose();
      const make = (params) => (mode === 'lit'
        ? new THREE.MeshLambertMaterial(params)
        : new THREE.MeshMatcapMaterial({ ...params, matcap: this._matcap }));
      this._bodyMaterial = make({ color: R.color });
      this._accentMaterial = make({ color: 0xffffff });
      this._mode = mode;
      this._color = '';
      for (const mesh of this._bodyMeshes) mesh.material = this._bodyMaterial;
      for (const mesh of this._accentMeshes) mesh.material = this._accentMaterial;
    }
    if (R.color !== this._color) {
      this._color = R.color;
      this._bodyMaterial.color.set(R.color);
      this._accentMaterial.color.copy(this._bodyMaterial.color).lerp(RAT_PINK, 0.5);
    }
  }

  /* --------------------------------------------------------- placement */

  /** Start in the far half of the maze (by walking distance from the start), never on start/finish. */
  _spawnFarFromStart() {
    const maze = this.maze;
    const dist = maze.bfs(maze.start);
    let farthest = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] > farthest) farthest = dist[i];
    const banned = new Set([maze.index(maze.start.x, maze.start.y), maze.index(maze.finish.x, maze.finish.y)]);
    const minDist = Math.ceil(farthest * 0.5);
    const target = randomCell(maze, this._rng, banned, (i) => dist[i] >= minDist)
      ?? teleportTarget(maze, this._rng, [maze.start, maze.finish]);
    this.walker.teleport(target, target.heading);
  }

  /** Reaching the finish would freeze the walker, so the rat pops up somewhere else instead. */
  _relocate() {
    const target = teleportTarget(this.maze, this._rng, [this.maze.finish, this.maze.start, this.walker.cell]);
    this.walker.teleport(target, target.heading);
  }

  /* ------------------------------------------------------------ update */

  /** Advance the rat's walker by `dt` seconds and animate the model. */
  update(dt) {
    const R = this.config.objects.rat;
    this._movement.stepDuration = 1 / Math.max(RAT_MIN_SPEED, R.speed);
    if (R.strategy !== this._strategy) {
      this._strategy = R.strategy;
      this.walker.setNavigator(createNavigator(R.strategy, this.maze, this._navRng));
    }
    this.walker.update(dt);
    this._syncMaterials();
    this._applyPose();
    this._animate(dt, Math.max(RAT_MIN_SPEED, R.speed));
  }

  _applyPose() {
    const pose = this.walker.pose;
    this.group.position.set(pose.x, 0, pose.z);
    this.group.rotation.y = pose.yaw;
    this.group.scale.setScalar(Math.max(0, this.config.objects.rat.size));
  }

  _animate(dt, speed) {
    const stepping = this.walker.state === 'stepping';
    this._clock += dt;
    this._gait = approach(this._gait, stepping ? 1 : 0, dt * 10);
    if (stepping) this._stride = wrapAngle(this._stride + dt * speed * RAT_STRIDE_RATE);
    const swing = Math.sin(this._stride) * RAT_LEG_SWING * this._gait;
    for (const leg of this._legs) leg.mesh.rotation.x = swing * leg.sign;
    this._model.position.y = Math.abs(Math.sin(this._stride)) * RAT_BODY_BOB * this._gait;
    this._tail.rotation.y = Math.sin(this._stride * 0.5 + 1) * RAT_TAIL_WIGGLE * this._gait
      + Math.sin(this._clock * 1.7) * RAT_TAIL_IDLE;
  }

  /** Free geometries, materials and the matcap texture, unhook the walker and detach the group. */
  dispose() {
    this.walker.off('finish', this._onFinish);
    for (const g of this._geometries) g.dispose();
    this._geometries.length = 0;
    this._bodyMaterial?.dispose();
    this._accentMaterial?.dispose();
    this._eyeMaterial.dispose();
    this._matcap.dispose();
    this._bodyMaterial = this._accentMaterial = null;
    this._bodyMeshes.length = 0;
    this._accentMeshes.length = 0;
    this._legs.length = 0;
    this._model.clear();
    this.group.removeFromParent();
  }
}
