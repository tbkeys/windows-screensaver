/**
 * Maze generation for the Win95 3D Maze recreation.
 *
 * `generateMaze(opts)` carves a perfect maze (a spanning tree over the cells) with one
 * of eleven algorithms, optionally braids it (opens dead ends into loops), then places
 * the start/finish cells and the initial camera heading. Every random choice comes
 * from `createRng(seed)` or a labelled fork of it, so identical seed + options give
 * the identical maze in every browser and in Node. Outer boundary walls are never
 * removed by any stage.
 */
import { Maze, DIRS, OPPOSITE, N, E, S } from './grid.js';
import { createRng } from './rng.js';
import { ENUMS } from '../config/defaults.js';

/** Stable algorithm ids, in the order they appear in `ENUMS.mazeAlgorithms`. */
export const ALGORITHM_IDS = Object.freeze(ENUMS.mazeAlgorithms.map(([id]) => id));

/** Human-readable label for an algorithm id (falls back to the id itself). */
export function describeAlgorithm(id) {
  const entry = ENUMS.mazeAlgorithms.find(([key]) => key === id);
  return entry ? entry[1] : String(id);
}

/**
 * Generate a maze.
 * @param {object} opts
 * @param {number} opts.width            cells along world +X (≥ 1)
 * @param {number} opts.height           cells along world +Z (≥ 1)
 * @param {string} [opts.algorithm='backtracker']  one of `ALGORITHM_IDS`
 * @param {string|number} [opts.seed='']
 * @param {number} [opts.braid=0]        fraction (0..1) of dead ends opened into loops
 * @param {string} [opts.startPlacement='deadEnd']   'deadEnd' | 'edge' | 'corner' | 'random'
 * @param {string} [opts.finishPlacement='farthest'] 'farthest' | 'deadEnd' | 'opposite' | 'random'
 * @param {number} [opts.growingTreeMix=0.5] growingTree only: probability of expanding a random
 *   active cell instead of the newest (0 ≈ backtracker, 1 ≈ Prim)
 * @param {number} [opts.roomChance=0]   recursiveDivision only: chance to leave a chamber
 *   of at most 3×3 cells undivided (creates rooms, i.e. loops)
 * @returns {Maze} maze with `start {x, y, heading}` and `finish {x, y}` set
 */
export function generateMaze(opts = {}) {
  const algorithm = opts.algorithm ?? 'backtracker';
  const carve = CARVERS[algorithm];
  if (!carve) {
    throw new Error(`Unknown maze algorithm "${algorithm}" (expected one of ${ALGORITHM_IDS.join(', ')})`);
  }
  const maze = new Maze(Math.floor(Number(opts.width)), Math.floor(Number(opts.height)));
  const rng = createRng(opts.seed ?? '');
  carve(maze, rng, {
    growingTreeMix: clamp01(opts.growingTreeMix, 0.5),
    roomChance: clamp01(opts.roomChance, 0),
  });
  braidMaze(maze, rng.fork('braid'), clamp01(opts.braid, 0));

  const start = chooseStart(maze, rng.fork('start'), opts.startPlacement ?? 'deadEnd');
  const finish = chooseFinish(maze, rng.fork('finish'), opts.finishPlacement ?? 'farthest', start);
  maze.start = { x: start.x, y: start.y, heading: chooseHeading(maze, start) };
  maze.finish = { x: finish.x, y: finish.y };
  return maze;
}

/* ------------------------------------------------------------------ helpers */

const clamp01 = (v, fallback) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** Index of the neighbour of cell index `i` in direction `d` (caller guarantees it is in bounds). */
const stepIndex = (maze, i, d) => i + DIRS[d].dy * maze.width + DIRS[d].dx;

const cellOf = (maze, i) => ({ x: i % maze.width, y: (i / maze.width) | 0 });

/** True when (x, y) has no wall in `d` and the neighbour is inside the maze. */
const canStep = (maze, x, y, d) => !maze.hasWall(x, y, d) && maze.inBounds(x + DIRS[d].dx, y + DIRS[d].dy);

