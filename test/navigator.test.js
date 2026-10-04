import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavigator, STRATEGY_IDS, describeStrategy } from '../src/maze/navigator.js';
import { generateMaze } from '../src/maze/generator.js';
import { createRng } from '../src/maze/rng.js';
import { Maze, DIRS, E, S, turnLeft, turnRight, turnBack } from '../src/maze/grid.js';
import { ENUMS } from '../src/config/defaults.js';

const ACTIONS = new Set(['forward', 'left', 'right', 'back']);

/**
 * Tiny walker: turns change heading, 'forward' moves one cell. Asserts that 'forward'
 * is only ever issued toward an open, in-bounds neighbour. Stops at the finish unless
 * `stopAtFinish` is false.
 */
function simulate(maze, nav, { maxDecisions, stopAtFinish = true, onDecision } = {}) {
  let { x, y, heading } = maze.start;
  let steps = 0, decisions = 0;
  const atFinish = () => x === maze.finish.x && y === maze.finish.y;
  while (decisions < maxDecisions && !(stopAtFinish && atFinish())) {
    const action = nav.next({ x, y }, heading);
    decisions++;
    assert.ok(ACTIONS.has(action), `invalid action ${action}`);
    if (onDecision) onDecision({ x, y, heading, action });
    if (action === 'left') heading = turnLeft(heading);
    else if (action === 'right') heading = turnRight(heading);
    else if (action === 'back') heading = turnBack(heading);
    else {
      assert.ok(!maze.hasWall(x, y, heading), `forward into a wall at (${x},${y}) heading ${heading}`);
      const nx = x + DIRS[heading].dx, ny = y + DIRS[heading].dy;
      assert.ok(maze.inBounds(nx, ny), `forward out of bounds at (${x},${y})`);
      x = nx; y = ny; steps++;
    }
  }
  return { reached: atFinish(), steps, decisions, x, y, heading };
}

const SIX_MAZES = [
  { width: 6, height: 6, algorithm: 'backtracker', seed: 'one' },
  { width: 11, height: 7, algorithm: 'prim', seed: 'two' },
  { width: 9, height: 9, algorithm: 'kruskal', seed: 'three', startPlacement: 'corner', finishPlacement: 'deadEnd' },
  { width: 14, height: 10, algorithm: 'huntAndKill', seed: 'four', startPlacement: 'random', finishPlacement: 'random' },
  { width: 1, height: 9, algorithm: 'sidewinder', seed: 'five' },
  { width: 20, height: 20, algorithm: 'ellers', seed: 'six', startPlacement: 'edge', finishPlacement: 'opposite' },
];

test('STRATEGY_IDS mirrors ENUMS; unknown strategies throw', () => {
  assert.deepEqual([...STRATEGY_IDS], ENUMS.strategies.map(([id]) => id));
  assert.equal(describeStrategy('leftHand'), ENUMS.strategies[0][1]);
  assert.equal(describeStrategy('x'), 'x');
  const maze = generateMaze({ width: 3, height: 3, seed: 's' });
  assert.throws(() => createNavigator('teleport', maze, createRng('r')), /Unknown navigation strategy/);
  const nav = createNavigator('leftHand', maze, createRng('r'));
  assert.equal(nav.id, 'leftHand');
  assert.equal(typeof nav.next, 'function');
  assert.equal(typeof nav.reset, 'function');
});

test('leftHand and rightHand reach the finish within 4·w·h decisions on perfect mazes', () => {
  for (const opts of SIX_MAZES) {
    const maze = generateMaze(opts);
    const budget = 4 * maze.width * maze.height;
    for (const strategy of ['leftHand', 'rightHand']) {
      const nav = createNavigator(strategy, maze, createRng('wall'));
      const result = simulate(maze, nav, { maxDecisions: budget });
      assert.ok(result.reached, `${strategy} did not reach the finish on ${opts.algorithm} ${opts.width}×${opts.height}`);
      assert.ok(result.steps <= budget);
      assert.ok(result.decisions <= budget, 'pure wall following, no solver fallback needed');
    }
  }
});

test('wall followers hug their wall: turn toward it when open, else straight, else away, else back', () => {
  const maze = new Maze(3, 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) { if (x < 2) maze.carve(x, y, E); if (y < 2) maze.carve(x, y, S); }
  maze.finish = { x: 2, y: 2 };
  const left = createNavigator('leftHand', maze, createRng('l'));
  const right = createNavigator('rightHand', maze, createRng('r'));
  // Centre cell, heading north: every side open.
  assert.equal(left.next({ x: 1, y: 1 }, 0), 'left');
  assert.equal(right.next({ x: 1, y: 1 }, 0), 'right');
  // Top-left corner heading north: left (W) closed, ahead (N) closed → left-hand turns right (E).
  assert.equal(left.next({ x: 0, y: 0 }, 0), 'right');
  // Same spot heading west: right-hand has N closed, W closed → turns left (S).
  assert.equal(right.next({ x: 0, y: 0 }, 3), 'left');
  // Corridor: heading east in the middle of the top row with left (N) closed → forward.
  assert.equal(left.next({ x: 1, y: 0 }, 1), 'forward');
  // Dead end.
  const tube = new Maze(2, 1);
  tube.carve(0, 0, E);
  tube.finish = { x: 1, y: 0 };
  assert.equal(createNavigator('leftHand', tube, createRng('t')).next({ x: 1, y: 0 }, 1), 'back');
  assert.equal(createNavigator('rightHand', tube, createRng('t')).next({ x: 1, y: 0 }, 1), 'back');
});

