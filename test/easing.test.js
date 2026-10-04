import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EASINGS, ease, quantize, clamp01, lerp, normalizeAngle, shortestAngleDelta, lerpAngle,
} from '../src/sim/easing.js';
import {
  createFinishTransition, createTeleportFlash, createRollAnimator, FINISH_TRANSITION_KINDS,
} from '../src/sim/transitions.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

describe('easing curves', () => {
  test('every curve hits 0 at 0 and 1 at 1 and is monotonic', () => {
    assert.deepEqual(Object.keys(EASINGS).sort(), ['easeIn', 'easeInOut', 'easeOut', 'linear', 'smooth', 'snap']);
    for (const [id, fn] of Object.entries(EASINGS)) {
      assert.equal(fn(0), 0, `${id}(0)`);
      assert.equal(fn(1), 1, `${id}(1)`);
      let prev = -Infinity;
      for (let i = 0; i <= 1000; i++) {
        const v = fn(i / 1000);
        assert.ok(v >= prev - 1e-12, `${id} not monotonic at ${i / 1000}`);
        assert.ok(v >= 0 && v <= 1, `${id} out of range at ${i / 1000}`);
        prev = v;
      }
    }
  });

  test('curves have their characteristic shape at the midpoint', () => {
    close(EASINGS.linear(0.5), 0.5);
    close(EASINGS.smooth(0.5), 0.5);
    close(EASINGS.easeInOut(0.5), 0.5);
    assert.ok(EASINGS.easeIn(0.5) < 0.5);
    assert.ok(EASINGS.easeOut(0.5) > 0.5);
    assert.equal(EASINGS.snap(0.999), 0);
    assert.equal(EASINGS.snap(1), 1);
    assert.ok(EASINGS.easeIn(0.25) < EASINGS.smooth(0.25) && EASINGS.smooth(0.25) < EASINGS.easeOut(0.25));
  });

  test('ease() clamps progress and falls back to linear for unknown ids', () => {
    assert.equal(ease('linear', -1), 0);
    assert.equal(ease('linear', 2), 1);
    assert.equal(ease('easeIn', NaN), 0);
    assert.equal(ease('nonsense', 0.3), 0.3);
    assert.equal(ease(undefined, 0.7), 0.7);
    close(ease('smooth', 0.25), 0.15625);
  });

  test('quantize snaps to n sub-steps, leaves p alone for n <= 0 and returns exactly 1 at the end', () => {
    assert.equal(quantize(0.3, 4), 0.25);
    assert.equal(quantize(0.999, 4), 0.75);
    assert.equal(quantize(0.5, 4), 0.5);
    assert.equal(quantize(0.3, 0), 0.3);
    assert.equal(quantize(0.3, -2), 0.3);
    assert.equal(quantize(1, 4), 1);
    assert.equal(quantize(1.2, 4), 1);
    assert.equal(quantize(1, 0), 1);
    const seen = new Set();
    for (let i = 0; i <= 100; i++) seen.add(quantize(i / 100, 4));
    assert.deepEqual([...seen].sort(), [0, 0.25, 0.5, 0.75, 1]);
  });

  test('clamp01 and lerp', () => {
    assert.equal(clamp01(-0.5), 0);
    assert.equal(clamp01(1.5), 1);
    assert.equal(clamp01(0.25), 0.25);
    assert.equal(clamp01(NaN), 0);
    assert.equal(lerp(2, 4, 0.25), 2.5);
  });

  test('angle helpers wrap into (-π, π] and take the short way round', () => {
    close(normalizeAngle(3 * Math.PI / 2), -Math.PI / 2);
    close(normalizeAngle(-3 * Math.PI / 2), Math.PI / 2);
    close(normalizeAngle(Math.PI), Math.PI);
    close(normalizeAngle(-Math.PI), Math.PI);
    close(normalizeAngle(7 * Math.PI), Math.PI);
    close(normalizeAngle(0.3), 0.3);
    close(shortestAngleDelta(-3 * Math.PI / 2, 0), -Math.PI / 2);
    close(shortestAngleDelta(0.1, -0.1), -0.2);
    close(lerpAngle(-3 * Math.PI / 2, 0, 0.5), -3 * Math.PI / 2 - Math.PI / 4);
    close(normalizeAngle(lerpAngle(-3 * Math.PI / 2, 0, 0.5)), Math.PI / 4);
  });
});

/* Transitions are thin compositions of the easing curves, so they are verified here. */

const run = (anim, duration, steps = 100) => {
  let done = false;
  for (let i = 0; i < steps && !done; i++) done = anim.update(duration / steps);
  return done;
};

