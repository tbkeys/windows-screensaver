import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Maze, N, E, S, W, turnLeft, turnRight, turnBack, yawForHeading } from '../src/maze/grid.js';
import { Walker } from '../src/sim/walker.js';
import { normalizeAngle } from '../src/sim/easing.js';
import { DEFAULTS, deepClone } from '../src/config/defaults.js';

const EVENTS = ['leaveCell', 'stepStart', 'enterCell', 'turnStart', 'finish', 'blocked'];
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);
const sameHeadingYaw = (yaw, heading) => close(normalizeAngle(yaw - yawForHeading(heading)), 0);

/** Fresh movement config; pauses off unless a test turns them on. */
const movement = (overrides = {}) => ({
  ...deepClone(DEFAULTS.movement), pauseAtDeadEnd: 0, stepDuration: 0.5, turnDuration: 0.5, ...overrides,
});

/** 3×1 corridor (0,0)–(1,0)–(2,0); start (0,0) facing E; finish (2,0). */
function corridor(heading = E) {
  const m = new Maze(3, 1);
  m.carve(0, 0, E);
  m.carve(1, 0, E);
  m.start = { x: 0, y: 0, heading };
  m.finish = { x: 2, y: 0 };
  return m;
}

/** 3×2 maze whose left 2×2 cells form a ring; finish (2,1) is walled off so the walker never finishes. */
function ring(heading = E) {
  const m = new Maze(3, 2);
  m.carve(0, 0, E); m.carve(1, 0, S); m.carve(1, 1, W); m.carve(0, 1, N);
  m.start = { x: 0, y: 0, heading };
  m.finish = { x: 2, y: 1 };
  return m;
}

/** Navigator that answers a fixed script (last entry repeats) and records every call. */
function scripted(actions) {
  let i = 0;
  const nav = {
    calls: [],
    resets: 0,
    next(cell, heading) {
      nav.calls.push({ x: cell.x, y: cell.y, heading });
      return actions[Math.min(i++, actions.length - 1)];
    },
    reset() { nav.resets++; },
  };
  return nav;
}

const record = (walker) => {
  const log = [];
  for (const ev of EVENTS) walker.on(ev, (p) => log.push([ev, { ...p }]));
  return log;
};

const ticksUntil = (walker, dt, predicate, limit = 10000) => {
  for (let n = 1; n <= limit; n++) {
    walker.update(dt);
    if (predicate()) return n;
  }
  throw new Error('predicate never became true');
};

