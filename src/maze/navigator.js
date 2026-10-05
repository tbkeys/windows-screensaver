/**
 * Navigation strategies for the maze walker (and the rat).
 *
 * `createNavigator(strategyId, maze, rng)` returns `{ next(cell, heading), reset() }`.
 * `next` answers one of: 'forward' (step one cell – only ever returned when the way
 * ahead is open and in bounds), 'left' / 'right' (turn 90° in place) or 'back' (turn
 * 180° in place). Strategies that pick a direction at random remember that choice
 * until the walker has turned to face it and stepped, so a decision never flip-flops
 * while the walker is mid-turn. `maze.finish` is read live on every solver recompute.
 */
import { DIRS, turnLeft, turnRight, turnBack } from './grid.js';
import { createRng, randomSeedString } from './rng.js';
import { ENUMS } from '../config/defaults.js';

/** Stable strategy ids, in the order they appear in `ENUMS.strategies`. */
export const STRATEGY_IDS = Object.freeze(ENUMS.strategies.map(([id]) => id));

/** Human-readable label for a strategy id (falls back to the id itself). */
export function describeStrategy(id) {
  const entry = ENUMS.strategies.find(([key]) => key === id);
  return entry ? entry[1] : String(id);
}

/**
 * Create a navigator.
 * @param {string} strategyId one of `STRATEGY_IDS`
 * @param {import('./grid.js').Maze} maze
 * @param {Function} [rng] seeded rng from `createRng`; a random one is used when omitted
 * @returns {{ id: string, next(cell: {x:number,y:number}, heading: number): string, reset(): void }}
 */
export function createNavigator(strategyId, maze, rng = createRng(randomSeedString())) {
  const build = BUILDERS[strategyId];
  if (!build) {
    throw new Error(`Unknown navigation strategy "${strategyId}" (expected one of ${STRATEGY_IDS.join(', ')})`);
  }
  const nav = build(maze, rng);
  nav.id = strategyId;
  return nav;
}

/* ------------------------------------------------------------------ helpers */

/** Action that makes a walker with `heading` face `dir` (or step, when already facing it). */
function actionToFace(heading, dir) {
  if (dir === heading) return 'forward';
  if (dir === turnLeft(heading)) return 'left';
  if (dir === turnRight(heading)) return 'right';
  return 'back';
}

/** Direction from cell `from` to the adjacent cell `to`, or -1 when not adjacent. */
function dirBetween(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  for (let d = 0; d < 4; d++) if (DIRS[d].dx === dx && DIRS[d].dy === dy) return d;
  return -1;
}

/* ------------------------------------------------------------ direction pickers
 * A picker returns the direction to travel next (or -1 when boxed in). The committed
 * navigator below turns that into turn/step actions.
 */

/** Uniform choice among open directions; `avoidReverse` excludes the way back unless it is the only exit. */
function randomPicker(maze, rng, avoidReverse) {
  const options = [0, 0, 0, 0];
  return {
    pick(cell, heading) {
      const reverse = turnBack(heading);
      let n = 0;
      for (let d = 0; d < 4; d++) {
        if ((avoidReverse && d === reverse) || !maze.canStep(cell.x, cell.y, d)) continue;
        options[n++] = d;
      }
      if (n > 0) return options[rng.int(n)];
      return avoidReverse && maze.canStep(cell.x, cell.y, reverse) ? reverse : -1;
    },
    reset() {},
  };
}

/** Trémaux-like: least-visited neighbour first, non-reversing as tie-break, then random. */
function explorerPicker(maze, rng) {
  const visits = new Uint32Array(maze.width * maze.height);
  const options = [0, 0, 0, 0];
  let lastCell = -1;
  return {
    pick(cell, heading) {
      const i = maze.index(cell.x, cell.y);
      if (i !== lastCell) { visits[i]++; lastCell = i; }
      const reverse = turnBack(heading);
      let n = 0, best = Infinity;
      for (let d = 0; d < 4; d++) {
        if (!maze.canStep(cell.x, cell.y, d)) continue;
        const score = visits[i + DIRS[d].dy * maze.width + DIRS[d].dx] * 2 + (d === reverse ? 1 : 0);
        if (score < best) { best = score; n = 0; }
        if (score === best) options[n++] = d;
      }
      return n > 0 ? options[rng.int(n)] : -1;
    },
    reset() { visits.fill(0); lastCell = -1; },
  };
}

