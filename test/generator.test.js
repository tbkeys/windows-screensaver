import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, ALGORITHM_IDS, describeAlgorithm } from '../src/maze/generator.js';
import { OPPOSITE, N, E, S, W } from '../src/maze/grid.js';
import { ENUMS } from '../src/config/defaults.js';

const SIZES = [[1, 1], [1, 7], [7, 1], [2, 2], [5, 9], [20, 20]];
const SEEDS = ['alpha', 'beta', 42];
const START_PLACEMENTS = ENUMS.startPlacements.map(([id]) => id);
const FINISH_PLACEMENTS = ENUMS.finishPlacements.map(([id]) => id);

const same = (a, b) => a.x === b.x && a.y === b.y;

function assertBoundaryIntact(maze) {
  for (let x = 0; x < maze.width; x++) {
    assert.ok(maze.hasWall(x, 0, N), `north boundary open at x=${x}`);
    assert.ok(maze.hasWall(x, maze.height - 1, S), `south boundary open at x=${x}`);
  }
  for (let y = 0; y < maze.height; y++) {
    assert.ok(maze.hasWall(0, y, W), `west boundary open at y=${y}`);
    assert.ok(maze.hasWall(maze.width - 1, y, E), `east boundary open at y=${y}`);
  }
}

function assertPerfect(maze, label) {
  assert.equal(maze.countPassages(), maze.width * maze.height - 1, `${label}: passage count`);
  assert.ok(maze.isConnected(), `${label}: not connected`);
  assertBoundaryIntact(maze);
}

test('ALGORITHM_IDS mirrors ENUMS and describeAlgorithm returns labels', () => {
  assert.deepEqual([...ALGORITHM_IDS], ENUMS.mazeAlgorithms.map(([id]) => id));
  assert.equal(ALGORITHM_IDS.length, 11);
  assert.equal(describeAlgorithm('ellers'), "Eller's (row by row)");
  assert.equal(describeAlgorithm('backtracker'), ENUMS.mazeAlgorithms[0][1]);
  assert.equal(describeAlgorithm('nope'), 'nope');
});

test('same seed + options reproduce the identical maze; another seed differs', () => {
  for (const algorithm of ALGORITHM_IDS) {
    const opts = { width: 12, height: 9, algorithm, seed: 'repeat-me', braid: 0.2 };
    const a = generateMaze(opts);
    const b = generateMaze(opts);
    assert.deepEqual(Array.from(a.cells), Array.from(b.cells), `${algorithm}: cells differ`);
    assert.deepEqual(a.start, b.start, `${algorithm}: start differs`);
    assert.deepEqual(a.finish, b.finish, `${algorithm}: finish differs`);
    const c = generateMaze({ ...opts, seed: 'another' });
    assert.notDeepEqual(Array.from(a.cells), Array.from(c.cells), `${algorithm}: seed ignored`);
  }
});

test('every algorithm yields a perfect maze for every size and seed', () => {
  for (const algorithm of ALGORITHM_IDS) {
    for (const [width, height] of SIZES) {
      for (const seed of SEEDS) {
        const maze = generateMaze({ width, height, algorithm, seed });
        assert.equal(maze.width, width);
        assert.equal(maze.height, height);
        assertPerfect(maze, `${algorithm} ${width}×${height} seed=${seed}`);
      }
    }
  }
});

test('braid = 1 leaves zero dead ends on a 15×15 maze and keeps it connected', () => {
  for (const algorithm of ['backtracker', 'prim', 'kruskal', 'binaryTree']) {
    const maze = generateMaze({ width: 15, height: 15, algorithm, seed: 'loops', braid: 1 });
    assert.equal(maze.deadEnds().length, 0, `${algorithm}: dead ends remain`);
    assert.ok(maze.isConnected());
    assert.ok(maze.countPassages() > 15 * 15 - 1, 'braiding adds passages');
    assertBoundaryIntact(maze);
  }
});