describe('stepping', () => {
  test('starts at the maze start, facing its heading, with prevPose equal to pose', () => {
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement() });
    assert.deepEqual(w.cell, { x: 0, y: 0 });
    assert.equal(w.heading, E);
    assert.equal(w.state, 'idle');
    assert.deepEqual(w.pose, { x: 0.5, z: 0.5, yaw: yawForHeading(E), bob: 0 });
    assert.deepEqual(w.prevPose, w.pose);
    assert.deepEqual(w.stats, { steps: 0, turns: 0, cellsVisited: 1, finishes: 0 });
  });

  test('a step takes ceil(stepDuration / dt) ticks and ends exactly at the next cell centre', () => {
    const dt = 1 / 30;
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement({ stepDuration: 0.55 }) });
    const log = record(w);
    w.update(dt); // decision tick: the step starts, progress 0
    assert.equal(w.state, 'stepping');
    assert.equal(w.pose.x, 0.5);
    assert.equal(log.map(([e]) => e).join(), 'leaveCell,stepStart');
    const n = ticksUntil(w, dt, () => log.some(([e]) => e === 'enterCell'));
    assert.equal(n, Math.ceil(0.55 / dt));
    assert.equal(n, 17);
    assert.equal(w.pose.x, 1.5, 'exact centre, no float residue');
    assert.equal(w.pose.z, 0.5);
    assert.deepEqual(w.cell, { x: 1, y: 0 });
    assert.equal(w.stats.steps, 1);
  });

  test('position increases monotonically during a step and respects cellSize', () => {
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement(), cellSize: 2 });
    assert.deepEqual([w.pose.x, w.pose.z], [1, 1]);
    const xs = [];
    for (let i = 0; i < 11; i++) { w.update(0.05); xs.push(w.pose.x); }
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1]);
    assert.equal(w.pose.x, 3);
    assert.equal(w.cell.x, 1);
  });

  test('quantize = 4 yields exactly five distinct positions per step', () => {
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement({ quantize: 4 }) });
    const seen = new Set();
    ticksUntil(w, 0.01, () => { seen.add(w.pose.x); return w.cell.x === 1; });
    assert.deepEqual([...seen].sort((a, b) => a - b), [0.5, 0.75, 1, 1.25, 1.5]);
  });

  test('stepEasing shapes the motion (easeIn is behind linear at the midpoint)', () => {
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement({ stepEasing: 'easeIn' }) });
    w.update(0.1);
    for (let i = 0; i < 5; i++) w.update(0.05); // half way in time
    assert.ok(w.pose.x < 1.0 && w.pose.x > 0.5);
  });

  test('head bob oscillates while stepping and is zero on arrival', () => {
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement({ headBob: 0.1, headBobSpeed: 2 }) });
    w.update(0.1);
    w.update(0.125); // a quarter of the way → sin(π/2 · … ) peak region
    assert.ok(w.pose.bob > 0.05);
    ticksUntil(w, 0.125, () => w.cell.x === 1);
    assert.equal(w.pose.bob, 0);
  });

  test('duration changes are picked up mid-phase (config is read live)', () => {
    const m = movement({ stepDuration: 10 });
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: m });
    for (let i = 0; i < 5; i++) w.update(0.1);
    assert.equal(w.state, 'stepping');
    m.stepDuration = 0.3;
    w.update(0.1); // elapsed 0.5 ≥ 0.3 → arrives now
    assert.deepEqual(w.cell, { x: 1, y: 0 });
  });

  test('zero durations complete one action per tick', () => {
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement({ stepDuration: 0, turnDuration: 0 }) });
    const log = record(w);
    w.update(0.1);
    assert.deepEqual(w.cell, { x: 1, y: 0 });
    assert.equal(w.pose.x, 1.5);
    w.update(0.1);
    assert.deepEqual(w.cell, { x: 2, y: 0 });
    assert.equal(w.state, 'finished');
    assert.equal(log.filter(([e]) => e === 'finish').length, 1);
    const t = new Walker({ maze: ring(), navigator: scripted(['left']), movement: movement({ turnDuration: 0 }) });
    t.update(0.1);
    assert.equal(t.heading, N);
    assert.equal(Math.abs(t.pose.yaw - yawForHeading(N)), 0);
  });
});