/**
 * Write into `out` the directions from (x, y) whose neighbour is in bounds and, when
 * `marks` is given, has `marks[index] === wanted`. Returns how many were written.
 * `out` is a reusable 4-slot array so the hot generation loops do not allocate.
 */
function neighbourDirs(maze, x, y, marks, wanted, out) {
  let n = 0;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d].dx, ny = y + DIRS[d].dy;
    if (!maze.inBounds(nx, ny)) continue;
    if (marks && marks[maze.index(nx, ny)] !== wanted) continue;
    out[n++] = d;
  }
  return n;
}

/* --------------------------------------------------------------- algorithms */

/** Iterative randomised depth-first search: long, twisty corridors. */
function carveBacktracker(maze, rng) {
  const total = maze.width * maze.height;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  const dirs = [0, 0, 0, 0];
  let top = 0;
  stack[top++] = rng.int(total);
  visited[stack[0]] = 1;
  while (top > 0) {
    const i = stack[top - 1];
    const x = i % maze.width, y = (i / maze.width) | 0;
    const n = neighbourDirs(maze, x, y, visited, 0, dirs);
    if (n === 0) { top--; continue; }
    const d = dirs[rng.int(n)];
    maze.carve(x, y, d);
    const j = stepIndex(maze, i, d);
    visited[j] = 1;
    stack[top++] = j;
  }
}

/** Randomised Prim (frontier-cell variant): many short dead ends. */
function carvePrim(maze, rng) {
  const total = maze.width * maze.height;
  const state = new Uint8Array(total); // 0 = outside, 1 = frontier, 2 = in tree
  const frontier = [];
  const dirs = [0, 0, 0, 0];
  const absorb = (i) => {
    state[i] = 2;
    const n = neighbourDirs(maze, i % maze.width, (i / maze.width) | 0, state, 0, dirs);
    for (let k = 0; k < n; k++) {
      const j = stepIndex(maze, i, dirs[k]);
      state[j] = 1;
      frontier.push(j);
    }
  };
  absorb(rng.int(total));
  while (frontier.length > 0) {
    const k = rng.int(frontier.length);
    const i = frontier[k];
    frontier[k] = frontier[frontier.length - 1];
    frontier.pop();
    const x = i % maze.width, y = (i / maze.width) | 0;
    const n = neighbourDirs(maze, x, y, state, 2, dirs);
    maze.carve(x, y, dirs[rng.int(n)]);
    absorb(i);
  }
}

/** Randomised Kruskal with union-find: balanced, unbiased texture. */
function carveKruskal(maze, rng) {
  const { width, height } = maze;
  const total = width * height;
  // Edge encoding: cellIndex * 2 + (0 = east wall, 1 = south wall).
  const edges = new Int32Array(2 * total - width - height);
  let count = 0;
  for (let i = 0; i < total; i++) {
    if (i % width + 1 < width) edges[count++] = i * 2;
    if (i + width < total) edges[count++] = i * 2 + 1;
  }
  rng.shuffle(edges);
  const parent = new Int32Array(total);
  for (let i = 0; i < total; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k];
    const i = e >> 1;
    const south = (e & 1) === 1;
    const ra = find(i), rb = find(south ? i + width : i + 1);
    if (ra === rb) continue;
    parent[ra] = rb;
    maze.carve(i % width, (i / width) | 0, south ? S : E);
  }
}

