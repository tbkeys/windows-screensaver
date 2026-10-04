import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Maze, DIRS, OPPOSITE, WALL_BITS, N, E, S, W,
  turnLeft, turnRight, turnBack, yawForHeading,
} from '../src/maze/grid.js';

/** 3×1 corridor: (0,0)–(1,0)–(2,0). */
function corridor3() {
  const m = new Maze(3, 1);
  m.carve(0, 0, E);
  m.carve(1, 0, E);
  return m;
}

/** 3×3 maze: top row corridor, (0,0) also opens south to (0,1) and (0,2); right column (2,1),(2,2) isolated. */
function sample3x3() {
  const m = new Maze(3, 3);
  m.carve(0, 0, E); m.carve(1, 0, E);
  m.carve(0, 0, S); m.carve(0, 1, S);
  m.carve(0, 2, E);
  m.carve(2, 1, S);
  return m;
}

test('direction tables are consistent', () => {
  assert.deepEqual(OPPOSITE, [2, 3, 0, 1]);
  assert.deepEqual(WALL_BITS, [1, 2, 4, 8]);
  for (let d = 0; d < 4; d++) {
    assert.equal(DIRS[d].dx + DIRS[OPPOSITE[d]].dx, 0);
    assert.equal(DIRS[d].dy + DIRS[OPPOSITE[d]].dy, 0);
    assert.equal(turnLeft(turnRight(d)), d);
    assert.equal(turnBack(d), OPPOSITE[d]);
    assert.equal(turnRight(d), (d + 1) % 4);
  }
  assert.ok(yawForHeading(N) === 0);
  assert.equal(yawForHeading(E), -Math.PI / 2);
});

test('constructor fills every wall and rejects invalid sizes', () => {
  const m = new Maze(4, 3);
  assert.equal(m.width, 4);
  assert.equal(m.height, 3);
  assert.equal(m.cells.length, 12);
  assert.ok(m.cells.every((c) => c === 15));
  assert.throws(() => new Maze(0, 3));
  assert.throws(() => new Maze(2, NaN));
});

test('index/inBounds/neighbor follow the row-major convention', () => {
  const m = new Maze(4, 3);
  assert.equal(m.index(1, 2), 9);
  assert.ok(m.inBounds(3, 2));
  assert.ok(!m.inBounds(4, 0));
  assert.ok(!m.inBounds(0, -1));
  assert.deepEqual(m.neighbor(1, 1, N), { x: 1, y: 0 });
  assert.deepEqual(m.neighbor(1, 1, E), { x: 2, y: 1 });
  assert.deepEqual(m.neighbor(1, 1, S), { x: 1, y: 2 });
  assert.deepEqual(m.neighbor(1, 1, W), { x: 0, y: 1 });
  assert.equal(m.neighbor(0, 0, W), null);
});

test('setWall keeps both sides of a shared wall consistent', () => {
  const m = new Maze(2, 2);
  m.setWall(0, 0, E, false);
  assert.ok(!m.hasWall(0, 0, E));
  assert.ok(!m.hasWall(1, 0, W));
  assert.ok(m.hasWall(0, 0, S) && m.hasWall(0, 0, N) && m.hasWall(0, 0, W));
  m.setWall(1, 0, W, true);
  assert.ok(m.hasWall(0, 0, E) && m.hasWall(1, 0, W));
  m.setWall(0, 1, S, false); // boundary: no neighbour to mirror, bit still clears locally
  assert.ok(!m.hasWall(0, 1, S));
});

test('carve never opens the outer boundary', () => {
  const m = new Maze(2, 2);
  assert.equal(m.carve(0, 0, N), false);
  assert.equal(m.carve(0, 0, W), false);
  assert.ok(m.hasWall(0, 0, N) && m.hasWall(0, 0, W));
  assert.equal(m.carve(0, 0, E), true);
  assert.ok(!m.hasWall(1, 0, W));
});