describe('turning', () => {
  test('left and right finish at yawForHeading(newHeading) after ceil(turnDuration / dt) ticks', () => {
    for (const [action, turn, sign] of [['left', turnLeft, +1], ['right', turnRight, -1]]) {
      const w = new Walker({ maze: ring(), navigator: scripted([action]), movement: movement() });
      const log = record(w);
      w.update(0.1);
      assert.equal(w.state, 'turning');
      assert.deepEqual(log[0], ['turnStart', { from: E, to: turn(E), action }]);
      const yaw0 = w.pose.yaw;
      let prev = yaw0;
      const n = ticksUntil(w, 0.1, () => {
        assert.ok(sign * (w.pose.yaw - prev) >= 0, `${action} rotates the short way`);
        prev = w.pose.yaw;
        return w.heading !== E;
      });
      assert.equal(n, 5);
      assert.equal(w.heading, turn(E));
      sameHeadingYaw(w.pose.yaw, turn(E));
      close(w.pose.yaw - yaw0, sign * Math.PI / 2);
      assert.equal(Math.abs(w.pose.yaw - yawForHeading(turn(E))), 0, 'exact snap for a first turn');
      assert.equal(w.stats.turns, 1);
    }
  });

  test("'back' takes twice as long and rotates clockwise (yaw decreasing) through 180°", () => {
    const w = new Walker({ maze: ring(), navigator: scripted(['back']), movement: movement() });
    w.update(0.1);
    const yaw0 = w.pose.yaw;
    let prev = yaw0;
    const n = ticksUntil(w, 0.1, () => {
      assert.ok(w.pose.yaw <= prev);
      prev = w.pose.yaw;
      return w.heading !== E;
    });
    assert.equal(n, 10);
    assert.equal(w.heading, turnBack(E));
    close(w.pose.yaw - yaw0, -Math.PI);
    sameHeadingYaw(w.pose.yaw, W);
  });

  test('yaw stays continuous across many turns and still matches the heading exactly', () => {
    const w = new Walker({ maze: ring(), navigator: scripted(['right']), movement: movement() });
    ticksUntil(w, 0.1, () => w.stats.turns === 4);
    assert.equal(w.heading, E);
    close(w.pose.yaw, yawForHeading(E) - 2 * Math.PI, 1e-12);
    sameHeadingYaw(w.pose.yaw, E);
    ticksUntil(w, 0.1, () => w.stats.turns === 40);
    sameHeadingYaw(w.pose.yaw, E);
  });

  test("'forward' into a wall is turned into 'back' (never walks through walls)", () => {
    for (const heading of [W, N]) {
      const nav = scripted(['forward']);
      const w = new Walker({ maze: corridor(heading), navigator: nav, movement: movement() });
      const log = record(w);
      w.update(0.1);
      assert.deepEqual(log, [['turnStart', { from: heading, to: turnBack(heading), action: 'back' }]]);
      assert.equal(ticksUntil(w, 0.1, () => w.heading !== heading), 10);
      assert.equal(w.heading, turnBack(heading));
      assert.deepEqual(w.cell, { x: 0, y: 0 });
    }
  });

  test('unknown navigator answers become back turns; no navigator means stay idle', () => {
    const w = new Walker({ maze: ring(), navigator: scripted(['sideways']), movement: movement() });
    const log = record(w);
    w.update(0.1);
    assert.equal(log[0][1].action, 'back');
    const idle = new Walker({ maze: ring(), movement: movement() });
    for (let i = 0; i < 5; i++) idle.update(0.1);
    assert.equal(idle.state, 'idle');
  });

  test('turnEasing and quantize apply to turns', () => {
    const w = new Walker({ maze: ring(), navigator: scripted(['left']), movement: movement({ quantize: 2, turnEasing: 'linear' }) });
    const seen = new Set();
    ticksUntil(w, 0.05, () => { seen.add(w.pose.yaw); return w.heading !== E; });
    assert.equal(seen.size, 3);
  });
});

describe('pauses', () => {
  test("pauseAtDeadEnd inserts a waiting state before a 'back' turn at a dead end", () => {
    const w = new Walker({ maze: corridor(W), navigator: scripted(['forward']), movement: movement({ pauseAtDeadEnd: 0.3 }) });
    const log = record(w);
    w.update(0.1);
    assert.equal(w.state, 'waiting');
    assert.equal(log.length, 0);
    const n = ticksUntil(w, 0.1, () => w.state === 'turning');
    assert.equal(n, 3);
    assert.equal(log[0][0], 'turnStart');
    ticksUntil(w, 0.1, () => w.state !== 'turning');
    assert.equal(w.heading, E);
  });

  test('pauseAtDeadEnd does not apply to ordinary back turns', () => {
    const w = new Walker({ maze: ring(), navigator: scripted(['back']), movement: movement({ pauseAtDeadEnd: 0.3 }) });
    w.update(0.1);
    assert.equal(w.state, 'turning');
  });

  test('pauseBeforeTurn and pauseAfterTurn bracket a turn', () => {
    const w = new Walker({ maze: ring(S), navigator: scripted(['left', 'forward']), movement: movement({ pauseBeforeTurn: 0.2, pauseAfterTurn: 0.2 }) });
    w.update(0.1);
    assert.equal(w.state, 'waiting');
    assert.equal(ticksUntil(w, 0.1, () => w.state === 'turning'), 2);
    assert.equal(ticksUntil(w, 0.1, () => w.state === 'waiting'), 5);
    assert.equal(w.heading, E);
    assert.equal(ticksUntil(w, 0.1, () => w.state === 'stepping'), 2);
  });
});