test('wall followers fall back to the solver after 4·w·h decisions (braided maze / open room)', () => {
  // Open 5×5 room with the finish in the centre: a wall follower laps the perimeter forever.
  const room = new Maze(5, 5);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) { if (x < 4) room.carve(x, y, E); if (y < 4) room.carve(x, y, S); }
  room.start = { x: 0, y: 0, heading: 0 };
  room.finish = { x: 2, y: 2 };
  const limit = 4 * 25;
  const nav = createNavigator('leftHand', room, createRng('room'));
  const result = simulate(room, nav, { maxDecisions: limit + 20 });
  assert.ok(result.reached, 'solver fallback should reach the centre');
  assert.ok(result.decisions > limit, 'the follower alone never arrives');

  // Fully braided generated maze.
  const maze = generateMaze({ width: 15, height: 15, algorithm: 'backtracker', seed: 'braided', braid: 1 });
  const budget = 4 * 15 * 15;
  const pathLength = maze.shortestPath(maze.start, maze.finish).length;
  for (const strategy of ['leftHand', 'rightHand']) {
    const r = simulate(maze, createNavigator(strategy, maze, createRng('b')), { maxDecisions: budget + 3 * pathLength });
    assert.ok(r.reached, `${strategy} never reached the finish of the braided maze`);
  }
});

