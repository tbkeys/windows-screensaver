// Deterministic Node check of src/sim/loop.js using an injected fake rAF/clock.
// usage: node scripts/dev/loop-check.mjs
import assert from 'node:assert/strict';
import { createLoop } from '../../src/sim/loop.js';

/** Drive a loop for `frames` frames of `frameMs` each and return the counters. */
function simulate({ frames, frameMs = 1000 / 60, tickRate = 30, fpsCap = 0, timeScale = 1, fixed = false, hiddenFrom = -1, hiddenTo = -1 }) {
  let time = 1000;
  let pending = null;
  const doc = { hidden: false, listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; }, removeEventListener(t) { delete this.listeners[t]; } };
  const counters = { ticks: 0, renders: 0, tickDt: new Set(), alphas: [], renderDts: [], maxTickDt: 0 };
  const loop = createLoop({
    tick: (dt) => { counters.ticks++; counters.tickDt.add(+dt.toFixed(6)); counters.maxTickDt = Math.max(counters.maxTickDt, dt); },
    render: (alpha, dt) => { counters.renders++; counters.alphas.push(alpha); counters.renderDts.push(dt); },
    getTickRate: () => tickRate,
    getFpsCap: () => fpsCap,
    getTimeScale: () => timeScale,
    getFixedTimestep: () => fixed,
    raf: (cb) => { pending = cb; return 1; },
    caf: () => { pending = null; },
    now: () => time,
    doc,
  });
  loop.start();
  assert.equal(loop.running, true);
  for (let f = 0; f < frames; f++) {
    const wasHidden = doc.hidden;
    doc.hidden = f >= hiddenFrom && f < hiddenTo;
    if (wasHidden && !doc.hidden) doc.listeners.visibilitychange();
    const cb = pending; pending = null;
    cb(time);
    time += frameMs;
  }
  loop.stop();
  assert.equal(loop.running, false);
  assert.equal(pending, null, 'stop cancels the pending frame');
  counters.fps = loop.fps;
  counters.frameTime = loop.frameTime;
  return counters;
}

// 60 Hz display, 30 tick/s, uncapped: 600 frames (10 s) → ~300 ticks, 600 renders, alpha in [0,1)
{
  const c = simulate({ frames: 600 });
  assert.ok(Math.abs(c.ticks - 300) <= 1, `ticks ${c.ticks}`);
  assert.equal(c.renders, 600);
  assert.ok(c.alphas.every((a) => a >= 0 && a < 1), 'alpha within [0,1)');
  assert.deepEqual([...c.tickDt], [+(1 / 30).toFixed(6)]);
  assert.ok(Math.abs(c.fps - 60) < 1, `fps ema ${c.fps}`);
  console.log('ok uncapped: ticks', c.ticks, 'renders', c.renders, 'fps', c.fps.toFixed(1));
}

// fps cap 30 on a 60 Hz display: renders halve, ticks unchanged, average render dt = 1/30
{
  const c = simulate({ frames: 600, fpsCap: 30 });
  assert.ok(Math.abs(c.ticks - 300) <= 1, `ticks ${c.ticks}`);
  assert.ok(Math.abs(c.renders - 300) <= 2, `renders ${c.renders}`);
  const avg = c.renderDts.slice(1).reduce((a, b) => a + b, 0) / (c.renderDts.length - 1);
  assert.ok(Math.abs(avg - 1 / 30) < 1e-3, `avg render dt ${avg}`);
  console.log('ok cap30: renders', c.renders, 'avg dt', avg.toFixed(4));
}

// fps cap 24 on 60 Hz: exact average rate thanks to the remainder (10 s → 240 ± 2)
{
  const c = simulate({ frames: 600, fpsCap: 24 });
  assert.ok(Math.abs(c.renders - 240) <= 2, `renders ${c.renders}`);
  console.log('ok cap24: renders', c.renders);
}

// fixed timestep: exactly one tick per rendered frame, alpha 1, even with a cap
{
  const c = simulate({ frames: 600, fixed: true, fpsCap: 20 });
  assert.equal(c.ticks, c.renders);
  assert.ok(Math.abs(c.renders - 200) <= 2, `renders ${c.renders}`);
  assert.ok(c.alphas.every((a) => a === 1));
  console.log('ok fixed: ticks == renders ==', c.ticks);
}

// timeScale 2 doubles ticks; timeScale 0 freezes the simulation but keeps rendering
{
  const fast = simulate({ frames: 600, timeScale: 2 });
  assert.ok(Math.abs(fast.ticks - 600) <= 2, `ticks ${fast.ticks}`);
  const frozen = simulate({ frames: 120, timeScale: 0 });
  assert.equal(frozen.ticks, 0);
  assert.equal(frozen.renders, 120);
  console.log('ok timeScale: x2 →', fast.ticks, 'ticks; x0 →', frozen.ticks, 'ticks');
}

// a 2 s stall is clamped to 0.25 s of simulation (no spiral of death)
{
  const c = simulate({ frames: 2, frameMs: 2000 });
  assert.ok(c.ticks <= Math.ceil(0.25 * 30) + 1, `ticks after stall ${c.ticks}`);
  console.log('ok clamp: ticks after 2 s stall', c.ticks);
}

// hidden document: no ticks/renders while hidden, and no dt spike on return
{
  const c = simulate({ frames: 300, hiddenFrom: 100, hiddenTo: 200 });
  assert.ok(Math.abs(c.ticks - 100) <= 2, `ticks ${c.ticks}`);
  assert.equal(c.renders, 200);
  assert.ok(c.maxTickDt <= 1 / 30 + 1e-9);
  console.log('ok hidden: ticks', c.ticks, 'renders', c.renders);
}

// start() twice is a no-op and the loop ignores bogus rates
{
  let pending = null;
  const loop = createLoop({ tick() {}, render() {}, getTickRate: () => NaN, raf: (cb) => { pending = cb; return 7; }, caf: () => { pending = null; }, now: () => 0, doc: { hidden: false } });
  loop.start(); loop.start();
  pending(0); pending(16);
  loop.stop();
  console.log('ok guards');
}

console.log('LOOP OK');
