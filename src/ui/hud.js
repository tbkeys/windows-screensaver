/**
 * Win95-styled HUD: a status window ("3D Maze"), a fake taskbar with a Start button and
 * a live clock, a full-screen fade overlay and tooltip-style toasts.
 *
 * Also exports the small DOM helpers (`createWin95Window`, `makeDraggable`) that
 * `gui.js` reuses for the settings window, so both windows share one chrome.
 */

const STAT_ROWS = [
  ['fps', 'FPS'],
  ['seed', 'Seed'],
  ['algorithm', 'Algorithm'],
  ['size', 'Size'],
  ['steps', 'Steps'],
  ['state', 'State'],
  ['strategy', 'Strategy'],
];

/** Windows flag (four waving panes with a trailing streak), 16×14. */
const START_FLAG_SVG =
  '<svg viewBox="0 0 16 14" aria-hidden="true">' +
  '<path d="M0 4h2v1H0zM0 7h2v1H0zM0 10h2v1H0z" fill="#000"/>' +
  '<g transform="skewY(-8) translate(3 2.4)">' +
  '<rect x="0" y="0" width="5.5" height="5" fill="#ff0000"/>' +
  '<rect x="6.5" y="0" width="5.5" height="5" fill="#00a000"/>' +
  '<rect x="0" y="6" width="5.5" height="5" fill="#0000ff"/>' +
  '<rect x="6.5" y="6" width="5.5" height="5" fill="#ffff00"/>' +
  '<path d="M-0.5 -0.5h13v12h-13z" fill="none" stroke="#000" stroke-width="1"/>' +
  '</g></svg>';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Write `text` into `node` only when it differs (keeps per-frame HUD updates cheap). */
const setText = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};

const formatStat = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return String(v ?? '');
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

const readJson = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode / quota) – position just won't persist */
  }
};

/**
 * Build a Win95 window shell: `.w95-window` > `.w95-titlebar` (title, minimise, close)
 * followed by an empty `body` element the caller fills.
 * Minimise rolls the window up to its title bar; close invokes `onClose`.
 * @param {{ title: string, className?: string, onClose?: () => void }} opts
 */
export function createWin95Window({ title, className = '', onClose }) {
  const root = el('div', `w95-window ${className}`.trim());
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', title);

  const titlebar = el('div', 'w95-titlebar');
  titlebar.appendChild(el('span', 'w95-title', title));
  const minBtn = el('button', 'w95-titlebtn w95-titlebtn-min');
  minBtn.type = 'button';
  minBtn.setAttribute('aria-label', 'Minimize');
  const closeBtn = el('button', 'w95-titlebtn w95-titlebtn-close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  titlebar.append(minBtn, closeBtn);

  const body = el('div', 'w95-body');
  root.append(titlebar, body);

  const setCollapsed = (collapsed) => root.classList.toggle('w95-collapsed', collapsed);
  minBtn.addEventListener('click', () => setCollapsed(!root.classList.contains('w95-collapsed')));
  if (onClose) closeBtn.addEventListener('click', onClose);

  return {
    root,
    titlebar,
    body,
    setCollapsed,
    setVisible(visible) {
      root.classList.toggle('w95-hidden', !visible);
    },
    isVisible() {
      return !root.classList.contains('w95-hidden');
    },
    destroy() {
      root.remove();
    },
  };
}

/**
 * Make a fixed-position element draggable by `handle` (pointer events, clamped to the
 * viewport). With `storageKey` the position is restored from / saved to localStorage.
 * Call after the element is in the DOM (restoring needs its size).
 * @returns {{ destroy(): void }}
 */
export function makeDraggable(target, handle, { storageKey } = {}) {
  handle.classList.add('w95-draggable');

  const place = (x, y) => {
    const maxX = Math.max(0, window.innerWidth - target.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - handle.offsetHeight - 34); // keep the title bar above the taskbar
    target.style.left = `${Math.round(clamp(x, 0, maxX))}px`;
    target.style.top = `${Math.round(clamp(y, 0, maxY))}px`;
    target.style.right = 'auto';
    target.style.bottom = 'auto';
  };

  const saved = storageKey ? readJson(storageKey) : null;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) place(saved.x, saved.y);

  let drag = null;
  const onDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const rect = target.getBoundingClientRect();
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e) => {
    if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy);
  };
  const onUp = (e) => {
    if (!drag) return;
    drag = null;
    handle.releasePointerCapture(e.pointerId);
    if (storageKey) writeJson(storageKey, { x: target.offsetLeft, y: target.offsetTop });
  };
  const onResize = () => {
    if (target.style.left) place(target.offsetLeft, target.offsetTop);
  };

  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', onResize);

  return {
    destroy() {
      handle.removeEventListener('pointerdown', onDown);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
    },
  };
}

/** HH:MM clock in `node`, refreshed on every minute boundary. Returns a stop function. */
function startClock(node) {
  const pad = (n) => String(n).padStart(2, '0');
  const update = () => {
    const d = new Date();
    setText(node, `${pad(d.getHours())}:${pad(d.getMinutes())}`);
  };
  update();
  let interval = 0;
  const timeout = setTimeout(() => {
    update();
    interval = setInterval(update, 60_000);
  }, 60_000 - (Date.now() % 60_000) + 50);
  return () => {
    clearTimeout(timeout);
    clearInterval(interval);
  };
}