/** Wilson's loop-erased random walks: a uniformly random spanning tree. */
function carveWilson(maze, rng) {
  const total = maze.width * maze.height;
  const inTree = new Uint8Array(total);
  const exitDir = new Int8Array(total).fill(-1);
  const order = new Int32Array(total);
  for (let i = 0; i < total; i++) order[i] = i;
  rng.shuffle(order);
  inTree[order[0]] = 1;
  const dirs = [0, 0, 0, 0];
  for (let k = 1; k < total; k++) {
    const origin = order[k];
    if (inTree[origin]) continue;
    // Random walk until the tree is hit; overwriting exitDir erases loops implicitly.
    for (let i = origin; !inTree[i];) {
      const n = neighbourDirs(maze, i % maze.width, (i / maze.width) | 0, null, 0, dirs);
      const d = dirs[rng.int(n)];
      exitDir[i] = d;
      i = stepIndex(maze, i, d);
    }
    // Retrace the loop-erased path and carve it into the tree.
    for (let i = origin; !inTree[i];) {
      const d = exitDir[i];
      maze.carve(i % maze.width, (i / maze.width) | 0, d);
      inTree[i] = 1;
      i = stepIndex(maze, i, d);
    }
  }
}

/** Aldous–Broder: plain random walk, carving whenever it enters an unvisited cell. */
function carveAldousBroder(maze, rng) {
  const total = maze.width * maze.height;
  const visited = new Uint8Array(total);
  const dirs = [0, 0, 0, 0];
  let i = rng.int(total);
  visited[i] = 1;
  let remaining = total - 1;
  while (remaining > 0) {
    const x = i % maze.width, y = (i / maze.width) | 0;
    const n = neighbourDirs(maze, x, y, null, 0, dirs);
    const d = dirs[rng.int(n)];
    const j = stepIndex(maze, i, d);
    if (!visited[j]) {
      maze.carve(x, y, d);
      visited[j] = 1;
      remaining--;
    }
    i = j;
  }
}

/** Hunt-and-Kill: random walks, then a row scan for the next cell adjacent to the tree. */
function carveHuntAndKill(maze, rng) {
  const { width, height } = maze;
  const visited = new Uint8Array(width * height);
  const dirs = [0, 0, 0, 0];
  let i = rng.int(width * height);
  visited[i] = 1;
  let huntRow = 0; // every row above this one is fully visited
  for (;;) {
    // Kill: walk into unvisited neighbours until stuck.
    let x = i % width, y = (i / width) | 0;
    let n;
    while ((n = neighbourDirs(maze, x, y, visited, 0, dirs)) > 0) {
      const d = dirs[rng.int(n)];
      maze.carve(x, y, d);
      x += DIRS[d].dx;
      y += DIRS[d].dy;
      visited[maze.index(x, y)] = 1;
    }
    // Hunt: first unvisited cell (row-major) that touches a visited one.
    i = -1;
    let firstIncomplete = -1;
    for (let r = huntRow; r < height && i < 0; r++) {
      for (let hx = 0; hx < width; hx++) {
        const j = maze.index(hx, r);
        if (visited[j]) continue;
        if (firstIncomplete < 0) firstIncomplete = r;
        const m = neighbourDirs(maze, hx, r, visited, 1, dirs);
        if (m === 0) continue;
        maze.carve(hx, r, dirs[rng.int(m)]);
        visited[j] = 1;
        i = j;
        break;
      }
    }
    if (i < 0) return;
    huntRow = firstIncomplete;
  }
}

/** Growing tree: `growingTreeMix` blends newest-cell (DFS) and random-cell (Prim) selection. */
function carveGrowingTree(maze, rng, { growingTreeMix }) {
  const total = maze.width * maze.height;
  const visited = new Uint8Array(total);
  const active = [rng.int(total)];
  visited[active[0]] = 1;
  const dirs = [0, 0, 0, 0];
  while (active.length > 0) {
    const k = rng.chance(growingTreeMix) ? rng.int(active.length) : active.length - 1;
    const i = active[k];
    const x = i % maze.width, y = (i / maze.width) | 0;
    const n = neighbourDirs(maze, x, y, visited, 0, dirs);
    if (n === 0) { active.splice(k, 1); continue; }
    const d = dirs[rng.int(n)];
    maze.carve(x, y, d);
    const j = stepIndex(maze, i, d);
    visited[j] = 1;
    active.push(j);
  }
}