test('braid fraction removes roughly that share of dead ends', () => {
  const base = generateMaze({ width: 15, height: 15, algorithm: 'backtracker', seed: 'half', braid: 0 });
  const half = generateMaze({ width: 15, height: 15, algorithm: 'backtracker', seed: 'half', braid: 0.5 });
  const total = base.deadEnds().length;
  const left = half.deadEnds().length;
  assert.ok(total > 4);
  assert.ok(Math.abs(left - total / 2) <= 1, `expected ≈${total / 2} dead ends, got ${left}`);
  // Braiding only removes walls: every passage of the unbraided maze still exists.
  for (let i = 0; i < base.cells.length; i++) assert.equal(half.cells[i] & ~base.cells[i], 0, 'braiding added a wall');
});

test('start and finish are never the same cell (for every placement combination)', () => {
  for (const [width, height] of SIZES.filter(([w, h]) => w * h > 1)) {
    for (const startPlacement of START_PLACEMENTS) {
      for (const finishPlacement of FINISH_PLACEMENTS) {
        for (const algorithm of ['backtracker', 'prim', 'recursiveDivision']) {
          const maze = generateMaze({ width, height, algorithm, seed: 'sf', startPlacement, finishPlacement });
          assert.ok(!same(maze.start, maze.finish), `${algorithm} ${width}×${height} ${startPlacement}/${finishPlacement}`);
          assert.ok(maze.inBounds(maze.start.x, maze.start.y));
          assert.ok(maze.inBounds(maze.finish.x, maze.finish.y));
        }
      }
    }
  }
});

test('placement semantics: deadEnd/edge/corner starts and farthest/deadEnd/opposite finishes', () => {
  for (const algorithm of ALGORITHM_IDS) {
    for (const seed of SEEDS) {
      const opts = { width: 12, height: 10, algorithm, seed };
      const deadEnd = generateMaze({ ...opts, startPlacement: 'deadEnd', finishPlacement: 'farthest' });
      assert.ok(deadEnd.isEdge(deadEnd.start.x, deadEnd.start.y), `${algorithm}: dead-end start not on edge`);
      if (deadEnd.deadEnds().some(({ x, y }) => deadEnd.isEdge(x, y))) {
        assert.ok(deadEnd.isDeadEnd(deadEnd.start.x, deadEnd.start.y), `${algorithm}: start is not a dead end`);
      }
      const far = deadEnd.farthestCellFrom(deadEnd.start);
      assert.equal(deadEnd.bfs(deadEnd.start)[deadEnd.index(deadEnd.finish.x, deadEnd.finish.y)], far.distance);

      const edge = generateMaze({ ...opts, startPlacement: 'edge', finishPlacement: 'deadEnd' });
      assert.ok(edge.isEdge(edge.start.x, edge.start.y));
      assert.ok(edge.isDeadEnd(edge.finish.x, edge.finish.y), `${algorithm}: finish is not a dead end`);

      const corner = generateMaze({ ...opts, startPlacement: 'corner', finishPlacement: 'opposite' });
      const { x, y } = corner.start;
      assert.ok((x === 0 || x === 11) && (y === 0 || y === 9), `${algorithm}: start not in a corner`);
      const f = corner.finish;
      const onOpposite = (x === 0 && f.x === 11) || (x === 11 && f.x === 0) || (y === 0 && f.y === 9) || (y === 9 && f.y === 0);
      assert.ok(onOpposite, `${algorithm}: finish ${JSON.stringify(f)} not opposite start ${JSON.stringify(corner.start)}`);

      const interior = generateMaze({ ...opts, startPlacement: 'random', finishPlacement: 'opposite', seed: `${seed}-mid` });
      assert.ok(interior.isEdge(interior.finish.x, interior.finish.y), 'opposite of an interior start is any edge');
    }
  }
});