/** Follows the BFS shortest path to `maze.finish`, recomputed lazily when off the cached path. */
function solverPicker(maze, rng) {
  const pathPos = new Int32Array(maze.width * maze.height).fill(-1);
  const wander = randomPicker(maze, rng, false);
  let path = [];
  let target = -1;
  const finishIndex = () => maze.index(maze.finish.x, maze.finish.y);
  const recompute = (cell) => {
    target = finishIndex();
    path = maze.shortestPath(cell, maze.finish);
    pathPos.fill(-1);
    for (let k = 0; k < path.length; k++) pathPos[maze.index(path[k].x, path[k].y)] = k;
  };
  return {
    pick(cell, heading) {
      const i = maze.index(cell.x, cell.y);
      if (pathPos[i] < 0 || target !== finishIndex()) recompute(cell);
      const k = pathPos[i];
      // Finish unreachable, or we are standing on it: just keep moving somewhere open.
      if (k < 0 || k + 1 >= path.length) return wander.pick(cell, heading);
      return dirBetween(cell, path[k + 1]);
    },
    reset() { path = []; target = -1; pathPos.fill(-1); },
  };
}

/* ---------------------------------------------------------------- navigators */

/**
 * Wrap a direction picker as a navigator. The picked direction is kept until the
 * walker faces it and steps ('forward'), or it becomes invalid (new cell / wall).
 */
function committedNavigator(maze, picker) {
  let pendingCell = -1, pendingDir = -1;
  return {
    next(cell, heading) {
      const i = maze.index(cell.x, cell.y);
      if (pendingCell !== i || pendingDir < 0 || !maze.canStep(cell.x, cell.y, pendingDir)) {
        pendingCell = i;
        pendingDir = picker.pick(cell, heading);
      }
      if (pendingDir < 0) return 'back'; // boxed in (1×1 maze): spin in place
      const action = actionToFace(heading, pendingDir);
      if (action === 'forward') pendingCell = -1;
      return action;
    },
    reset() {
      pendingCell = -1;
      pendingDir = -1;
      picker.reset();
    },
  };
}

/**
 * Classic wall-follower rule: keep a hand on the `side` wall. Turn toward that side
 * when it is open, else go straight, else turn away, else turn around. The chosen
 * direction is committed per cell visit (see `committedNavigator`), so the rule is
 * evaluated against the heading the walker *arrived* with, not the one after turning.
 */
function wallFollowerPicker(maze, side) {
  const near = side === 'left' ? turnLeft : turnRight;
  const far = side === 'left' ? turnRight : turnLeft;
  return {
    pick(cell, heading) {
      const { x, y } = cell;
      if (maze.canStep(x, y, near(heading))) return near(heading);
      if (maze.canStep(x, y, heading)) return heading;
      if (maze.canStep(x, y, far(heading))) return far(heading);
      return maze.canStep(x, y, turnBack(heading)) ? turnBack(heading) : -1;
    },
    reset() {},
  };
}

/**
 * Wall follower with a safety net: braided mazes can trap it in a loop, so after
 * 4 × width × height decisions without reaching the finish it hands over to the
 * solver. The counter restarts on `reset()` and whenever it is asked from the finish.
 */
function wallFollowerNavigator(maze, rng, side) {
  const follower = committedNavigator(maze, wallFollowerPicker(maze, side));
  const limit = 4 * maze.width * maze.height;
  let decisions = 0;
  let solver = null;
  return {
    next(cell, heading) {
      if (cell.x === maze.finish.x && cell.y === maze.finish.y) decisions = 0;
      if (++decisions > limit) {
        solver ??= committedNavigator(maze, solverPicker(maze, rng));
        return solver.next(cell, heading);
      }
      return follower.next(cell, heading);
    },
    reset() {
      decisions = 0;
      follower.reset();
      if (solver) solver.reset();
    },
  };
}

const BUILDERS = {
  leftHand: (maze, rng) => wallFollowerNavigator(maze, rng, 'left'),
  rightHand: (maze, rng) => wallFollowerNavigator(maze, rng, 'right'),
  random: (maze, rng) => committedNavigator(maze, randomPicker(maze, rng, true)),
  explorer: (maze, rng) => committedNavigator(maze, explorerPicker(maze, rng)),
  solver: (maze, rng) => committedNavigator(maze, solverPicker(maze, rng)),
  drunk: (maze, rng) => committedNavigator(maze, randomPicker(maze, rng, false)),
};
