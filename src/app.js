/**
 * Application wiring for the Win95 3D Maze.
 *
 * `createApp(canvas)` builds the renderer and camera rig, the world (maze, decorations,
 * rats, walker), routes config changes to the cheapest rebuild (see `ROUTES`), wires the
 * walker events to the classic easter eggs (polyhedron teleport, smiley flip, finish
 * transition), runs the frame loop, and owns input, screensaver behaviours, settings
 * persistence and the GUI/HUD actions. The returned app is also exposed as
 * `window.__maze` for the smoke test and debugging.
 *
 * Camera rig: `rig` (position + yaw) → `tilt` (pitch) → `camera` (roll, dolly).
 */
import * as THREE from 'three';
import { DEFAULTS, ENUMS, createConfig, deepClone, deepMerge } from './config/defaults.js';
import { PRESETS } from './config/presets.js';
import { createRng, randomSeedString } from './maze/rng.js';
import { generateMaze } from './maze/generator.js';
import { createNavigator } from './maze/navigator.js';
import { Walker } from './sim/walker.js';
import { createLoop } from './sim/loop.js';
import { createFinishTransition, createRollAnimator, createTeleportFlash } from './sim/transitions.js';
import { TextureCache, textureFromImage } from './render/textures.js';
import { createMaterialSet } from './render/materials.js';
import { buildMazeGroup } from './render/mazeMesh.js';
import { createLighting } from './render/lighting.js';
import { PostPipeline } from './render/post.js';
import { DecorationLayer, Rat, placeDecorations, teleportTarget } from './render/objects.js';
import { createGui } from './ui/gui.js';
import { createHud, createWin95Window } from './ui/hud.js';
import {
  IN_MEMORY_MARKER, MAX_PERSISTED_IMAGE_BYTES, TEXTURE_SLOTS,
  clearStoredSettings, decodeShareHash, downloadBlob, downloadText, encodeShareHash, exportSettingsJson,
  loadStoredSettings, parseSettingsJson, pickFile, readFileAsDataUrl, replaceUrl, sanitizeConfig, shareableDiff, storeSettings,
} from './app/settings.js';
import { createActivityWatcher } from './app/activity.js';

const ASPECT_RATIOS = { '4:3': 4 / 3, '5:4': 5 / 4, '16:9': 16 / 9, '16:10': 16 / 10 };
const MAX_PIXEL_RATIO = 2;
const DEG = Math.PI / 180;
/** Slider drags coalesce expensive rebuilds; a committed change applies immediately. */
const REBUILD_DEBOUNCE_MS = 150;
const SAVE_DEBOUNCE_MS = 400;
const HUD_INTERVAL_MS = 250;
/** Seconds between touching a polyhedron and landing somewhere else (the original's beat). */
const TELEPORT_BEAT = 0.05;
const TELEPORT_FLASH = 0.45;
/** Fade from black after a finish transition rebuilt the maze. */
const REGEN_FADE_IN = 0.5;
const ZERO_OFFSET = Object.freeze({ yaw: 0, pitch: 0, roll: 0, dolly: 0, fovScale: 1, drop: 0 });
const MANUAL_KEYS = {
  w: 'forward', arrowup: 'forward', s: 'back', arrowdown: 'back',
  a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right',
};

const labelOf = (list, id) => list.find(([key]) => key === id)?.[1] ?? String(id);
const isTypingTarget = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const fileStamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** Config from defaults + stored diff + share hash (the hash wins, then becomes the stored state). */
function loadConfig() {
  const config = createConfig();
  const fromHash = decodeShareHash(location.hash);
  if (config.screensaver.persistSettings) {
    const stored = loadStoredSettings();
    if (stored) deepMerge(config, stored);
  }
  if (fromHash) deepMerge(config, fromHash);
  sanitizeConfig(config);
  // Never boot frozen or with every control hidden; both are session states, not settings.
  config.movement.paused = false;
  config.screensaver.screensaverMode = false;
  if (fromHash) {
    if (config.screensaver.persistSettings) storeSettings(config);
    replaceUrl(location.pathname + location.search);
  }
  return config;
}

function tryCreateRenderer(canvas) {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    return { renderer, error: null };
  } catch (error) {
    return { renderer: null, error };
  }
}