test('reset() restarts the wall follower decision counter', () => {
  const room = new Maze(4, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { if (x < 3) room.carve(x, y, E); if (y < 3) room.carve(x, y, S); }
  room.finish = { x: 1, y: 1 };
  const nav = createNavigator('leftHand', room, createRng('reset'));
  // Top-left corner heading north: W and N closed → the rule says turn right (E). Burn the whole budget there.
  for (let i = 0; i < 4 * 16; i++) assert.equal(nav.next({ x: 0, y: 0 }, 0), 'right');
  // Past the limit the solver answers: from (3,3) heading north the shortest path to (1,1) starts northward.
  assert.equal(nav.next({ x: 3, y: 3 }, 0), 'forward');
  nav.reset();
  // Left-hand rule again: from (3,3) heading north the left side (W) is open.
  assert.equal(nav.next({ x: 3, y: 3 }, 0), 'left');
});

test('solver reaches the finish in exactly shortestPath.length − 1 forward moves', () => {
  for (const opts of SIX_MAZES) {
    const maze = generateMaze(opts);
    const expected = maze.shortestPath(maze.start, maze.finish).length - 1;
    const nav = createNavigator('solver', maze, createRng('solve'));
    const result = simulate(maze, nav, { maxDecisions: 10 * maze.width * maze.height });
    assert.ok(result.reached, `solver did not reach the finish on ${opts.algorithm}`);
    assert.equal(result.steps, expected, `${opts.algorithm}: took ${result.steps} steps, shortest is ${expected}`);
  }
  // Braided maze with several routes: still optimal.
  const braided = generateMaze({ width: 12, height: 12, algorithm: 'kruskal', seed: 'loops', braid: 0.6 });
  const result = simulate(braided, createNavigator('solver', braided, createRng('s')), { maxDecisions: 2000 });
  assert.ok(result.reached);
  assert.equal(result.steps, braided.shortestPath(braided.start, braided.finish).length - 1);
});

test('solver recovers after a teleport (recomputes when off the cached path)', () => {
  const maze = generateMaze({ width: 10, height: 10, algorithm: 'backtracker', seed: 'tp' });
  const nav = createNavigator('solver', maze, createRng('tp'));
  simulate(maze, nav, { maxDecisions: 6 });
  // Teleport to the farthest cell from the finish and keep solving from there.
  const far = maze.farthestCellFrom(maze.finish);
  const moved = maze.clone();
  moved.start = { x: far.x, y: far.y, heading: 0 };
  const expected = maze.shortestPath(far, maze.finish).length - 1;
  const result = simulate(moved, nav, { maxDecisions: 1000 });
  assert.ok(result.reached);
  assert.equal(result.steps, expected);
});

test('random / explorer / drunk never step into a wall over 2000 decisions and keep exploring', () => {
  for (const strategy of ['random', 'explorer', 'drunk']) {
    for (const opts of SIX_MAZES) {
      const maze = generateMaze({ ...opts, braid: 0.25 });
      const nav = createNavigator(strategy, maze, createRng(strategy));
      const result = simulate(maze, nav, { maxDecisions: 2000, stopAtFinish: false });
      assert.equal(result.decisions, 2000);
      assert.ok(result.steps >= 2000 / 3, `${strategy} on ${opts.algorithm}: only ${result.steps} steps in 2000 decisions`);
    }
  }
});

test('random avoids reversing unless the cell is a dead end; drunk does reverse sometimes', () => {
  const maze = generateMaze({ width: 12, height: 12, algorithm: 'prim', seed: 'rev' });
  let reversalsInCorridors = 0;
  simulate(maze, createNavigator('random', maze, createRng('rev')), {
    maxDecisions: 3000, stopAtFinish: false,
    onDecision: ({ x, y, action }) => {
      if (action === 'back' && maze.openDirs(x, y).length > 1) reversalsInCorridors++;
    },
  });
  assert.equal(reversalsInCorridors, 0);

  let drunkReversals = 0;
  simulate(maze, createNavigator('drunk', maze, createRng('rev')), {
    maxDecisions: 3000, stopAtFinish: false,
    onDecision: ({ x, y, action }) => {
      if (action === 'back' && maze.openDirs(x, y).length > 1) drunkReversals++;
    },
  });
  assert.ok(drunkReversals > 0);
});

test('a committed choice is not re-rolled while turning: at most one turn precedes each step', () => {
  const maze = generateMaze({ width: 10, height: 10, algorithm: 'kruskal', seed: 'commit', braid: 0.5 });
  for (const strategy of ['random', 'explorer', 'drunk', 'solver']) {
    let turnsSinceStep = 0;
    simulate(maze, createNavigator(strategy, maze, createRng('c')), {
      maxDecisions: 1500, stopAtFinish: false,
      onDecision: ({ action }) => {
        if (action === 'forward') turnsSinceStep = 0;
        else assert.ok(++turnsSinceStep <= 1, `${strategy}: turned twice in a row`);
      },
    });
  }
});

test('explorer visits every cell of a maze (prefers unvisited neighbours)', () => {
  for (const opts of SIX_MAZES.slice(0, 4)) {
    const maze = generateMaze(opts);
    const total = maze.width * maze.height;
    const seen = new Uint8Array(total);
    seen[maze.index(maze.start.x, maze.start.y)] = 1;
    let visited = 1;
    simulate(maze, createNavigator('explorer', maze, createRng('explore')), {
      maxDecisions: 12 * total, stopAtFinish: false,
      onDecision: ({ x, y, heading, action }) => {
        if (action !== 'forward') return;
        const i = maze.index(x + DIRS[heading].dx, y + DIRS[heading].dy);
        if (!seen[i]) { seen[i] = 1; visited++; }
      },
    });
    assert.equal(visited, total, `${opts.algorithm}: explorer saw ${visited}/${total} cells`);
  }
});

test('explorer.reset() forgets visit counts', () => {
  const corridor = new Maze(3, 1);
  corridor.carve(0, 0, E); corridor.carve(1, 0, E);
  corridor.finish = { x: 2, y: 0 };
  const nav = createNavigator('explorer', corridor, createRng('e'));
  // Walk 1→2 so that cell 2 has one visit, then stand on 1 heading west: east (visited once) scores worse than west (unvisited).
  nav.next({ x: 1, y: 0 }, 1);
  nav.next({ x: 2, y: 0 }, 1);
  assert.equal(nav.next({ x: 1, y: 0 }, 3), 'forward', 'prefers the unvisited west cell');
  nav.reset();
  const fresh = createNavigator('explorer', corridor, createRng('e'));
  for (let i = 0; i < 6; i++) {
    const cell = { x: 1, y: 0 };
    assert.equal(nav.next(cell, 1), fresh.next(cell, 1));
  }
});

test('every strategy tolerates being asked from the finish cell and from a 1×1 maze', () => {
  const maze = generateMaze({ width: 7, height: 7, algorithm: 'wilson', seed: 'fin' });
  const one = generateMaze({ width: 1, height: 1, seed: 'one' });
  for (const strategy of STRATEGY_IDS) {
    const nav = createNavigator(strategy, maze, createRng('fin'));
    for (let h = 0; h < 4; h++) assert.ok(ACTIONS.has(nav.next({ x: maze.finish.x, y: maze.finish.y }, h)));
    const tiny = createNavigator(strategy, one, createRng('one'));
    for (let i = 0; i < 8; i++) assert.equal(tiny.next({ x: 0, y: 0 }, i & 3), 'back');
  }
});

test('createNavigator without an rng still works', () => {
  const maze = generateMaze({ width: 5, height: 5, seed: 'norng' });
  const result = simulate(maze, createNavigator('drunk', maze), { maxDecisions: 200, stopAtFinish: false });
  assert.equal(result.decisions, 200);
});