describe('events, finish and manual drive', () => {
  test('events fire in order and the finish fires once, then the walker freezes', () => {
    const nav = scripted(['forward']);
    const w = new Walker({ maze: corridor(), navigator: nav, movement: movement() });
    const log = record(w);
    for (let i = 0; i < 40; i++) w.update(0.1);
    assert.deepEqual(log, [
      ['leaveCell', { x: 0, y: 0, heading: E }],
      ['stepStart', { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, heading: E }],
      ['enterCell', { x: 1, y: 0, heading: E }],
      ['leaveCell', { x: 1, y: 0, heading: E }],
      ['stepStart', { from: { x: 1, y: 0 }, to: { x: 2, y: 0 }, heading: E }],
      ['enterCell', { x: 2, y: 0, heading: E }],
      ['finish', { x: 2, y: 0, steps: 2 }],
    ]);
    assert.equal(w.state, 'finished');
    assert.equal(nav.calls.length, 2, 'navigator is not consulted at the finish');
    assert.deepEqual(nav.calls[1], { x: 1, y: 0, heading: E });
    const pose = { ...w.pose };
    for (let i = 0; i < 20; i++) w.update(0.1);
    assert.deepEqual(w.pose, pose);
    assert.deepEqual(w.prevPose, pose);
    assert.equal(log.length, 7);
    assert.equal(w.stats.finishes, 1);
  });

  test('teleport snaps pose and prevPose, clears the phase, emits enterCell and revives a finished walker', () => {
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement() });
    for (let i = 0; i < 3; i++) w.update(0.1);
    assert.equal(w.state, 'stepping');
    const log = record(w);
    assert.equal(w.teleport({ x: 2, y: 0 }, W), w, 'chainable');
    assert.deepEqual(log, [['enterCell', { x: 2, y: 0, heading: W, teleported: true }]]);
    assert.equal(w.state, 'idle', 'landing on the finish by teleport does not finish');
    assert.deepEqual(w.pose, { x: 2.5, z: 0.5, yaw: yawForHeading(W), bob: 0 });
    assert.deepEqual(w.prevPose, w.pose);
    assert.equal(w.stats.cellsVisited, 2);
    w.update(0.1);
    assert.equal(w.state, 'stepping', 'walks on from the new cell');

    const f = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement() });
    for (let i = 0; i < 40; i++) f.update(0.1);
    assert.equal(f.state, 'finished');
    f.teleport({ x: 0, y: 0 });
    assert.equal(f.heading, E, 'heading defaults to the current one');
    assert.equal(f.state, 'idle');
    f.update(0.1);
    assert.equal(f.state, 'stepping');
    assert.throws(() => f.teleport({ x: 9, y: 9 }), RangeError);
  });

  test('a listener teleporting during enterCell wins over the finish', () => {
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement() });
    let finished = 0;
    w.on('finish', () => finished++);
    w.on('enterCell', (p) => { if (p.x === 2 && !p.teleported) w.teleport({ x: 0, y: 0 }, E); });
    for (let i = 0; i < 20; i++) w.update(0.1);
    assert.equal(finished, 0);
    assert.notEqual(w.state, 'finished');
  });

  test('setMaze resets to the new start, clears stats and resets the navigator', () => {
    const nav = scripted(['forward']);
    const w = new Walker({ maze: corridor(), navigator: nav, movement: movement() });
    for (let i = 0; i < 40; i++) w.update(0.1);
    assert.equal(w.state, 'finished');
    assert.equal(nav.resets, 1);
    const m = ring(S);
    assert.equal(w.setMaze(m), w);
    assert.equal(w.maze, m);
    assert.equal(nav.resets, 2);
    assert.deepEqual(w.cell, { x: 0, y: 0 });
    assert.equal(w.heading, S);
    assert.deepEqual(w.pose, { x: 0.5, z: 0.5, yaw: yawForHeading(S), bob: 0 });
    assert.deepEqual(w.prevPose, w.pose);
    assert.deepEqual(w.stats, { steps: 0, turns: 0, cellsVisited: 1, finishes: 1 });
    assert.equal(w.state, 'idle');
  });

  test('manual mode consumes the queue, drops blocked forwards and ignores the navigator', () => {
    const nav = scripted(['forward']);
    const w = new Walker({ maze: corridor(), navigator: nav, movement: movement({ manual: true }) });
    const log = record(w);
    for (let i = 0; i < 5; i++) w.update(0.1);
    assert.equal(w.state, 'idle');
    assert.equal(nav.calls.length, 0);
    assert.equal(w.enqueue('forward'), true);
    assert.equal(w.enqueue('jump'), false);
    ticksUntil(w, 0.1, () => w.cell.x === 1);
    assert.equal(w.state, 'idle');
    w.enqueue('left');
    w.enqueue('forward'); // into the wall: dropped
    w.enqueue('right');
    ticksUntil(w, 0.1, () => w.heading === N);
    ticksUntil(w, 0.1, () => w.heading === E);
    for (let i = 0; i < 5; i++) w.update(0.1);
    assert.deepEqual(w.cell, { x: 1, y: 0 });
    assert.equal(w.state, 'idle');
    assert.deepEqual(log.filter(([e]) => e === 'blocked'), [['blocked', { x: 1, y: 0, heading: N }]]);
    assert.equal(nav.calls.length, 0);
    for (let i = 0; i < 8; i++) assert.equal(w.enqueue('left'), true);
    assert.equal(w.enqueue('left'), false, 'queue is bounded');
    w.clearQueue();
    w.update(0.1);
    assert.equal(w.state, 'idle');
    assert.equal(w.setNavigator(nav), w);
  });

  test('paused does nothing (and keeps prevPose glued to pose)', () => {
    const nav = scripted(['forward']);
    const m = movement();
    const w = new Walker({ maze: corridor(), navigator: nav, movement: m });
    const log = record(w);
    m.paused = true;
    for (let i = 0; i < 10; i++) w.update(0.1);
    assert.equal(w.state, 'idle');
    assert.equal(log.length, 0);
    assert.equal(nav.calls.length, 0);
    assert.deepEqual(w.pose, { x: 0.5, z: 0.5, yaw: yawForHeading(E), bob: 0 });
    m.paused = false;
    w.update(0.1);
    w.update(0.1);
    assert.equal(w.state, 'stepping');
    assert.notDeepEqual(w.prevPose, w.pose);
    m.paused = true;
    const frozen = { ...w.pose };
    w.update(0.1);
    assert.deepEqual(w.pose, frozen);
    assert.deepEqual(w.prevPose, frozen);
  });

  test('on/off chain and off removes listeners', () => {
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement() });
    let hits = 0;
    const fn = () => hits++;
    assert.equal(w.on('stepStart', fn), w);
    w.update(0.1);
    assert.equal(hits, 1);
    assert.equal(w.off('stepStart', fn), w);
    ticksUntil(w, 0.1, () => w.cell.x === 1);
    w.update(0.1);
    assert.equal(hits, 1);
  });
});

