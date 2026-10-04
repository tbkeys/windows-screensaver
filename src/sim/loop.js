/**
 * requestAnimationFrame loop with a fixed-timestep simulation accumulator and an
 * optional render-rate cap.
 *
 * Every frame: real elapsed time (clamped to 0.25 s, scaled by `timeScale`) feeds an
 * accumulator; `tick(tickDt)` runs while a whole tick fits; `render(alpha, dt)` runs
 * when the fps cap allows, with `alpha = accumulator / tickDt` for interpolation and
 * `dt` the simulated seconds since the previous render. With `getFixedTimestep()` true
 * real time is ignored and exactly one tick precedes every rendered frame (the way the
 * 1995 original slowed down with the machine). Ticks pause while the document is hidden
 * and resume without a time spike.
 */

const MAX_FRAME_DT = 0.25;
const MAX_TICKS_PER_FRAME = 64;
const MIN_TICK_RATE = 1;
const MAX_TICK_RATE = 1000;
/** Render slightly early so vsync jitter does not make a 30 fps cap skip to 20 fps. */
const CAP_SLACK = 0.0005;
const SMOOTHING = 0.1;

/**
 * @param {object} opts
 * @param {(dt:number) => void} opts.tick                simulation step, `dt` in seconds
 * @param {(alpha:number, dt:number) => void} opts.render draw a frame
 * @param {() => number} opts.getTickRate                 ticks per second (clamped 1..1000)
 * @param {() => number} [opts.getFpsCap]                 rendered frames per second, 0 = uncapped
 * @param {() => number} [opts.getTimeScale]              simulation speed multiplier (0 freezes)
 * @param {() => boolean} [opts.getFixedTimestep]         one tick per rendered frame when true
 * @param {Function} [opts.raf] / [opts.caf] / [opts.now] / [opts.doc] injectable for tests
 * @returns {{ start(): void, stop(): void, readonly running: boolean, readonly fps: number, readonly frameTime: number }}
 */
export function createLoop({
  tick,
  render,
  getTickRate,
  getFpsCap = () => 0,
  getTimeScale = () => 1,
  getFixedTimestep = () => false,
  raf = (cb) => globalThis.requestAnimationFrame(cb),
  caf = (id) => globalThis.cancelAnimationFrame(id),
  now = () => performance.now(),
  doc = globalThis.document,
} = {}) {
  let running = false;
  let frameId = 0;
  let lastTime = -1;        // rAF timestamp of the previous frame, -1 = unknown (no dt)
  let lastRenderTime = -1;  // rAF timestamp of the previous rendered frame
  let acc = 0;              // simulated seconds waiting to be ticked
  let sinceRender = 0;      // real seconds since the previous render (fps cap budget)
  let fps = 0;
  let frameTime = 0;

  const tickDelta = () => {
    const rate = Number(getTickRate());
    return 1 / (rate >= MIN_TICK_RATE ? Math.min(rate, MAX_TICK_RATE) : MIN_TICK_RATE);
  };
  const timeScale = () => {
    const s = Number(getTimeScale());
    return Number.isFinite(s) && s >= 0 ? s : 1;
  };
  const smooth = (prev, next) => (prev === 0 ? next : prev + (next - prev) * SMOOTHING);
  const onVisibility = () => { if (!doc.hidden) lastTime = -1; };

  function frame(time) {
    if (!running) return;
    frameId = raf(frame);
    if (doc && doc.hidden) { lastTime = -1; return; }

    const real = lastTime < 0 ? 0 : Math.max(0, (time - lastTime) / 1000);
    lastTime = time;
    const started = now();
    const scale = timeScale();
    const tickDt = tickDelta();
    const cap = Number(getFpsCap()) || 0;
    const interval = cap > 0 ? 1 / cap : 0;

    sinceRender += real;
    const renderDue = cap <= 0 || sinceRender >= interval - CAP_SLACK;

    let alpha;
    if (getFixedTimestep()) {
      if (!renderDue) return;
      tick(tickDt * scale);
      alpha = 1;
    } else {
      acc = Math.min(acc + Math.min(real, MAX_FRAME_DT) * scale, tickDt * MAX_TICKS_PER_FRAME);
      while (acc >= tickDt) { tick(tickDt); acc -= tickDt; }
      if (!renderDue) return;
      alpha = acc / tickDt;
    }

    const renderDt = Math.min(sinceRender, MAX_FRAME_DT) * scale;
    // Keep the remainder so the average rate is exact, but never bank more than one frame.
    sinceRender = cap > 0 ? Math.min(sinceRender - interval, interval) : 0;
    render(alpha, renderDt);

    if (lastRenderTime >= 0 && time > lastRenderTime) fps = smooth(fps, 1000 / (time - lastRenderTime));
    lastRenderTime = time;
    frameTime = smooth(frameTime, now() - started);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastTime = -1;
      lastRenderTime = -1;
      acc = 0;
      sinceRender = 1; // render the very first frame regardless of the cap
      if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibility);
      frameId = raf(frame);
    },
    stop() {
      if (!running) return;
      running = false;
      caf(frameId);
      if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility);
    },
    /** True between `start()` and `stop()`. */
    get running() { return running; },
    /** Smoothed rendered frames per second. */
    get fps() { return fps; },
    /** Smoothed CPU milliseconds spent in tick + render per rendered frame. */
    get frameTime() { return frameTime; },
  };
}
