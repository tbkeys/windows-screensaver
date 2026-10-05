/**
 * User-activity tracking behind the screensaver behaviours: cursor auto-hide after
 * `hideCursorAfter` seconds, entering screensaver mode after `idleStart` seconds, and
 * "any input exits screensaver mode". Pointer/touch events are observed on the window;
 * keys are reported by app.js (its keydown handler decides whether to swallow them).
 * Timers are polled from `update(nowMs)` once per rendered frame, so there is nothing
 * to cancel and a throttled frame rate cannot miss them.
 */

/** Pointer travel (px) that counts as input while armed – ignores sensor jitter. */
const EXIT_DISTANCE = 5;
/** Grace period after arming, so the click that enabled screensaver mode does not end it. */
const ARM_GRACE_MS = 400;
const CURSOR_CLASS = 'hide-cursor';

/**
 * @param {object} opts
 * @param {() => number} opts.getHideCursorAfter seconds of inactivity before hiding the cursor (0 = never)
 * @param {() => number} opts.getIdleStart       seconds of inactivity before `onIdle` (0 = off)
 * @param {() => void} opts.onIdle               called once when idle long enough (while not armed)
 * @param {() => void} opts.onInput              called on pointer input while armed
 * @param {HTMLElement} [opts.body]
 */
export function createActivityWatcher({ getHideCursorAfter, getIdleStart, onIdle, onInput, body = document.body }) {
  let lastInput = performance.now();
  let pointerX = NaN;
  let pointerY = NaN;
  let armed = false;
  let armedAt = 0;
  let armedX = NaN;
  let armedY = NaN;
  let cursorHidden = false;

  const noteInput = () => { lastInput = performance.now(); };

  const inputWhileArmed = () => {
    if (armed && performance.now() - armedAt > ARM_GRACE_MS) onInput();
  };

  const onPointerMove = (e) => {
    const moved = Number.isNaN(armedX) ? 0 : Math.hypot(e.clientX - armedX, e.clientY - armedY);
    pointerX = e.clientX;
    pointerY = e.clientY;
    if (armed && Number.isNaN(armedX)) {
      armedX = pointerX;
      armedY = pointerY;
      return;
    }
    noteInput();
    if (moved > EXIT_DISTANCE) inputWhileArmed();
  };
  /** Clicks, taps and wheel turns count as deliberate input: they wake the screensaver at once. */
  const onPointerDown = () => {
    noteInput();
    inputWhileArmed();
  };

  window.addEventListener('mousemove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('touchstart', onPointerDown, { passive: true });
  window.addEventListener('wheel', onPointerDown, { passive: true });

  const setCursorHidden = (hidden) => {
    if (hidden === cursorHidden) return;
    cursorHidden = hidden;
    body.classList.toggle(CURSOR_CLASS, hidden);
  };

  return {
    /** Record non-pointer input (keys), for the cursor and idle timers. */
    noteInput,
    /** Enter the "exit on any input" state: the cursor hides and the pointer baseline is taken. */
    arm() {
      armed = true;
      armedAt = performance.now();
      armedX = pointerX;
      armedY = pointerY;
    },
    disarm() {
      armed = false;
      noteInput();
    },
    /** Poll the timers; call once per rendered frame. */
    update(now = performance.now()) {
      const idle = (now - lastInput) / 1000;
      const hideAfter = Number(getHideCursorAfter()) || 0;
      setCursorHidden(armed || (hideAfter > 0 && idle >= hideAfter));
      const idleStart = Number(getIdleStart()) || 0;
      if (!armed && idleStart > 0 && idle >= idleStart) onIdle();
    },
    dispose() {
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('wheel', onPointerDown);
      setCursorHidden(false);
    },
  };
}