/** Binary tree: each cell links north or east, giving a strong diagonal bias. */
function carveBinaryTree(maze, rng) {
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      const canNorth = y > 0, canEast = x + 1 < maze.width;
      if (canNorth && canEast) maze.carve(x, y, rng.chance(0.5) ? N : E);
      else if (canNorth) maze.carve(x, y, N);
      else if (canEast) maze.carve(x, y, E);
    }
  }
}

/** Sidewinder: horizontal runs, each closed with one random link north. */
function carveSidewinder(maze, rng) {
  for (let y = 0; y < maze.height; y++) {
    let runStart = 0;
    for (let x = 0; x < maze.width; x++) {
      const atEnd = x + 1 === maze.width;
      const closeRun = y > 0 && (atEnd || rng.chance(0.5));
      if (closeRun) {
        maze.carve(runStart + rng.int(x - runStart + 1), y, N);
        runStart = x + 1;
      } else if (!atEnd) {
        maze.carve(x, y, E);
      }
    }
  }
}

/**
 * Recursive division: clear every inner wall, then split chambers with a wall that has
 * a single gap. Each split keeps the two halves joined by exactly one passage, so the
 * result is a perfect maze unless `roomChance` leaves small chambers open.
 */
function carveRecursiveDivision(maze, rng, { roomChance }) {
  const { width, height } = maze;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x + 1 < width) maze.carve(x, y, E);
      if (y + 1 < height) maze.carve(x, y, S);
    }
  }
  const chambers = [{ x: 0, y: 0, w: width, h: height }];
  while (chambers.length > 0) {
    const { x, y, w, h } = chambers.pop();
    if (w < 2 || h < 2) continue; // a 1-wide strip has no inner wall to place
    if (roomChance > 0 && w <= 3 && h <= 3 && rng.chance(roomChance)) continue;
    const horizontal = w === h ? rng.chance(0.5) : w < h;
    if (horizontal) {
      const wy = y + 1 + rng.int(h - 1); // wall between rows wy-1 and wy
      const gap = x + rng.int(w);
      for (let c = x; c < x + w; c++) if (c !== gap) maze.setWall(c, wy - 1, S, true);
      chambers.push({ x, y, w, h: wy - y }, { x, y: wy, w, h: y + h - wy });
    } else {
      const wx = x + 1 + rng.int(w - 1); // wall between columns wx-1 and wx
      const gap = y + rng.int(h);
      for (let r = y; r < y + h; r++) if (r !== gap) maze.setWall(wx - 1, r, E, true);
      chambers.push({ x, y, w: wx - x, h }, { x: wx, y, w: x + w - wx, h });
    }
  }
}

/** Eller's algorithm: row by row with set merging; the last row joins every set. */
function carveEllers(maze, rng) {
  const { width, height } = maze;
  let sets = new Int32Array(width);
  let below = new Int32Array(width);
  let nextSet = 1;
  for (let y = 0; y < height; y++) {
    const lastRow = y + 1 === height;
    for (let x = 0; x < width; x++) if (sets[x] === 0) sets[x] = nextSet++;
    // Horizontal joins between different sets (forced on the last row to connect everything).
    for (let x = 0; x + 1 < width; x++) {
      const a = sets[x], b = sets[x + 1];
      if (a === b || !(lastRow || rng.chance(0.5))) continue;
      maze.carve(x, y, E);
      for (let k = 0; k < width; k++) if (sets[k] === b) sets[k] = a;
    }
    if (lastRow) break;
    // Vertical joins: every set sends at least one passage down to the next row.
    below.fill(0);
    const members = new Map();
    for (let x = 0; x < width; x++) {
      const list = members.get(sets[x]);
      if (list) list.push(x); else members.set(sets[x], [x]);
    }
    for (const [id, cols] of members) {
      let carved = false;
      for (const x of cols) {
        if (!rng.chance(0.5)) continue;
        maze.carve(x, y, S);
        below[x] = id;
        carved = true;
      }
      if (!carved) {
        const x = cols[rng.int(cols.length)];
        maze.carve(x, y, S);
        below[x] = id;
      }
    }
    [sets, below] = [below, sets];
  }
}