/**
 * Create the HUD.
 * @param {HTMLElement} container  element to mount into (usually `document.body`)
 * @param {{ onStart?: () => void, onVisibilityChange?: (visible: boolean) => void }} [opts]
 *   `onStart` fires when the taskbar Start button is clicked (app.js toggles the GUI).
 *   `onVisibilityChange` fires only for USER-initiated hide/show of the status window
 *   (its close button / taskbar task button), so app.js can mirror `screensaver.showHud`.
 */
export function createHud(container, { onStart, onVisibilityChange } = {}) {
  /* --- status window --- */
  const win = createWin95Window({ title: '3D Maze', className: 'w95-hud', onClose: () => userSetVisible(false) });
  const grid = el('dl', 'w95-stats');
  const valueNodes = {};
  const lastText = {};
  for (const [key, label] of STAT_ROWS) {
    grid.appendChild(el('dt', '', label));
    valueNodes[key] = grid.appendChild(el('dd', '', '–'));
    lastText[key] = '–';
  }
  win.body.appendChild(grid);
  container.appendChild(win.root);
  const dragger = makeDraggable(win.root, win.titlebar, { storageKey: 'win95maze.hudPos' });

  /* --- taskbar --- */
  const taskbar = el('div', 'w95-taskbar');
  const startBtn = el('button', 'w95-button w95-start');
  startBtn.type = 'button';
  startBtn.innerHTML = START_FLAG_SVG;
  startBtn.appendChild(el('span', '', 'Start'));
  startBtn.title = 'Settings';
  const taskBtn = el('button', 'w95-button w95-task w95-active', '3D Maze');
  taskBtn.type = 'button';
  taskBtn.title = 'Show / hide the status window';
  const tray = el('div', 'w95-tray');
  const clock = el('span', 'w95-clock');
  tray.appendChild(clock);
  taskbar.append(startBtn, el('div', 'w95-taskbar-sep'), taskBtn, el('div', 'w95-taskbar-spacer'), tray);
  container.appendChild(taskbar);
  const stopClock = startClock(clock);

  const setVisible = (visible) => {
    win.setVisible(visible);
    taskBtn.classList.toggle('w95-active', visible);
  };
  const userSetVisible = (visible) => {
    setVisible(visible);
    onVisibilityChange?.(visible);
  };
  const onStartClick = () => onStart?.();
  const onTaskClick = () => userSetVisible(!win.isVisible());
  startBtn.addEventListener('click', onStartClick);
  taskBtn.addEventListener('click', onTaskClick);

  /* --- fade overlay --- */
  let overlay = document.getElementById('fade-overlay');
  const ownsOverlay = !overlay;
  if (ownsOverlay) {
    overlay = el('div');
    overlay.id = 'fade-overlay';
    container.appendChild(overlay);
  }
  let overlayAlpha = -1;
  let overlayColor = '';
  let flashRaf = 0;
  const applyOverlay = (alpha, color) => {
    if (color !== overlayColor) {
      overlayColor = color;
      overlay.style.background = color;
    }
    const a = clamp(alpha, 0, 1);
    if (a !== overlayAlpha) {
      overlayAlpha = a;
      overlay.style.opacity = a === 0 ? '0' : a.toFixed(3);
    }
  };
  const cancelFlash = () => {
    if (flashRaf) cancelAnimationFrame(flashRaf);
    flashRaf = 0;
  };

  /* --- toast --- */
  const toast = el('div', 'w95-toast');
  toast.setAttribute('role', 'status');
  container.appendChild(toast);
  let toastTimer = 0;

  return {
    /** Update the key/value grid; only changed values touch the DOM. Partial objects are fine. */
    setStats(stats) {
      for (const key in stats) {
        const node = valueNodes[key];
        if (!node) continue;
        const text = formatStat(stats[key]);
        if (text !== lastText[key]) {
          lastText[key] = text;
          node.textContent = text;
        }
      }
    },

    /** Show or hide the status window (does not fire `onVisibilityChange`). */
    setVisible,

    setTaskbarVisible(visible) {
      taskbar.classList.toggle('w95-hidden', !visible);
    },

    /** Set the full-screen overlay opacity (cancels a running flash). */
    setOverlayAlpha(alpha, color = '#000000') {
      cancelFlash();
      applyOverlay(alpha, color);
    },

    /** Flash the screen: overlay jumps to `color` at full opacity and eases back to 0. */
    flash(color = '#ffffff', durationMs = 350) {
      cancelFlash();
      applyOverlay(1, color);
      const start = performance.now();
      const step = (now) => {
        const t = clamp((now - start) / Math.max(1, durationMs), 0, 1);
        applyOverlay((1 - t) * (1 - t), color);
        flashRaf = t < 1 ? requestAnimationFrame(step) : 0;
      };
      flashRaf = requestAnimationFrame(step);
    },

    /** Tooltip-style message at the bottom centre, auto-hidden after `ms`. */
    showToast(text, ms = 2500) {
      clearTimeout(toastTimer);
      toast.textContent = text;
      toast.classList.add('w95-visible');
      toastTimer = setTimeout(() => toast.classList.remove('w95-visible'), ms);
    },

    destroy() {
      cancelFlash();
      clearTimeout(toastTimer);
      stopClock();
      dragger.destroy();
      startBtn.removeEventListener('click', onStartClick);
      taskBtn.removeEventListener('click', onTaskClick);
      win.destroy();
      taskbar.remove();
      toast.remove();
      if (ownsOverlay) overlay.remove();
    },
  };
}