describe('finish transitions', () => {
  test('every kind progresses to done with camera offsets neutral at start', () => {
    assert.deepEqual([...FINISH_TRANSITION_KINDS].sort(), ['drop', 'fade', 'none', 'spin', 'swirl', 'zoom']);
    for (const kind of FINISH_TRANSITION_KINDS) {
      const t = createFinishTransition(kind, 2);
      if (kind !== 'none') {
        assert.equal(t.done, false, kind);
        assert.equal(t.progress, 0);
        assert.deepEqual(t.cameraOffset, { yaw: 0, pitch: 0, roll: 0, dolly: 0, fovScale: 1, drop: 0 });
        assert.equal(t.overlayAlpha, 0);
        assert.equal(t.update(1), false);
        close(t.progress, 0.5);
      }
      assert.equal(run(t, 2), true, kind);
      assert.equal(t.progress, 1);
      assert.equal(t.done, true);
      assert.equal(t.update(0.1), true, 'stays done');
      assert.equal(t.progress, 1);
    }
  });

  test("'none' is done on construction without any overlay; a zero duration finishes instantly", () => {
    const none = createFinishTransition('none', 5);
    assert.equal(none.done, true);
    assert.equal(none.overlayAlpha, 0);
    assert.equal(none.update(0.016), true);
    const zero = createFinishTransition('spin', 0);
    assert.equal(zero.done, true);
    assert.equal(zero.overlayAlpha, 1);
  });

  test('fade ramps the overlay 0→1 linearly', () => {
    const t = createFinishTransition('fade', 1);
    t.update(0.25);
    close(t.overlayAlpha, 0.25);
    t.update(0.75);
    assert.equal(t.overlayAlpha, 1);
    assert.deepEqual(t.cameraOffset, { yaw: 0, pitch: 0, roll: 0, dolly: 0, fovScale: 1, drop: 0 });
  });

  test('spin accelerates through two full clockwise turns and fades in the last 40%', () => {
    const t = createFinishTransition('spin', 1);
    t.update(0.5);
    assert.equal(t.overlayAlpha, 0, 'no overlay before 60%');
    const halfway = t.cameraOffset.yaw;
    assert.ok(halfway < 0 && Math.abs(halfway) < 2 * Math.PI, 'slow start');
    t.update(0.3);
    assert.ok(t.overlayAlpha > 0 && t.overlayAlpha < 1);
    t.update(0.2);
    close(t.cameraOffset.yaw, -4 * Math.PI);
    close(t.cameraOffset.roll, 0, 1e-9);
    assert.equal(t.overlayAlpha, 1);
  });

  test('zoom dollies 0.45 cell forward while the FOV narrows to 35%', () => {
    const t = createFinishTransition('zoom', 1);
    t.update(0.5);
    assert.ok(t.cameraOffset.dolly > 0 && t.cameraOffset.dolly < 0.45);
    assert.ok(t.cameraOffset.fovScale < 1 && t.cameraOffset.fovScale > 0.35);
    assert.equal(t.overlayAlpha, 0);
    run(t, 0.5);
    close(t.cameraOffset.dolly, 0.45);
    close(t.cameraOffset.fovScale, 0.35);
    assert.equal(t.overlayAlpha, 1);
  });

  test('drop lowers the eye with gravity easing and tilts the pitch down', () => {
    const t = createFinishTransition('drop', 1);
    t.update(0.5);
    close(t.cameraOffset.drop, 1.6 * 0.25);
    assert.ok(t.cameraOffset.pitch < 0);
    run(t, 0.5);
    close(t.cameraOffset.drop, 1.6);
    close(t.cameraOffset.pitch, -0.7);
    assert.equal(t.overlayAlpha, 1);
  });

  test('swirl swings yaw both ways, rolls a full 360° and widens the FOV', () => {
    const t = createFinishTransition('swirl', 1);
    t.update(0.25);
    assert.ok(t.cameraOffset.yaw > 0);
    t.update(0.5);
    assert.ok(t.cameraOffset.yaw < 0);
    run(t, 0.25);
    close(t.cameraOffset.yaw, 0);
    close(t.cameraOffset.roll, 2 * Math.PI);
    close(t.cameraOffset.fovScale, 1.6);
    assert.equal(t.overlayAlpha, 1);
  });

  test('unknown kinds fall back to fade', () => {
    const t = createFinishTransition('wibble', 1);
    assert.equal(t.kind, 'fade');
    t.update(0.5);
    close(t.overlayAlpha, 0.5);
  });
});

describe('teleport flash', () => {
  test('starts fully white and decays to zero', () => {
    const f = createTeleportFlash(0.5);
    assert.equal(f.overlayAlpha, 1);
    assert.equal(f.color, '#ffffff');
    assert.equal(f.update(0.1), false);
    assert.ok(f.overlayAlpha < 0.6, 'fast initial decay');
    let prev = f.overlayAlpha;
    for (let i = 0; i < 3; i++) { f.update(0.1); assert.ok(f.overlayAlpha < prev); prev = f.overlayAlpha; }
    assert.equal(f.update(0.1), true);
    assert.equal(f.overlayAlpha, 0);
    assert.equal(createTeleportFlash(0).done, true);
  });
});

describe('roll animator', () => {
  test('eases 0→π with easeInOut and reports when idle', () => {
    const a = createRollAnimator();
    assert.equal(a.update(1), true, 'idle before any target');
    a.setTarget(Math.PI, 1);
    assert.equal(a.active, true);
    assert.equal(a.update(0.25), false);
    assert.ok(a.roll > 0 && a.roll < Math.PI / 2, 'slow start');
    a.update(0.25);
    close(a.roll, Math.PI / 2);
    assert.equal(a.update(0.5), true);
    assert.equal(a.roll, Math.PI);
    assert.equal(a.active, false);
  });

  test('toggle flips between upright and upside-down; retargeting continues from the current roll', () => {
    const a = createRollAnimator();
    a.toggle(1);
    assert.equal(a.target, Math.PI);
    a.update(0.3);
    const midway = a.roll;
    assert.ok(midway > 0 && midway < Math.PI);
    a.toggle(1);
    assert.equal(a.target, 0);
    assert.equal(a.roll, midway, 'no jump on retarget');
    a.update(0.01);
    assert.ok(a.roll < midway && a.roll > midway - 0.05, 'heads back smoothly');
    run(a, 1);
    assert.equal(a.roll, 0);
    a.setTarget(Math.PI, 0);
    assert.equal(a.roll, Math.PI, 'zero duration snaps');
    assert.equal(a.active, false);
  });
});