const CARVERS = {
  backtracker: carveBacktracker,
  prim: carvePrim,
  kruskal: carveKruskal,
  wilson: carveWilson,
  aldousBroder: carveAldousBroder,
  huntAndKill: carveHuntAndKill,
  growingTree: carveGrowingTree,
  binaryTree: carveBinaryTree,
  sidewinder: carveSidewinder,
  recursiveDivision: carveRecursiveDivision,
  ellers: carveEllers,
};

/* ------------------------------------------------------------------ braiding */

/** Dead ends whose closed neighbour is farther than this through the passages are all equally good. */
const BRAID_SEARCH_RADIUS = 12;

/**
 * Open `fraction` of the dead ends into loops. A chosen dead end is joined to the
 * closed, in-bounds neighbour that is farthest away through the existing passages
 * (measured up to `BRAID_SEARCH_RADIUS` steps), so the new loop is a long detour
 * rather than a trivial lap around one pillar. Opening one dead end into another
 * removes both at once; `fraction === 1` leaves no dead end that has an inner wall
 * to open.
 */
function braidMaze(maze, rng, fraction) {
  if (fraction <= 0) return;
  const ends = rng.shuffle(maze.deadEnds());
  let remaining = Math.round(fraction * ends.length);
  const near = createLocalDistances(maze);
  const candidates = [0, 0, 0, 0];
  for (const { x, y } of ends) {
    if (remaining <= 0) break;
    if (!maze.isDeadEnd(x, y)) continue; // already opened by an earlier carve
    const dist = near.measure(maze.index(x, y), BRAID_SEARCH_RADIUS);
    let n = 0, best = -1;
    for (let d = 0; d < 4; d++) {
      if (!maze.hasWall(x, y, d)) continue;
      const nx = x + DIRS[d].dx, ny = y + DIRS[d].dy;
      if (!maze.inBounds(nx, ny)) continue;
      const far = dist(maze.index(nx, ny));
      if (far > best) { best = far; n = 0; }
      if (far === best) candidates[n++] = d;
    }
    if (n === 0) continue; // only boundary walls around this dead end
    const d = candidates[rng.int(n)];
    const nb = maze.neighbor(x, y, d);
    remaining -= maze.isDeadEnd(nb.x, nb.y) ? 2 : 1;
    maze.carve(x, y, d);
  }
}

/**
 * Reusable radius-bounded BFS. `measure(origin, radius)` explores the passages up to
 * `radius` steps and returns `dist(index)`: the step count, or `radius + 1` for cells
 * not reached. Buffers are shared between calls (stamped, never cleared), so braiding
 * a large maze does not allocate per dead end.
 */
function createLocalDistances(maze) {
  const total = maze.width * maze.height;
  const dist = new Int32Array(total);
  const stamp = new Int32Array(total);
  const queue = new Int32Array(total);
  let generation = 0;
  return {
    measure(origin, radius) {
      generation++;
      let head = 0, tail = 0;
      queue[tail++] = origin;
      stamp[origin] = generation;
      dist[origin] = 0;
      while (head < tail) {
        const i = queue[head++];
        const steps = dist[i] + 1;
        if (steps > radius) break;
        const x = i % maze.width, y = (i / maze.width) | 0;
        for (let d = 0; d < 4; d++) {
          if (!canStep(maze, x, y, d)) continue;
          const j = stepIndex(maze, i, d);
          if (stamp[j] === generation) continue;
          stamp[j] = generation;
          dist[j] = steps;
          queue[tail++] = j;
        }
      }
      return (i) => (stamp[i] === generation ? dist[i] : radius + 1);
    },
  };
}

/* -------------------------------------------------------------- placement */