test('start heading faces a wall when one exists, preferring the wall behind the passage', () => {
  for (const algorithm of ALGORITHM_IDS) {
    for (const [width, height] of SIZES) {
      for (const startPlacement of START_PLACEMENTS) {
        const maze = generateMaze({ width, height, algorithm, seed: 'heading', startPlacement, braid: 0.3 });
        const { x, y, heading } = maze.start;
        assert.ok(heading >= 0 && heading < 4 && Number.isInteger(heading));
        const open = maze.openDirs(x, y);
        if (open.length === 4) {
          assert.equal(heading, open[0]);
          continue;
        }
        assert.ok(maze.hasWall(x, y, heading), `${algorithm} ${width}×${height} ${startPlacement}: heading ${heading} is open`);
        if (open.length === 1) assert.equal(heading, OPPOSITE[open[0]], 'dead end: stare at the poster wall');
      }
    }
  }
});

test('recursiveDivision with roomChance > 0 stays connected and gains loops', () => {
  for (const roomChance of [0.3, 1]) {
    for (const seed of SEEDS) {
      const maze = generateMaze({ width: 16, height: 12, algorithm: 'recursiveDivision', seed, roomChance });
      assert.ok(maze.isConnected());
      assert.ok(maze.countPassages() >= 16 * 12 - 1);
      assertBoundaryIntact(maze);
    }
  }
  const rooms = generateMaze({ width: 16, height: 12, algorithm: 'recursiveDivision', seed: 'rooms', roomChance: 1 });
  assert.ok(rooms.countPassages() > 16 * 12 - 1, 'rooms create cycles');
  const small = generateMaze({ width: 1, height: 5, algorithm: 'recursiveDivision', seed: 'rooms', roomChance: 1 });
  assert.equal(small.countPassages(), 4);
});

test('growingTree mix changes the result; 0 behaves like a backtracker, 1 like Prim', () => {
  const dfs = generateMaze({ width: 20, height: 20, algorithm: 'growingTree', seed: 'mix', growingTreeMix: 0 });
  const prim = generateMaze({ width: 20, height: 20, algorithm: 'growingTree', seed: 'mix', growingTreeMix: 1 });
  assert.notDeepEqual(Array.from(dfs.cells), Array.from(prim.cells));
  assert.ok(dfs.deadEnds().length < prim.deadEnds().length, 'newest-first makes long corridors with few dead ends');
});

test('1×1 maze: start = finish = (0,0), heading faces a wall', () => {
  const maze = generateMaze({ width: 1, height: 1, algorithm: 'wilson', seed: 'tiny' });
  assert.deepEqual(maze.finish, { x: 0, y: 0 });
  assert.equal(maze.start.x, 0);
  assert.equal(maze.start.y, 0);
  assert.ok(maze.hasWall(0, 0, maze.start.heading));
});

test('invalid options throw descriptive errors', () => {
  assert.throws(() => generateMaze({ width: 5, height: 5, algorithm: 'spiral' }), /Unknown maze algorithm "spiral"/);
  assert.throws(() => generateMaze({ width: 5, height: 5, startPlacement: 'moon' }), /Unknown start placement/);
  assert.throws(() => generateMaze({ width: 5, height: 5, finishPlacement: 'moon' }), /Unknown finish placement/);
  assert.throws(() => generateMaze({ width: 0, height: 5 }), /Invalid maze size/);
});

test('defaults: omitted options fall back to backtracker / deadEnd / farthest', () => {
  const implicit = generateMaze({ width: 9, height: 9, seed: 'd' });
  const explicit = generateMaze({
    width: 9, height: 9, seed: 'd', algorithm: 'backtracker', braid: 0,
    startPlacement: 'deadEnd', finishPlacement: 'farthest', growingTreeMix: 0.5, roomChance: 0,
  });
  assert.deepEqual(Array.from(implicit.cells), Array.from(explicit.cells));
  assert.deepEqual(implicit.start, explicit.start);
  assert.deepEqual(implicit.finish, explicit.finish);
});