describe('interpolation', () => {
  test('interpolatedPose(0.5) is halfway and reuses one object', () => {
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement() });
    w.update(0.1);
    w.update(0.1);
    const a = w.interpolatedPose(0.5);
    close(a.x, (w.prevPose.x + w.pose.x) / 2);
    assert.ok(a.x > 0.5 && a.x < w.pose.x);
    assert.equal(a.z, 0.5);
    assert.equal(w.interpolatedPose(0.25), a, 'same object');
    assert.equal(w.interpolatedPose(0).x, w.prevPose.x);
    assert.equal(w.interpolatedPose(1).x, w.pose.x);
    assert.equal(w.interpolatedPose(2).x, w.pose.x, 'clamped');
  });

  test('yaw interpolates the short way across the wrap (−3π/2 → 0 passes through π/4)', () => {
    const w = new Walker({ maze: corridor(), navigator: scripted(['forward']), movement: movement() });
    Object.assign(w.prevPose, { x: 0.5, z: 0.5, yaw: -3 * Math.PI / 2, bob: 0 });
    Object.assign(w.pose, { x: 1.5, z: 0.5, yaw: 0, bob: 0.1 });
    const p = w.interpolatedPose(0.5);
    close(normalizeAngle(p.yaw), Math.PI / 4);
    assert.equal(p.x, 1);
    close(p.bob, 0.05);
  });

  test('an exact half-turn within one tick keeps its (clockwise) direction', () => {
    const w = new Walker({ maze: ring(), navigator: scripted(['back']), movement: movement({ turnDuration: 0.05 }) });
    w.update(0.1);
    w.update(0.1); // the whole back turn happens in this tick
    assert.equal(w.heading, W);
    close(w.pose.yaw - w.prevPose.yaw, -Math.PI);
    close(w.interpolatedPose(0.5).yaw, w.prevPose.yaw - Math.PI / 2);
  });

  test('turning interpolation follows the actual rotation', () => {
    const w = new Walker({ maze: ring(), navigator: scripted(['left']), movement: movement() });
    w.update(0.1);
    w.update(0.1);
    w.update(0.1);
    const mid = w.interpolatedPose(0.5).yaw;
    close(mid, (w.prevPose.yaw + w.pose.yaw) / 2);
  });
});
