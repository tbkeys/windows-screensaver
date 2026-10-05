/**
 * Grid-locked walker: the state machine behind the camera (and the rat).
 *
 * The walker always sits at a cell centre between moves. From `idle` it asks the
 * navigator (or the manual input queue) for an action: `forward` becomes a `stepping`
 * phase to the next cell centre, `left`/`right`/`back` become a `turning` phase that
 * rotates the yaw by ±90° (180° for `back`, which takes twice as long and always goes
 * clockwise). The optional pauses insert `waiting` phases. Each phase consumes whole
 * ticks: progress is `elapsed / duration`, eased by `movement.*Easing`, snapped by
 * `movement.quantize`, and the pose is snapped exactly onto the destination when the
 * phase ends so no floating-point error accumulates. `pose.yaw` is kept *unwrapped*
 * (continuous across turns, so it may differ from `yawForHeading(heading)` by a multiple
 * of 2π); use `normalizeAngle` when comparing. `movement.*` is read live every tick.
 */
import { DIRS, turnLeft, turnRight, turnBack, yawForHeading } from '../maze/grid.js';
import { DEFAULTS, deepClone } from '../config/defaults.js';
import { ease, quantize, lerp, normalizeAngle } from './easing.js';

const ACTIONS = new Set(['forward', 'left', 'right', 'back']);
const TWO_PI = Math.PI * 2;
const QUARTER = Math.PI / 2;
/** Tolerance that makes `n × (1/n)` accumulate to exactly one phase despite float error. */
const EPS = 1e-9;
const MAX_QUEUE = 8;

const copyPose = (dst, src) => { dst.x = src.x; dst.z = src.z; dst.yaw = src.yaw; dst.bob = src.bob; };

export class Walker {
  /**
   * @param {object} opts
   * @param {import('../maze/grid.js').Maze} opts.maze
   * @param {{ next(cell:{x:number,y:number}, heading:number): string, reset?(): void }} [opts.navigator]
   * @param {object} [opts.movement] the shared `config.movement` object (read live)
   * @param {number} [opts.cellSize=1] world units per cell (change it, then call `setMaze`/`teleport`)
   */
  constructor({ maze, navigator = null, movement = deepClone(DEFAULTS.movement), cellSize = 1 } = {}) {
    if (!maze) throw new Error('Walker requires a maze');
    this.movement = movement;
    this.cellSize = cellSize;
    this.navigator = navigator;

    /** @type {{x:number,y:number}} current (or departing) cell */
    this.cell = { x: 0, y: 0 };
    /** @type {number} 0..3 = N, E, S, W */
    this.heading = 0;
    /** @type {'idle'|'turning'|'stepping'|'waiting'|'finished'} */
    this.state = 'idle';
    /** Eye position (world x/z), unwrapped yaw (radians) and vertical bob offset. */
    this.pose = { x: 0, z: 0, yaw: 0, bob: 0 };
    /** Copy of `pose` taken at the start of the latest `update()`. */
    this.prevPose = { x: 0, z: 0, yaw: 0, bob: 0 };
    /** Counters for the HUD. `steps`/`turns`/`cellsVisited` reset per maze; `finishes` is cumulative. */
    this.stats = { steps: 0, turns: 0, cellsVisited: 0, finishes: 0 };

    this._interp = { x: 0, z: 0, yaw: 0, bob: 0 };
    this._listeners = new Map();
    this._queue = [];
    this._elapsed = 0;
    this._wait = 0;
    this._pendingTurn = null;
    this._turnAction = null;
    this._targetHeading = 0;
    this._target = { x: 0, y: 0 };
    this._fromX = 0; this._fromZ = 0; this._toX = 0; this._toZ = 0;
    this._yawFrom = 0; this._yawTo = 0;

    this.setMaze(maze);
  }

  /* ------------------------------------------------------------------ events */

  /** Subscribe to `enterCell`, `leaveCell`, `stepStart`, `turnStart`, `finish` or `blocked`. */
  on(event, fn) {
    let set = this._listeners.get(event);
    if (!set) this._listeners.set(event, (set = new Set()));
    set.add(fn);
    return this;
  }

  /** Unsubscribe one listener, or every listener of `event` when `fn` is omitted. */
  off(event, fn) {
    const set = this._listeners.get(event);
    if (set) { if (fn) set.delete(fn); else set.clear(); }
    return this;
  }

