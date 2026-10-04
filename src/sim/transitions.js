/**
 * Camera-side animations that are not part of the grid walk: the finish-of-maze
 * transition, the white teleport flash and the smiley "upside-down" roll.
 *
 * Each animator is a plain object whose `update(dt)` advances it, returns `true` once
 * finished, and mutates its own fields in place (no per-frame allocation). The app
 * reads `cameraOffset` and adds it on top of the walker pose:
 *   yaw/pitch/roll – radians (pitch < 0 looks down, like `tilt.rotation.x`);
 *   dolly          – cells to push the eye forward along the view direction;
 *   drop           – cells to lower the eye;
 *   fovScale       – multiply the configured FOV.
 * `overlayAlpha` is the opacity of the full-screen overlay in `color`.
 */
import { ease, clamp01, lerp } from './easing.js';

const TWO_PI = Math.PI * 2;

/** 0→1 over the last `(1 - start)` of the transition, smoothstepped. */
const tailFade = (p, start) => ease('smooth', (p - start) / (1 - start));

/** Each kind writes camera offsets for progress `p` and returns the overlay alpha. */
const KINDS = {
  none: () => 0,
  fade: (p) => p,
  spin(p, o) {
    o.yaw = -2 * TWO_PI * ease('easeIn', p);
    o.roll = 0.08 * Math.sin(p * Math.PI * 5) * (1 - p);
    return tailFade(p, 0.6);
  },
  zoom(p, o) {
    o.dolly = 0.45 * ease('easeInOut', p);
    o.fovScale = lerp(1, 0.35, ease('easeIn', p));
    return tailFade(p, 0.7);
  },
  drop(p, o) {
    o.drop = 1.6 * p * p;
    o.pitch = -0.7 * ease('easeIn', p);
    return tailFade(p, 0.65);
  },
  swirl(p, o) {
    o.yaw = 0.9 * Math.sin(p * TWO_PI);
    o.roll = TWO_PI * ease('easeInOut', p);
    o.fovScale = lerp(1, 1.6, ease('smooth', p));
    return tailFade(p, 0.6);
  },
};

/** Ids accepted by `createFinishTransition`, in `ENUMS.finishTransitions` order of usefulness. */
export const FINISH_TRANSITION_KINDS = Object.freeze(Object.keys(KINDS));

const resetOffset = (o) => { o.yaw = 0; o.pitch = 0; o.roll = 0; o.dolly = 0; o.fovScale = 1; o.drop = 0; };

/**
 * Animation played when the walker reaches the finish.
 * @param {'none'|'fade'|'spin'|'zoom'|'drop'|'swirl'} kind unknown kinds fall back to `fade`
 * @param {number} duration seconds; `none` or a non-positive duration finishes on construction
 */
export function createFinishTransition(kind, duration) {
  const apply = KINDS[kind] || KINDS.fade;
  const total = kind === 'none' ? 0 : Math.max(0, Number(duration) || 0);
  let elapsed = 0;
  const t = {
    kind: KINDS[kind] ? kind : 'fade',
    duration: total,
    progress: 0,
    done: false,
    overlayAlpha: 0,
    color: '#000000',
    cameraOffset: { yaw: 0, pitch: 0, roll: 0, dolly: 0, fovScale: 1, drop: 0 },
    /** Advance by `dt` seconds; returns true when complete (and stays complete). */
    update(dt) {
      if (t.done) return true;
      elapsed += dt > 0 ? dt : 0;
      t.progress = total > 0 ? clamp01(elapsed / total) : 1;
      resetOffset(t.cameraOffset);
      t.overlayAlpha = clamp01(apply(t.progress, t.cameraOffset));
      t.done = t.progress >= 1;
      return t.done;
    },
  };
  if (total <= 0) t.update(0);
  return t;
}

/**
 * White flash after a teleport: overlay alpha 1→0 with a fast initial decay. With a black
 * `color` it doubles as the fade-in that reveals a freshly generated maze.
 * @param {number} duration seconds
 * @param {string} [color='#ffffff'] CSS colour of the overlay
 */
export function createTeleportFlash(duration, color = '#ffffff') {
  const total = Math.max(0, Number(duration) || 0);
  let elapsed = 0;
  const f = {
    duration: total,
    progress: 0,
    done: false,
    overlayAlpha: 1,
    color,
    update(dt) {
      if (f.done) return true;
      elapsed += dt > 0 ? dt : 0;
      f.progress = total > 0 ? clamp01(elapsed / total) : 1;
      f.overlayAlpha = 1 - ease('easeOut', f.progress);
      f.done = f.progress >= 1;
      return f.done;
    },
  };
  if (total <= 0) f.update(0);
  return f;
}

/**
 * Eases the camera roll between targets (0 ↔ π for the smiley flip) with easeInOut.
 * Retargeting mid-flight continues smoothly from the current roll.
 */
export function createRollAnimator() {
  let from = 0, duration = 0, elapsed = 0;
  const a = {
    roll: 0,
    target: 0,
    active: false,
    /** Animate from the current roll to `roll` radians over `seconds` (≤ 0 snaps). */
    setTarget(roll, seconds) {
      from = a.roll;
      a.target = roll;
      duration = Math.max(0, Number(seconds) || 0);
      elapsed = 0;
      a.active = true;
      if (duration <= 0) a.update(0);
      return a;
    },
    /** Flip between upright (0) and upside-down (π). */
    toggle(seconds) {
      return a.setTarget(a.target === 0 ? Math.PI : 0, seconds);
    },
    /** Advance by `dt` seconds; returns true while idle (target reached). */
    update(dt) {
      if (!a.active) return true;
      elapsed += dt > 0 ? dt : 0;
      const p = duration > 0 ? clamp01(elapsed / duration) : 1;
      a.roll = lerp(from, a.target, ease('easeInOut', p));
      if (p >= 1) { a.roll = a.target; a.active = false; }
      return !a.active;
    },
  };
  return a;
}
