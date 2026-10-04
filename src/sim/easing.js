/**
 * Easing curves, progress quantisation and small angle/lerp helpers shared by the
 * walker, the finish transitions and the camera rig. Pure functions, no three.js.
 */

const TWO_PI = Math.PI * 2;

/** Clamp to [0, 1]. Non-finite input becomes 0. */
export const clamp01 = (p) => (p <= 0 || !(p === p) ? 0 : p >= 1 ? 1 : p);

/** Linear interpolation a→b by t (unclamped). */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Wrap an angle (radians) into (−π, π]. */
export function normalizeAngle(a) {
  let r = a % TWO_PI;
  if (r > Math.PI) r -= TWO_PI;
  else if (r <= -Math.PI) r += TWO_PI;
  return r;
}

/** Signed shortest rotation (radians) that takes angle `from` to angle `to`. */
export const shortestAngleDelta = (from, to) => normalizeAngle(to - from);

/** Interpolate two angles along the shortest arc; the result continues from `from` unwrapped. */
export const lerpAngle = (from, to, t) => from + shortestAngleDelta(from, to) * t;

/**
 * Easing curves, keyed by the ids in `ENUMS.easings`. Every curve maps 0→0 and 1→1
 * and is monotonic on [0, 1]; inputs are expected to be clamped (see `ease`).
 */
export const EASINGS = Object.freeze({
  linear: (p) => p,
  smooth: (p) => p * p * (3 - 2 * p),
  easeInOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  easeOut: (p) => 1 - Math.pow(1 - p, 3),
  easeIn: (p) => p * p * p,
  snap: (p) => (p >= 1 ? 1 : 0),
});

/** Apply the easing curve `id` to progress `p` (clamped to [0, 1]); unknown ids fall back to linear. */
export function ease(id, p) {
  const fn = EASINGS[id] || EASINGS.linear;
  return fn(clamp01(p));
}

/**
 * Snap progress to `n` discrete sub-steps (`floor(p * n) / n`), reproducing the chunky
 * cadence of the original even at high frame rates. `n <= 0` leaves `p` untouched and
 * `p >= 1` always yields exactly 1 so a phase can finish cleanly.
 */
export function quantize(p, n) {
  if (p >= 1) return 1;
  return n > 0 ? Math.floor(p * n) / n : p;
}