  _emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set || set.size === 0) return;
    for (const fn of set) fn(payload, this);
  }

  /* ----------------------------------------------------------------- control */

  /** Switch to `maze` and reset to its start cell/heading (clears timers, queue and per-maze stats). */
  setMaze(maze) {
    this.maze = maze;
    this._place(maze.start.x, maze.start.y, maze.start.heading ?? 0);
    this.stats.steps = 0;
    this.stats.turns = 0;
    this.stats.cellsVisited = 1;
    if (this.navigator && typeof this.navigator.reset === 'function') this.navigator.reset();
    // Dwell on the START sign before the first decision (the classic opening beat).
    const pauseAtStart = Math.max(0, this.movement.pauseAtStart || 0);
    if (pauseAtStart > 0) this._beginWait(pauseAtStart, null);
    return this;
  }

  /** Replace the navigator (any object with `next(cell, heading)`); takes effect at the next decision. */
  setNavigator(navigator) {
    this.navigator = navigator;
    return this;
  }

  /**
   * Instantly relocate to cell `{x, y}` facing `heading` (defaults to the current heading).
   * Snaps `pose` and `prevPose`, clears timers/queue, sets `state = 'idle'` (also leaves
   * `'finished'`) and emits `enterCell` with `teleported: true`. Does not trigger `finish`.
   */
  teleport({ x, y }, heading = this.heading) {
    if (!this.maze.inBounds(x, y)) throw new RangeError(`teleport target (${x}, ${y}) is outside the maze`);
    this._place(x, y, heading);
    this.stats.cellsVisited++;
    this._emit('enterCell', { x, y, heading: this.heading, teleported: true });
    return this;
  }

  /** Queue a manual-drive action (`movement.manual`). Returns false when rejected (unknown or queue full). */
  enqueue(action) {
    if (!ACTIONS.has(action) || this._queue.length >= MAX_QUEUE) return false;
    this._queue.push(action);
    return true;
  }

  /** Drop any pending manual input. */
  clearQueue() {
    this._queue.length = 0;
    return this;
  }

  /** Fraction (0..1) of the current turning/stepping phase that has elapsed. */
  get phaseProgress() {
    if (this.state === 'turning') return this._fraction(this._turnDuration());
    if (this.state === 'stepping') return this._fraction(this._stepDuration());
    return 0;
  }

  /* --------------------------------------------------------------- per tick */

  /** Advance exactly one simulation tick of `dt` seconds. */
  update(dt) {
    copyPose(this.prevPose, this.pose);
    if (this.movement.paused || this.state === 'finished') return;
    const step = dt > 0 ? dt : 0;
    switch (this.state) {
      case 'waiting': this._advanceWait(step); break;
      case 'turning': this._advanceTurn(step); break;
      case 'stepping': this._advanceStep(step); break;
    }
    if (this.state === 'idle') this._decide();
  }

  /**
   * Pose blended between `prevPose` (alpha 0) and `pose` (alpha 1). Yaw follows the
   * tick's own rotation when it is at most a half turn, otherwise the shortest arc.
   * Returns one reusable object – copy it if you need to keep it.
   */
  interpolatedPose(alpha) {
    const a = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
    const out = this._interp, p = this.prevPose, q = this.pose;
    out.x = lerp(p.x, q.x, a);
    out.z = lerp(p.z, q.z, a);
    out.bob = lerp(p.bob, q.bob, a);
    const raw = q.yaw - p.yaw;
    const delta = Math.abs(raw) <= Math.PI + 1e-6 ? raw : normalizeAngle(raw);
    out.yaw = p.yaw + delta * a;
    return out;
  }

  /* --------------------------------------------------------------- decisions */

  _decide() {
    const m = this.movement;
    let action;
    if (m.manual) {
      action = this._nextManualAction();
      if (!action) return;
    } else {
      if (!this.navigator) return;
      action = this._guard(this.navigator.next(this.cell, this.heading));
    }
    if (action === 'forward') { this._beginStep(); return; }

    const deadEnd = action === 'back' && this.maze.isDeadEnd(this.cell.x, this.cell.y);
    const wait = Math.max(0, m.pauseBeforeTurn || 0) + (deadEnd ? Math.max(0, m.pauseAtDeadEnd || 0) : 0);
    if (wait > 0) this._beginWait(wait, action);
    else this._beginTurn(action);
  }

  /** Never walk through walls: `forward` into a wall (or an unknown action) becomes `back`. */
  _guard(action) {
    if (action === 'forward') return this._canGo(this.heading) ? 'forward' : 'back';
    return ACTIONS.has(action) ? action : 'back';
  }

  /** Pop manual input; blocked `forward`s are dropped (emitting `blocked`) until a usable action remains. */
  _nextManualAction() {
    while (this._queue.length) {
      const action = this._queue.shift();
      if (action === 'forward' && !this._canGo(this.heading)) {
        this._emit('blocked', { x: this.cell.x, y: this.cell.y, heading: this.heading });
        continue;
      }
      return action;
    }
    return null;
  }

  _canGo(dir) { return this.maze.canStep(this.cell.x, this.cell.y, dir); }

  /* ------------------------------------------------------------------ phases */

  _beginWait(seconds, pendingTurn) {
    this._wait = seconds;
    this._pendingTurn = pendingTurn;
    this.state = 'waiting';
  }

  _advanceWait(dt) {
    this._wait -= dt;
    if (this._wait > EPS) return;
    const action = this._pendingTurn;
    this._pendingTurn = null;
    if (action) this._beginTurn(action);
    else this.state = 'idle';
  }

  _beginTurn(action) {
    const from = this.heading;
    const to = action === 'left' ? turnLeft(from) : action === 'right' ? turnRight(from) : turnBack(from);
    const delta = action === 'left' ? QUARTER : action === 'right' ? -QUARTER : -Math.PI;
    this._turnAction = action;
    this._targetHeading = to;
    this._yawFrom = this.pose.yaw;
    this._yawTo = this.pose.yaw + delta;
    this._elapsed = 0;
    this.state = 'turning';
    this._emit('turnStart', { from, to, action });
    if (this._turnDuration() <= 0) this._completeTurn();
  }

  _advanceTurn(dt) {
    this._elapsed += dt;
    const t = this._fraction(this._turnDuration());
    if (t >= 1 - EPS) { this._completeTurn(); return; }
    const m = this.movement;
    this.pose.yaw = lerp(this._yawFrom, this._yawTo, quantize(ease(m.turnEasing, t), m.quantize));
  }

  _completeTurn() {
    this.heading = this._targetHeading;
    // Exact canonical yaw, lifted to the 2π-branch the turn was heading for (keeps yaw continuous).
    const canonical = yawForHeading(this.heading);
    this.pose.yaw = canonical + TWO_PI * Math.round((this._yawTo - canonical) / TWO_PI);
    this.stats.turns++;
    this._turnAction = null;
    const after = Math.max(0, this.movement.pauseAfterTurn || 0);
    if (after > 0) this._beginWait(after, null);
    else this.state = 'idle';
  }

  _beginStep() {
    const d = DIRS[this.heading];
    const x = this.cell.x, y = this.cell.y;
    this._target.x = x + d.dx;
    this._target.y = y + d.dy;
    this._fromX = this.pose.x;
    this._fromZ = this.pose.z;
    this._toX = this._centre(this._target.x);
    this._toZ = this._centre(this._target.y);
    this._elapsed = 0;
    this.state = 'stepping';
    this._emit('leaveCell', { x, y, heading: this.heading });
    this._emit('stepStart', { from: { x, y }, to: { x: this._target.x, y: this._target.y }, heading: this.heading });
    if (this._stepDuration() <= 0) this._arrive();
  }

  _advanceStep(dt) {
    this._elapsed += dt;
    const t = this._fraction(this._stepDuration());
    if (t >= 1 - EPS) { this._arrive(); return; }
    const m = this.movement;
    const eq = quantize(ease(m.stepEasing, t), m.quantize);
    this.pose.x = lerp(this._fromX, this._toX, eq);
    this.pose.z = lerp(this._fromZ, this._toZ, eq);
    this.pose.bob = m.headBob ? m.headBob * Math.sin(t * Math.PI * (m.headBobSpeed ?? 2)) : 0;
  }

  _arrive() {
    const x = this._target.x, y = this._target.y;
    this.cell.x = x;
    this.cell.y = y;
    this.pose.x = this._toX;
    this.pose.z = this._toZ;
    this.pose.bob = 0;
    this.state = 'idle';
    this.stats.steps++;
    this.stats.cellsVisited++;
    const atFinish = this._isFinish(x, y);
    this._emit('enterCell', { x, y, heading: this.heading });
    // A listener may have teleported us away (classic polyhedron touch) – only finish if we are still here.
    if (atFinish && this.state === 'idle' && this.cell.x === x && this.cell.y === y) this._finish();
  }

  _finish() {
    this.state = 'finished';
    this.stats.finishes++;
    this._emit('finish', { x: this.cell.x, y: this.cell.y, steps: this.stats.steps });
  }

  /* ----------------------------------------------------------------- helpers */

  /** Snap to cell `(x, y)` facing `heading`, reset timers/queue, `prevPose = pose`, `state = 'idle'`. */
  _place(x, y, heading) {
    this.cell.x = x;
    this.cell.y = y;
    this.heading = heading & 3;
    this.pose.x = this._centre(x);
    this.pose.z = this._centre(y);
    this.pose.yaw = yawForHeading(this.heading);
    this.pose.bob = 0;
    copyPose(this.prevPose, this.pose);
    this._elapsed = 0;
    this._wait = 0;
    this._pendingTurn = null;
    this._turnAction = null;
    this._queue.length = 0;
    this.state = 'idle';
  }

  _centre(i) { return (i + 0.5) * this.cellSize; }

  _fraction(duration) {
    if (!(duration > 0)) return 1;
    const t = this._elapsed / duration;
    return t > 1 ? 1 : t;
  }

  _stepDuration() { return Math.max(0, this.movement.stepDuration || 0); }

  _turnDuration() {
    return Math.max(0, this.movement.turnDuration || 0) * (this._turnAction === 'back' ? 2 : 1);
  }

  _isFinish(x, y) {
    const f = this.maze.finish;
    return !!f && f.x === x && f.y === y;
  }
}