function edgeCells(maze) {
  const out = [];
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) if (maze.isEdge(x, y)) out.push({ x, y });
  }
  return out;
}

function cornerCells(maze) {
  const xs = maze.width > 1 ? [0, maze.width - 1] : [0];
  const ys = maze.height > 1 ? [0, maze.height - 1] : [0];
  const out = [];
  for (const y of ys) for (const x of xs) out.push({ x, y });
  return out;
}

function chooseStart(maze, rng, placement) {
  switch (placement) {
    case 'deadEnd': {
      const edgeEnds = maze.deadEnds().filter(({ x, y }) => maze.isEdge(x, y));
      return rng.pick(edgeEnds.length > 0 ? edgeEnds : edgeCells(maze));
    }
    case 'edge':
      return rng.pick(edgeCells(maze));
    case 'corner':
      return rng.pick(cornerCells(maze));
    case 'random':
      return { x: rng.int(maze.width), y: rng.int(maze.height) };
    default:
      throw new Error(`Unknown start placement "${placement}"`);
  }
}

/** Cell with the greatest BFS distance among those passing `accept(index)`, or null. */
function farthestCell(maze, dist, accept) {
  let best = -1, bestIndex = -1;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] > best && accept(i)) { best = dist[i]; bestIndex = i; }
  }
  return bestIndex < 0 ? null : cellOf(maze, bestIndex);
}

/** Mask of edge cells lying on the edge(s) opposite the start; every edge when the start is interior. */
function oppositeEdgeMask(maze, start) {
  const { width, height } = maze;
  const onN = start.y === 0, onE = start.x === width - 1, onS = start.y === height - 1, onW = start.x === 0;
  const interior = !(onN || onE || onS || onW);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!maze.isEdge(x, y)) continue;
      const opposite = (onN && y === height - 1) || (onS && y === 0) || (onW && x === width - 1) || (onE && x === 0);
      if (interior || opposite) mask[maze.index(x, y)] = 1;
    }
  }
  return mask;
}

function chooseFinish(maze, rng, placement, start) {
  const total = maze.width * maze.height;
  const startIndex = maze.index(start.x, start.y);
  if (total === 1) return { x: start.x, y: start.y }; // nowhere else to go
  const randomOther = () => {
    const i = rng.int(total - 1);
    return cellOf(maze, i >= startIndex ? i + 1 : i);
  };
  const dist = maze.bfs(start);
  const farthest = () => farthestCell(maze, dist, (i) => i !== startIndex) ?? randomOther();
  switch (placement) {
    case 'farthest':
      return farthest();
    case 'deadEnd': {
      const isEnd = new Uint8Array(total);
      for (const { x, y } of maze.deadEnds()) isEnd[maze.index(x, y)] = 1;
      return farthestCell(maze, dist, (i) => i !== startIndex && isEnd[i] === 1) ?? farthest();
    }
    case 'opposite': {
      const mask = oppositeEdgeMask(maze, start);
      return farthestCell(maze, dist, (i) => i !== startIndex && mask[i] === 1) ?? farthest();
    }
    case 'random':
      return randomOther();
    default:
      throw new Error(`Unknown finish placement "${placement}"`);
  }
}

/**
 * Initial camera heading: a closed wall of the start cell (that wall receives the START
 * poster), preferring the wall directly opposite an open passage so the walker begins
 * by staring at the poster and turning around. With no walls at all, the first open dir.
 */
function chooseHeading(maze, { x, y }) {
  let firstWall = -1;
  for (let d = 0; d < 4; d++) {
    if (!maze.hasWall(x, y, d)) continue;
    if (firstWall < 0) firstWall = d;
    const behind = OPPOSITE[d];
    if (!maze.hasWall(x, y, behind) && maze.inBounds(x + DIRS[behind].dx, y + DIRS[behind].dy)) return d;
  }
  return firstWall >= 0 ? firstWall : maze.openDirs(x, y)[0];
}