test('openDirs / isDeadEnd / deadEnds', () => {
  const m = sample3x3();
  assert.deepEqual(m.openDirs(0, 0), [E, S]);
  assert.deepEqual(m.openDirs(1, 0), [E, W]);
  assert.deepEqual(m.openDirs(2, 0), [W]);
  assert.deepEqual(m.openDirs(1, 1), []);
  assert.ok(m.isDeadEnd(2, 0));
  assert.ok(!m.isDeadEnd(0, 0));
  assert.ok(!m.isDeadEnd(1, 1), 'a sealed cell is not a dead end');
  assert.deepEqual(m.deadEnds(), [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }]);
  const corridor = corridor3();
  assert.deepEqual(corridor.deadEnds(), [{ x: 0, y: 0 }, { x: 2, y: 0 }]);
});

test('isEdge', () => {
  const m = new Maze(3, 3);
  assert.ok(m.isEdge(0, 1) && m.isEdge(1, 0) && m.isEdge(2, 1) && m.isEdge(1, 2));
  assert.ok(!m.isEdge(1, 1));
});

test('bfs distances and unreachable cells', () => {
  const m = sample3x3();
  const d = m.bfs({ x: 0, y: 0 });
  assert.equal(d[m.index(0, 0)], 0);
  assert.equal(d[m.index(1, 0)], 1);
  assert.equal(d[m.index(2, 0)], 2);
  assert.equal(d[m.index(0, 1)], 1);
  assert.equal(d[m.index(0, 2)], 2);
  assert.equal(d[m.index(1, 2)], 3);
  assert.equal(d[m.index(1, 1)], -1);
  assert.equal(d[m.index(2, 1)], -1);
  assert.equal(d[m.index(2, 2)], -1);
  assert.ok(!m.isConnected());
  assert.ok(corridor3().isConnected());
});

test('shortestPath is inclusive, minimal and empty when unreachable', () => {
  const m = sample3x3();
  assert.deepEqual(m.shortestPath({ x: 2, y: 0 }, { x: 1, y: 2 }), [
    { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 },
  ]);
  assert.deepEqual(m.shortestPath({ x: 1, y: 0 }, { x: 1, y: 0 }), [{ x: 1, y: 0 }]);
  assert.deepEqual(m.shortestPath({ x: 0, y: 0 }, { x: 2, y: 2 }), []);
});

test('farthestCellFrom and countPassages', () => {
  const m = sample3x3();
  assert.deepEqual(m.farthestCellFrom({ x: 2, y: 0 }), { x: 1, y: 2, distance: 5 });
  assert.equal(m.countPassages(), 6);
  assert.equal(corridor3().countPassages(), 2);
  assert.equal(new Maze(5, 5).countPassages(), 0);
});

test('clone copies cells, start and finish independently', () => {
  const m = sample3x3();
  m.start = { x: 2, y: 0, heading: E };
  m.finish = { x: 1, y: 2 };
  const c = m.clone();
  assert.deepEqual(Array.from(c.cells), Array.from(m.cells));
  assert.deepEqual(c.start, m.start);
  assert.deepEqual(c.finish, m.finish);
  c.carve(1, 1, E);
  c.start.x = 0;
  assert.ok(m.hasWall(1, 1, E));
  assert.equal(m.start.x, 2);
});

test('toString has 2h+1 lines of 4w+1 characters and marks S / F', () => {
  const m = sample3x3();
  m.start = { x: 2, y: 0, heading: W };
  m.finish = { x: 1, y: 2 };
  const lines = m.toString().split('\n');
  assert.equal(lines.length, 2 * m.height + 1);
  for (const line of lines) assert.equal(line.length, 4 * m.width + 1);
  assert.equal(lines[0], '+---+---+---+');
  assert.equal(lines[1], '|         S |');
  assert.ok(lines[5].includes(' F '));
  assert.equal(lines[2], '+   +---+---+');
});