/** Win95 message box shown when no WebGL context can be created. */
function showWebglError(error) {
  const win = createWin95Window({ title: '3D Maze', className: 'w95-dialog', onClose: () => win.destroy() });
  const message = document.createElement('p');
  message.textContent = 'This screensaver needs WebGL, which your browser could not provide. '
    + 'Enable hardware acceleration or try a different browser.';
  const detail = document.createElement('p');
  detail.className = 'w95-dialog-detail';
  detail.textContent = String(error?.message ?? error ?? 'WebGL unavailable');
  const buttons = document.createElement('div');
  buttons.className = 'w95-dialog-buttons';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'w95-button';
  ok.textContent = 'OK';
  ok.addEventListener('click', () => win.destroy());
  buttons.appendChild(ok);
  win.body.append(message, detail, buttons);
  document.body.appendChild(win.root);
  ok.focus();
}

/**
 * Create the application on `canvas`. Call `start()` on the result to run it.
 * @param {HTMLCanvasElement} canvas
 */
export function createApp(canvas) {
  const config = loadConfig();
  const { renderer, error } = tryCreateRenderer(canvas);
  if (!renderer) {
    showWebglError(error);
    const stub = { config, error, start() {}, stop() {}, dispose() {} };
    window.__maze = stub;
    return stub;
  }

  /* ------------------------------------------------------------ scene */

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(config.camera.fov, 1, config.camera.near, config.camera.far);
  camera.name = 'camera';
  const rig = new THREE.Object3D();
  rig.name = 'rig';
  const tilt = new THREE.Object3D();
  tilt.name = 'tilt';
  rig.add(tilt);
  tilt.add(camera);
  scene.add(rig);

  const lighting = createLighting(scene, camera);
  const post = new PostPipeline(renderer);
  const textureCache = new TextureCache({ seed: config.maze.seed });
  const materials = createMaterialSet(config, textureCache);
  const roll = createRollAnimator();
  const drawingSize = new THREE.Vector2();

  /* ------------------------------------------------------- world state */

  let rng = null;
  let maze = null;
  let decorations = null;
  let mazeGroup = null;
  let decorationLayer = null;
  let teleportRng = null;
  let walker = null;
  const rats = [];
  let mazeDirty = false;

  // Camera-side animation state (advanced per rendered frame in simulated seconds).
  let transition = null;
  let finishCountdown = -1;
  let teleportCountdown = -1;
  let flash = null;
  let fadeIn = null;
  let clock = 0;
  let lastHudUpdate = 0;
  let screensaverActive = false;

  /* -------------------------------------------------------- UI objects */

  const hud = createHud(document.body, {
    onStart: () => toggleGui(),
    onVisibilityChange: (visible) => {
      config.screensaver.showHud = visible;
      gui.refresh();
      saveSoon();
    },
  });

  const activity = createActivityWatcher({
    getHideCursorAfter: () => config.screensaver.hideCursorAfter,
    getIdleStart: () => config.screensaver.idleStart,
    onIdle: () => enterScreensaver(),
    onInput: () => exitScreensaver({ fromInput: true }),
  });

  /* --------------------------------------------------------- settings */

  let saveTimer = 0;
  function saveSoon() {
    if (!config.screensaver.persistSettings) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => storeSettings(config), SAVE_DEBOUNCE_MS);
  }

  /** Decode persisted uploads (data URLs) into the texture cache; drops references that fail. */
  function loadCustomImages() {
    for (const slot of TEXTURE_SLOTS) {
      const texture = config.textures[slot];
      if (typeof texture.custom !== 'string' || !texture.custom.startsWith('data:')) continue;
      textureCache.loadCustomImage(slot, texture.custom)
        .then(() => refreshMaterials())
        .catch(() => {
          texture.custom = null;
          if (texture.kind === 'custom') texture.kind = DEFAULTS.textures[slot].kind;
          refreshMaterials();
          gui.refresh();
        });
    }
  }

  /** Reset every leaf to its default in place (lil-gui keeps binding to the same objects). */
  function resetConfig({ seed = DEFAULTS.maze.seed } = {}) {
    deepMerge(config, deepClone(DEFAULTS));
    config.maze.seed = seed;
    for (const slot of TEXTURE_SLOTS) textureCache.setCustomImage(slot, null);
  }

  /** Re-apply everything after a wholesale config replacement (preset, import, reset). */
  function applyAll() {
    sanitizeConfig(config);
    resize();
    lighting.apply(config);
    rebuildWorld();
    loadCustomImages();
    if (config.screensaver.screensaverMode) enterScreensaver();
    else exitScreensaver();
    gui.refresh();
    saveSoon();
  }

  /* ----------------------------------------------------- change routing */

  /**
   * Path matcher → handler. The first match wins. `expensive` handlers are debounced while a
   * slider is still being dragged (`finished === false`). Everything not listed is read live.
   */
  const ROUTES = [
    ['maze.autoRegenerate', () => { if (config.maze.autoRegenerate && mazeDirty) rebuildWorld(); }],
    ['maze.', () => requestMazeRebuild(), true],
    ['textures.filtering', () => { refreshMaterials(); updateCanvasClass(); }, true],
    ['textures.', () => refreshMaterials(), true],
    ['lighting.mode', () => { lighting.apply(config); refreshMaterials(); }],
    ['lighting.faceShading', () => mazeGroup?.setFaceShading(config.lighting.faceShading)],
    ['lighting.floorShade', () => refreshMaterials()],
    ['lighting.ceilingShade', () => refreshMaterials()],
    ['lighting.', () => lighting.apply(config)],
    ['camera.aspectMode', () => resize()],
    ['camera.renderScale', () => resize()],
    ['movement.strategy', () => setStrategy(config.movement.strategy)],
    ['movement.manual', () => setManual(config.movement.manual)],
    ['movement.paused', () => gui.refresh()],
    ['objects.rat.enabled', () => rebuildRats()],
    ['objects.rat.count', () => rebuildRats(), true],
    ['objects.posters.', () => rebuildDecorations({ posters: true }), true],
    [/^objects\.(polyhedra|smiley)\.(enabled|count|placement|shape)$/, () => rebuildDecorations(), true],
    ['effects.pixelate', () => updateCanvasClass()],
    ['screensaver.showGui', () => applyUiVisibility()],
    ['screensaver.showHud', () => applyUiVisibility()],
    ['screensaver.showTaskbar', () => applyUiVisibility()],
    ['screensaver.screensaverMode', () => (config.screensaver.screensaverMode ? enterScreensaver() : exitScreensaver())],
    ['screensaver.persistSettings', () => (config.screensaver.persistSettings ? storeSettings(config) : clearStoredSettings())],
  ];
  const routeMatches = (matcher, path) => (matcher instanceof RegExp ? matcher.test(path)
    : matcher.endsWith('.') ? path.startsWith(matcher) : matcher === path);

  /** @type {Map<Function, number>} debounce timers keyed by handler */
  const pendingRebuilds = new Map();

  /** GUI `onChange` and the entry point for every programmatic config change. */
  function onConfigChange(path, value, finished = true) {
    const route = ROUTES.find(([matcher]) => routeMatches(matcher, path));
    if (route) {
      const [, handler, expensive] = route;
      clearTimeout(pendingRebuilds.get(handler));
      pendingRebuilds.delete(handler);
      if (expensive && !finished) {
        pendingRebuilds.set(handler, setTimeout(() => { pendingRebuilds.delete(handler); handler(); }, REBUILD_DEBOUNCE_MS));
      } else {
        handler();
      }
    }
    if (finished) saveSoon();
  }

  function requestMazeRebuild() {
    if (config.maze.autoRegenerate) {
      rebuildWorld();
    } else if (!mazeDirty) {
      mazeDirty = true;
      hud.showToast('Maze settings changed – press R or Regenerate to apply');
    }
  }

  /** After any textures.* / shade / lighting-mode change; re-points meshes when materials were rebuilt. */
  function refreshMaterials() {
    if (materials.refresh()) mazeGroup?.refreshMaterials();
  }

  function setStrategy(id) {
    walker.setNavigator(createNavigator(id, maze, rng.fork('nav')));
  }

  function setManual(manual) {
    config.movement.manual = manual;
    walker.clearQueue();
    hud.showToast(manual ? 'Manual drive: W/A/S/D or arrow keys' : 'Autopilot resumed', 1800);
  }

  /* ------------------------------------------------------------- world */

  function generateSafely() {
    try {
      return generateMaze({ ...config.maze });
    } catch (err) {
      console.warn('[app] maze settings rejected, restoring defaults:', err.message);
      deepMerge(config.maze, { ...deepClone(DEFAULTS.maze), seed: config.maze.seed });
      gui.refresh();
      return generateMaze({ ...config.maze });
    }
  }

  function buildMazeMesh() {
    mazeGroup?.dispose();
    mazeGroup = buildMazeGroup(maze, config, materials, decorations);
    scene.add(mazeGroup.group);
  }

  function buildDecorationLayer() {
    decorationLayer?.dispose();
    decorationLayer = new DecorationLayer(maze, config, decorations);
    scene.add(decorationLayer.group);
  }

  /** Re-place and rebuild the decorations for the current maze (same rng fork ⇒ stable positions). */
  function rebuildDecorations({ posters = false } = {}) {
    decorations = placeDecorations(maze, config, rng.fork('deco'));
    if (posters) buildMazeMesh(); // posters are baked into the maze geometry
    buildDecorationLayer();
  }

  function disposeRats() {
    for (const rat of rats) rat.dispose();
    rats.length = 0;
  }

  function rebuildRats() {
    disposeRats();
    const R = config.objects.rat;
    const count = R.enabled ? Math.max(0, Math.floor(R.count)) : 0;
    for (let i = 0; i < count; i++) {
      const rat = new Rat(maze, config, rng.fork(`rat${i}`));
      scene.add(rat.group);
      rats.push(rat);
    }
  }

  function disposeWorld() {
    disposeRats();
    decorationLayer?.dispose();
    decorationLayer = null;
    mazeGroup?.dispose();
    mazeGroup = null;
  }

  /** Generate the maze for `config.maze` and rebuild everything that depends on it. */
  function rebuildWorld() {
    cancelAnimations();
    disposeWorld();
    const seed = config.maze.seed;
    rng = createRng(seed);
    maze = generateSafely();
    teleportRng = rng.fork('teleport');
    textureCache.setSeed(seed);
    refreshMaterials();
    decorations = placeDecorations(maze, config, rng.fork('deco'));
    buildMazeMesh();
    buildDecorationLayer();

    const navigator = createNavigator(config.movement.strategy, maze, rng.fork('nav'));
    if (walker) {
      walker.cellSize = config.maze.cellSize;
      walker.setNavigator(navigator).setMaze(maze);
    } else {
      walker = new Walker({ maze, navigator, movement: config.movement, cellSize: config.maze.cellSize });
      walker.on('enterCell', onEnterCell);
      walker.on('finish', onFinish);
    }
    rebuildRats();
    roll.setTarget(0, 0);
    mazeDirty = false;
    updateHud();
  }

  /* ----------------------------------------------------- walker events */

  function onEnterCell({ x, y, teleported }) {
    if (teleported || !decorationLayer) return;
    const hit = decorationLayer.objectAt(x, y);
    if (!hit) return;
    if (hit.type === 'polyhedron' && config.objects.polyhedra.teleportOnTouch) teleportCountdown = TELEPORT_BEAT;
    else if (hit.type === 'smiley' && config.objects.smiley.flipOnTouch) roll.toggle(config.objects.smiley.flipDuration);
  }

  function onFinish() {
    finishCountdown = Math.max(0, config.objects.finish.pauseBefore);
  }

  function doTeleport() {
    const target = teleportTarget(maze, teleportRng, [maze.finish, walker.cell]);
    walker.teleport(target, target.heading);
    if (config.objects.polyhedra.flashOnTeleport) flash = createTeleportFlash(TELEPORT_FLASH);
  }

  function completeFinish() {
    const kind = transition.kind;
    transition = null;
    if (config.objects.finish.newSeedOnFinish) {
      config.maze.seed = randomSeedString();
      gui.refresh();
      saveSoon();
    }
    rebuildWorld();
    if (kind !== 'none') fadeIn = createTeleportFlash(REGEN_FADE_IN, '#000000');
  }

  function cancelAnimations() {
    transition = null;
    finishCountdown = -1;
    teleportCountdown = -1;
    flash = null;
    fadeIn = null;
  }

  /** Advance the camera-side animations by `dt` simulated seconds. */
  function advanceAnimations(dt) {
    if (teleportCountdown >= 0 && (teleportCountdown -= dt) <= 0) {
      teleportCountdown = -1;
      doTeleport();
    }
    if (finishCountdown >= 0 && (finishCountdown -= dt) <= 0) {
      finishCountdown = -1;
      transition = createFinishTransition(config.objects.finish.transition, config.objects.finish.duration);
    }
    if (transition && transition.update(dt)) completeFinish();
    if (flash && flash.update(dt)) flash = null;
    if (fadeIn && fadeIn.update(dt)) fadeIn = null;
    roll.update(dt);
  }

  /* ------------------------------------------------------------ camera */

  function applyCamera(alpha) {
    const C = config.camera;
    const pose = config.timing.interpolate ? walker.interpolatedPose(alpha) : walker.pose;
    const off = transition ? transition.cameraOffset : ZERO_OFFSET;
    const cellSize = config.maze.cellSize;
    rig.position.set(pose.x, C.height + pose.bob - off.drop * cellSize, pose.z);
    rig.rotation.y = pose.yaw + off.yaw;
    tilt.rotation.x = C.pitch * DEG + off.pitch;
    camera.rotation.z = roll.roll + off.roll;
    camera.position.z = -off.dolly * cellSize;
    const fov = C.fov * off.fovScale;
    if (camera.fov !== fov || camera.near !== C.near || camera.far !== C.far) {
      camera.fov = fov;
      camera.near = C.near;
      camera.far = C.far;
      camera.updateProjectionMatrix();
    }
  }

  function updateOverlay() {
    let alpha = 0;
    let color = '#000000';
    if (transition) {
      alpha = transition.overlayAlpha;
      color = transition.color;
    } else if (fadeIn) {
      alpha = fadeIn.overlayAlpha;
      color = fadeIn.color;
    }
    if (flash && flash.overlayAlpha > alpha) {
      alpha = flash.overlayAlpha;
      color = flash.color;
    }
    hud.setOverlayAlpha(alpha, color);
  }

  /** Letterbox the canvas for `camera.aspectMode`, size the post pipeline and the camera. */
  function resize() {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const ratio = ASPECT_RATIOS[config.camera.aspectMode];
    let width = vw;
    let height = vh;
    if (ratio) {
      if (vw / vh > ratio) width = Math.round(vh * ratio);
      else height = Math.round(vw / ratio);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(width, height);
    renderer.getDrawingBufferSize(drawingSize);
    post.setSize(drawingSize.x, drawingSize.y, config.camera.renderScale);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    updateCanvasClass();
  }

  function updateCanvasClass() {
    const crisp = config.camera.renderScale < 1 || config.effects.pixelate > 1 || config.textures.filtering === 'pixelated';
    canvas.classList.toggle('pixelated', crisp);
  }

  /* -------------------------------------------------------------- loop */

  function tick(dt) {
    walker.update(dt);
  }

  function render(alpha, dt) {
    clock += dt;
    advanceAnimations(dt);
    if (!config.movement.paused) for (const rat of rats) rat.update(dt);
    decorationLayer.update(dt, clock);
    applyCamera(alpha);
    updateOverlay();
    if (config.effects.noise > 0) post.setTime(clock);
    post.render(scene, camera, config.effects);

    const now = performance.now();
    activity.update(now);
    if (now - lastHudUpdate >= HUD_INTERVAL_MS) {
      lastHudUpdate = now;
      updateHud();
    }
  }

  const loop = createLoop({
    tick,
    render,
    getTickRate: () => config.timing.tickRate,
    getFpsCap: () => config.timing.fpsCap,
    getTimeScale: () => config.timing.timeScale,
    getFixedTimestep: () => config.timing.fixedTimestep,
  });

  function walkerStateLabel() {
    if (transition || finishCountdown >= 0) return 'finished';
    if (config.movement.paused) return 'paused';
    return walker.state;
  }

  function updateHud() {
    hud.setStats({
      fps: config.timing.showFps ? Math.round(loop.fps) : '–',
      seed: config.maze.seed,
      algorithm: config.maze.algorithm,
      size: `${maze.width}×${maze.height}`,
      steps: walker.stats.steps,
      state: walkerStateLabel(),
      strategy: config.movement.manual ? 'manual' : config.movement.strategy,
    });
  }

  /* ------------------------------------------------ screensaver & UI */

  function applyUiVisibility() {
    const S = config.screensaver;
    gui.setVisible(S.showGui && !screensaverActive);
    hud.setVisible(S.showHud && !screensaverActive);
    hud.setTaskbarVisible(S.showTaskbar && !screensaverActive);
  }

  function enterScreensaver() {
    if (screensaverActive) return;
    screensaverActive = true;
    config.screensaver.screensaverMode = true;
    activity.arm();
    applyUiVisibility();
    gui.refresh();
  }

  function exitScreensaver({ fromInput = false } = {}) {
    if (!screensaverActive) {
      applyUiVisibility();
      return;
    }
    screensaverActive = false;
    config.screensaver.screensaverMode = false;
    activity.disarm();
    applyUiVisibility();
    if (fromInput && config.screensaver.exitFullscreenOnInput && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    gui.refresh();
  }

  function toggleGui() {
    config.screensaver.showGui = !config.screensaver.showGui;
    onConfigChange('screensaver.showGui', config.screensaver.showGui);
    gui.refresh();
  }

  function toggleHud() {
    config.screensaver.showHud = !config.screensaver.showHud;
    onConfigChange('screensaver.showHud', config.screensaver.showHud);
    gui.refresh();
  }

  function setPaused(paused) {
    config.movement.paused = paused;
    onConfigChange('movement.paused', paused);
    hud.showToast(paused ? 'Paused (Space to resume)' : 'Resumed', 1500);
  }

  /** Draw one frame at the current pose (for screenshots, outside the loop). */
  function renderFrame() {
    applyCamera(1);
    post.render(scene, camera, config.effects);
  }

  /* ------------------------------------------------------------ actions */

  const actions = {
    regenerate() {
      rebuildWorld();
    },
    randomizeSeed() {
      config.maze.seed = randomSeedString();
      onConfigChange('maze.seed', config.maze.seed);
    },
    async uploadTexture(slot) {
      if (!TEXTURE_SLOTS.includes(slot)) return;
      const file = await pickFile('image/*');
      if (!file) return;
      try {
        const texture = await textureFromImage(file);
        const persist = file.size <= MAX_PERSISTED_IMAGE_BYTES;
        const dataUrl = persist ? await readFileAsDataUrl(file) : null;
        textureCache.setCustomImage(slot, texture);
        const T = config.textures[slot];
        T.kind = 'custom';
        T.custom = dataUrl ?? IN_MEMORY_MARKER;
        refreshMaterials();
        gui.refresh();
        saveSoon();
        hud.showToast(persist ? `${file.name} applied to ${slot}` : `${file.name} applied to ${slot} (too large to remember after a reload)`);
      } catch (err) {
        hud.showToast(`Could not load image: ${err?.message ?? err}`);
      }
    },
    clearTexture(slot) {
      if (!TEXTURE_SLOTS.includes(slot)) return;
      textureCache.setCustomImage(slot, null);
      const T = config.textures[slot];
      T.custom = null;
      if (T.kind === 'custom') T.kind = DEFAULTS.textures[slot].kind;
      refreshMaterials();
      gui.refresh();
      saveSoon();
    },
    applyPreset(id) {
      const preset = PRESETS[id];
      if (!preset) {
        hud.showToast(`Unknown preset "${id}"`);
        return;
      }
      resetConfig({ seed: config.maze.seed });
      deepMerge(config, preset);
      applyAll();
      hud.showToast(`Preset: ${labelOf(ENUMS.presets, id)}`);
    },
    exportSettings() {
      downloadText(exportSettingsJson(config), `3d-maze-settings-${fileStamp()}.json`);
      hud.showToast('Settings exported');
    },
    async importSettings() {
      const file = await pickFile('application/json,.json');
      if (!file) return;
      try {
        const diff = parseSettingsJson(await file.text());
        resetConfig();
        deepMerge(config, diff);
        applyAll();
        hud.showToast(`Settings imported from ${file.name}`);
      } catch (err) {
        hud.showToast(`Import failed: ${err?.message ?? err}`);
      }
    },
    async copyShareUrl() {
      const url = location.href.split('#')[0] + encodeShareHash(shareableDiff(config));
      try {
        await navigator.clipboard.writeText(url);
        hud.showToast('Share URL copied to the clipboard');
      } catch {
        replaceUrl(url);
        hud.showToast('Clipboard unavailable – the share URL is now in the address bar');
      }
    },
    resetDefaults() {
      resetConfig();
      clearStoredSettings();
      applyAll();
      hud.showToast('Settings reset to defaults');
    },
    fullscreen() {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        document.documentElement.requestFullscreen?.().catch(() => hud.showToast('Fullscreen is not available here'));
      }
    },
    screenshot() {
      renderFrame();
      const name = `3d-maze-${config.maze.seed.replace(/[^\w-]+/g, '_')}-${fileStamp()}.png`;
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, name);
        else hud.showToast('Screenshot failed');
      }, 'image/png');
      hud.showToast('Screenshot saved', 1500);
    },
    togglePause() {
      setPaused(!config.movement.paused);
    },
    teleportRandom() {
      if (transition || finishCountdown >= 0) return;
      doTeleport();
    },
    flipView() {
      roll.toggle(config.objects.smiley.flipDuration);
    },
  };

  const gui = createGui(config, { onChange: onConfigChange, actions });

  /* ------------------------------------------------------------- input */

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    activity.noteInput();
    if (screensaverActive) {
      exitScreensaver({ fromInput: true });
      e.preventDefault();
      return;
    }
    // Space/Enter on a focused button already activate it; do not double up.
    if (e.target?.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const manualAction = MANUAL_KEYS[key.toLowerCase()];
    if (manualAction && config.movement.manual) {
      walker.enqueue(manualAction);
      e.preventDefault();
      return;
    }
    if (e.repeat) return; // holding a key down must not re-toggle a shortcut
    switch (key) {
      case 'h': toggleGui(); break;
      case 'Tab': toggleHud(); break;
      case 'f': actions.fullscreen(); break;
      case ' ': actions.togglePause(); break;
      case 'r': actions.regenerate(); break;
      case 'n':
        config.maze.seed = randomSeedString();
        rebuildWorld();
        gui.refresh();
        saveSoon();
        break;
      case 'm': setManual(!config.movement.manual); gui.refresh(); saveSoon(); break;
      case 't': actions.teleportRandom(); break;
      case 'u': actions.flipView(); break;
      case 'p': actions.screenshot(); break;
      default: return;
    }
    e.preventDefault();
  }

  function onContextLost(e) {
    e.preventDefault();
    loop.stop();
    hud.showToast('Graphics context lost – waiting for the browser to restore it…', 6000);
  }

  function onContextRestored() {
    resize();
    loop.start();
    hud.showToast('Graphics context restored', 2000);
  }

  const listeners = [
    [window, 'resize', resize],
    [window, 'orientationchange', resize],
    [window, 'keydown', onKeyDown],
    [canvas, 'webglcontextlost', onContextLost],
    [canvas, 'webglcontextrestored', onContextRestored],
  ];
  for (const [target, type, fn] of listeners) target.addEventListener(type, fn);

  /* -------------------------------------------------------------- init */

  resize();
  lighting.apply(config);
  rebuildWorld();
  loadCustomImages();
  applyUiVisibility();

  const app = {
    config,
    renderer,
    scene,
    camera,
    rig,
    loop,
    hud,
    gui,
    actions,
    materials,
    textureCache,
    get maze() { return maze; },
    get walker() { return walker; },
    get rats() { return rats; },
    get decorations() { return decorations; },
    get decorationLayer() { return decorationLayer; },
    get transition() { return transition; },
    get roll() { return roll.roll; },
    get screensaverActive() { return screensaverActive; },
    regenerate: () => rebuildWorld(),
    start() { loop.start(); },
    stop() { loop.stop(); },
    dispose() {
      loop.stop();
      clearTimeout(saveTimer);
      for (const timer of pendingRebuilds.values()) clearTimeout(timer);
      pendingRebuilds.clear();
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
      activity.dispose();
      cancelAnimations();
      disposeWorld();
      materials.dispose();
      textureCache.dispose();
      lighting.dispose();
      post.dispose();
      gui.destroy();
      hud.destroy();
      renderer.dispose();
      if (window.__maze === app) delete window.__maze;
    },
  };
  window.__maze = app;
  return app;
}
